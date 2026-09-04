/**
 * Export-to-PDF wizard — `type Step = 'select'|'options'|'preview'|'exporting'`,
 * following `retrieve-project-modal.tsx`'s step-union/body-footer pattern.
 * `select` picks POUs (project-explorer grouping/order — Functions, Function
 * Blocks, Programs, each name-sorted); `options` sets page-sharing (2+ POUs)
 * and page setup; `preview` renders the real bytes once and shows them via a
 * pdf.js canvas (no iframe — Electron's `sandbox: true` BrowserWindow has no
 * PDF plugin); `exporting` reuses those exact bytes for the save/download, so
 * "what you previewed is what you get" is structural, not a promise.
 */

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { PageOrientation } from '../../../../middleware/shared/ports/print-types'
import type { ProjectPort } from '../../../../middleware/shared/ports/project-port'
import { type PLCPou, projectCapabilities } from '../../../../middleware/shared/ports/types'
import { useProject } from '../../../../middleware/shared/providers'
import { MagnifierIcon } from '../../../assets/icons/interface/Magnifier'
import { executeExportPdf, renderPrintPdf } from '../../../services/print-actions'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'
import { PageSetupFields } from '../../_molecules/page-setup-fields'

/**
 * pdf.js is only needed for this one preview step, and it's a large library —
 * dynamically imported so it never lands in the main bundle for a session
 * that never opens the wizard, matching how monaco-editor and the LSP/compile
 * workers are already loaded lazily. Worker setup itself (real Worker vs.
 * main-thread — see `ProjectPort.preparePdfPreviewWorker`) is per-platform,
 * so it's delegated to the port rather than done here.
 */
let workerConfigured = false
async function loadPdfJs(projectPort: ProjectPort) {
  const pdfjsLib = await import('pdfjs-dist')
  if (!workerConfigured) {
    await projectPort.preparePdfPreviewWorker(pdfjsLib)
    workerConfigured = true
  }
  return pdfjsLib
}

type Step = 'select' | 'options' | 'preview' | 'exporting'

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; bytes: Uint8Array }
  | { status: 'error'; error: string }

const CHECKBOX = 'h-4 w-4 cursor-pointer rounded border-neutral-300 accent-brand dark:border-neutral-600'
/** Preview zoom bounds/step — the range common PDF/document viewers offer. */
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 0.1
/** Gap between pages in the preview, in px. Portrait's default (100%) zoom fits exactly two side by side. */
const PREVIEW_GAP = 16
const PRIMARY_BUTTON =
  'rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
const SECONDARY_BUTTON =
  'rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'

const byNameAsc = (a: PLCPou, b: PLCPou) => a.name.localeCompare(b.name)

type PouGroupProps = {
  title: string
  pous: PLCPou[]
  selected: string[]
  onToggle: (name: string) => void
}

const PouGroup = ({ title, pous, selected, onToggle }: PouGroupProps) => {
  if (pous.length === 0) return null
  return (
    <div>
      <p className='bg-neutral-50 px-3 py-1 text-xs font-semibold uppercase text-neutral-500 dark:bg-neutral-950 dark:text-neutral-500'>
        {title}
      </p>
      <ul className='divide-y divide-neutral-200 dark:divide-neutral-800'>
        {pous.map((pou) => (
          <li key={pou.name} className='px-3 py-2'>
            <label className='flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'>
              <input
                type='checkbox'
                className={CHECKBOX}
                checked={selected.includes(pou.name)}
                onChange={() => onToggle(pou.name)}
              />
              {pou.name}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Renders one page at `targetWidth`; a render failure is shown inline instead of leaving a blank canvas. */
const PdfPageCanvas = ({
  doc,
  pageNumber,
  targetWidth,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  targetWidth: number
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (targetWidth === 0) return
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let renderTask: RenderTask | null = null

    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return
        const unscaled = page.getViewport({ scale: 1 })
        const fitScale = Math.min(3, Math.max(0.1, targetWidth / unscaled.width))
        const viewport = page.getViewport({ scale: fitScale })
        canvas.width = viewport.width
        canvas.height = viewport.height
        renderTask = page.render({ canvas, viewport })
        return renderTask.promise
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error(`[print] pdf.js failed to render page ${pageNumber}:`, err)
        setError(err instanceof Error ? err.message : 'Failed to render this page.')
      })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, pageNumber, targetWidth])

  if (error) {
    return (
      <div
        style={{ width: targetWidth || undefined }}
        className='flex aspect-[1/1.414] items-center justify-center rounded border border-red-300 bg-red-50 p-2 text-center text-xs text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400'
      >
        {error}
      </div>
    )
  }

  return <canvas ref={canvasRef} className='shadow' />
}

/** pdf.js preview. Portrait documents lay every page out in a grid; others show one page at a time with Prev/Next. */
/**
 * pdf.js preview — every page, continuously scrollable (no button paging).
 * Landscape stacks pages one per row, fit to width; portrait wraps pages
 * into a grid, sized so two sit side by side at the default 100% zoom.
 * Zoom applies uniformly to both via the corner controls or Cmd/Ctrl+scroll.
 */
const PdfPreviewViewer = ({
  bytes,
  projectPort,
  orientation,
}: {
  bytes: Uint8Array
  projectPort: ProjectPort
  orientation: PageOrientation
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [docState, setDocState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; doc: PDFDocumentProxy; numPages: number }
    | { status: 'error'; error: string }
  >({ status: 'loading' })

  // The container div below stays mounted across every `docState` — loading,
  // error, and ready all render inside it — specifically so this ref is
  // already attached on the very first commit. A mount-once effect attached
  // to a ref that only exists in the 'ready' branch would never see a
  // container to observe, and `containerWidth` would stay 0 forever.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    setContainerWidth(container.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setContainerWidth(width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Cmd (Mac) or Ctrl (Windows/Linux, and how trackpad pinch-zoom reports
  // itself) + scroll to zoom. Not a plain `onWheel` prop: only a
  // non-passive native listener can `preventDefault()` to stop the page
  // from also scrolling while the modifier is held.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (event: WheelEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - event.deltaY * 0.0015)))
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // Tracks which page is current as the user scrolls — reads fresh DOM rects
  // on every scroll event rather than a ref-per-page IntersectionObserver,
  // since the page count here is small. Portrait lays several pages per row
  // (same `top`), so "current" is the FIRST page of the last row whose top
  // has scrolled past a line a quarter of the way down the viewport — the
  // row a page-by-page Prev/Next (below) actually lands on. Landscape's rows
  // hold exactly one page each, so this reduces to that page directly.
  useEffect(() => {
    if (docState.status !== 'ready') return
    const container = containerRef.current
    if (!container) return

    const updateCurrentPage = () => {
      const referenceY = container.getBoundingClientRect().top + container.clientHeight * 0.25
      // `dom.iterable` isn't in this repo's `lib` — NodeList has no `for...of` support without it.
      const pageEls = Array.from(container.querySelectorAll<HTMLElement>('[data-page]'))
      let currentRowTop: number | null = null
      for (const el of pageEls) {
        const top = el.getBoundingClientRect().top
        if (top > referenceY) break
        currentRowTop = top
      }
      if (currentRowTop === null) return
      const firstInRow = pageEls.find((el) => Math.abs(el.getBoundingClientRect().top - currentRowTop) < 1)
      if (firstInRow?.dataset.page) setCurrentPage(Number(firstInRow.dataset.page))
    }

    updateCurrentPage()
    container.addEventListener('scroll', updateCurrentPage, { passive: true })
    return () => container.removeEventListener('scroll', updateCurrentPage)
  }, [docState])

  // Jumps to the previous/next ROW, not the previous/next page number: in the
  // portrait grid several pages share a row (the same scroll position), so
  // stepping by a raw page number can target a page already fully in view —
  // scrollIntoView then has nothing to scroll to and the button looks dead.
  const goToAdjacentRow = (direction: 1 | -1) => {
    const container = containerRef.current
    if (!container) return
    const pageEls = Array.from(container.querySelectorAll<HTMLElement>('[data-page]'))
    const currentEl = pageEls.find((el) => Number(el.dataset.page) === currentPage)
    if (!currentEl) return
    const currentTop = currentEl.getBoundingClientRect().top
    const ordered = direction === 1 ? pageEls : [...pageEls].reverse()
    const target = ordered.find((el) => {
      const top = el.getBoundingClientRect().top
      return direction === 1 ? top > currentTop + 1 : top < currentTop - 1
    })
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null
    setDocState({ status: 'loading' })
    setZoom(1)
    setCurrentPage(1)

    void loadPdfJs(projectPort).then((pdfjsLib) => {
      if (cancelled) return
      // pdf.js may transfer the buffer it's given — a copy keeps `bytes` intact
      // for Export, which reuses the exact same bytes handed to this viewer.
      loadingTask = pdfjsLib.getDocument({ data: bytes.slice() })
      loadingTask.promise
        .then((doc) => {
          if (cancelled) return
          setDocState({ status: 'ready', doc, numPages: doc.numPages })
        })
        .catch((err: unknown) => {
          if (cancelled) return
          console.error('[print] pdf.js failed to open the rendered PDF:', err)
          setDocState({
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to open the rendered PDF.',
          })
        })
    })

    return () => {
      cancelled = true
      void loadingTask?.destroy()
    }
  }, [bytes, projectPort])

  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))

  // Landscape's 100% fits one page to the full width; portrait's 100% fits
  // two side by side (a normal print-preview "spread") — zoom scales from there.
  const baseTargetWidth =
    containerWidth === 0 ? 0 : orientation === 'portrait' ? (containerWidth - PREVIEW_GAP) / 2 : containerWidth - 32
  const targetWidth = baseTargetWidth * zoom

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      <div className='relative min-h-0 flex-1'>
        <div
          ref={containerRef}
          className='h-full overflow-auto rounded-md border border-neutral-200 bg-neutral-100 p-4 dark:border-neutral-800 dark:bg-neutral-900'
        >
          {docState.status === 'loading' && (
            <div className='flex h-full items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
              Opening the preview…
            </div>
          )}
          {docState.status === 'error' && (
            <p data-testid='export-pdf-preview-error' className='p-2 text-sm text-red-600 dark:text-red-400'>
              {docState.error}
            </p>
          )}
          {docState.status === 'ready' && (
            <div
              className={cn(
                'gap-4',
                orientation === 'portrait' ? 'flex flex-wrap justify-center' : 'flex flex-col items-center',
              )}
            >
              {Array.from({ length: docState.numPages }, (_, i) => i + 1).map((n) => (
                <div key={n} data-page={n}>
                  <PdfPageCanvas doc={docState.doc} pageNumber={n} targetWidth={targetWidth} />
                </div>
              ))}
            </div>
          )}
        </div>

        {docState.status === 'ready' && docState.numPages > 1 && (
          <div className='absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-neutral-950/80 px-1 py-1 text-xs text-white shadow-lg'>
            <button
              type='button'
              aria-label='Previous page'
              onClick={() => goToAdjacentRow(-1)}
              disabled={currentPage <= 1}
              className='flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40'
            >
              ‹
            </button>
            <span className='px-2'>
              Page {currentPage} of {docState.numPages}
            </span>
            <button
              type='button'
              aria-label='Next page'
              onClick={() => goToAdjacentRow(1)}
              disabled={currentPage >= docState.numPages}
              className='flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40'
            >
              ›
            </button>
          </div>
        )}

        {docState.status === 'ready' && (
          <div className='absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-neutral-950/80 px-1 py-1 text-xs text-white shadow-lg'>
            <button
              type='button'
              aria-label='Zoom out'
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              className='flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40'
            >
              −
            </button>
            <button
              type='button'
              aria-label='Reset zoom'
              onClick={() => setZoom(1)}
              className='flex items-center gap-1 rounded-full px-2 py-1 hover:bg-white/20'
            >
              <MagnifierIcon size='sm' className='h-3.5 w-3.5' />
              {Math.round(zoom * 100)}%
            </button>
            <button
              type='button'
              aria-label='Zoom in'
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              className='flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40'
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const ExportPdfModal = () => {
  const projectPort = useProject()
  const { modals, modalActions, project, print, printActions } = useOpenPLCStore()

  const isOpen = modals['export-pdf']?.open || false
  const [step, setStep] = useState<Step>('select')
  const [renderState, setRenderState] = useState<RenderState>({ status: 'idle' })

  const projectCaps = projectCapabilities({ type: project.meta.type })
  // SFC has no PrintPou renderer in backend/shared/print (never in scope for
  // print) — excluded from the checklist rather than selectable-but-inert.
  const printablePous = project.data.pous.filter((pou) => pou.body.language !== 'sfc')
  const functions = printablePous.filter((pou) => pou.pouType === 'function').sort(byNameAsc)
  const functionBlocks = printablePous.filter((pou) => pou.pouType === 'function-block').sort(byNameAsc)
  const programs = projectCaps.hasPrograms
    ? printablePous.filter((pou) => pou.pouType === 'program').sort(byNameAsc)
    : []
  const allNames = [...functions, ...functionBlocks, ...programs].map((pou) => pou.name)

  const selectedCount = print.selectedPouNames.length
  const allSelected = allNames.length > 0 && selectedCount === allNames.length

  const close = useCallback(() => {
    modalActions.onOpenChange('export-pdf', false)
    setStep('select')
    setRenderState({ status: 'idle' })
    printActions.resetPrintSelection()
  }, [modalActions, printActions])

  // This modal only mounts while open (app-layout's conditional render), so this
  // runs once per open — defaulting a fresh wizard to "export everything", which
  // the user can then narrow down.
  useEffect(() => {
    if (print.selectedPouNames.length === 0 && allNames.length > 0) {
      printActions.selectAllPous(allNames)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (step !== 'preview' || renderState.status !== 'idle') return
    setRenderState({ status: 'loading' })
    void renderPrintPdf(projectPort).then((result) => {
      setRenderState(result.ok ? { status: 'ready', bytes: result.bytes } : { status: 'error', error: result.error })
    })
  }, [step, renderState, projectPort])

  useEffect(() => {
    if (step !== 'exporting' || renderState.status !== 'ready') return
    let cancelled = false
    void executeExportPdf(projectPort, renderState.bytes).then((result) => {
      if (cancelled) return
      // Failure (or a cancelled save dialog) is already toasted by
      // executeExportPdf when it's a real error — just return to preview
      // so the user can retry or go back and change something.
      if (result.success) close()
      else setStep('preview')
    })
    return () => {
      cancelled = true
    }
  }, [step, renderState, projectPort, close])

  const handleBack = () => {
    if (step === 'preview') setRenderState({ status: 'idle' })
    setStep(step === 'options' ? 'select' : 'options')
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && close()}>
      <ModalContent className='flex h-[92vh] w-[92vw] select-none flex-col rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>Export to PDF</ModalTitle>

        {step === 'select' && (
          <div className='flex min-h-0 flex-1 flex-col gap-3'>
            <div className='flex items-center justify-between'>
              <label className='flex items-center gap-2 text-sm font-medium text-neutral-850 dark:text-neutral-300'>
                <input
                  type='checkbox'
                  className={CHECKBOX}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected
                  }}
                  onChange={() =>
                    allSelected ? printActions.clearPouSelection() : printActions.selectAllPous(allNames)
                  }
                />
                Select all
              </label>
              <span className='text-sm text-neutral-600 dark:text-neutral-400'>
                {selectedCount} of {allNames.length} selected
              </span>
            </div>

            <div className='min-h-0 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
              {allNames.length === 0 ? (
                <p className='p-4 text-sm text-neutral-500'>No printable POUs in this project.</p>
              ) : (
                <>
                  <PouGroup
                    title='Functions'
                    pous={functions}
                    selected={print.selectedPouNames}
                    onToggle={printActions.togglePou}
                  />
                  <PouGroup
                    title='Function Blocks'
                    pous={functionBlocks}
                    selected={print.selectedPouNames}
                    onToggle={printActions.togglePou}
                  />
                  <PouGroup
                    title='Programs'
                    pous={programs}
                    selected={print.selectedPouNames}
                    onToggle={printActions.togglePou}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {step === 'options' && (
          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-auto'>
            {selectedCount >= 2 && (
              <fieldset className='flex flex-col gap-1'>
                <legend className='text-sm font-medium text-neutral-850 dark:text-neutral-300'>Page sharing</legend>
                <label className='flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'>
                  <input
                    type='radio'
                    name='print-page-policy'
                    checked={print.pagePolicy === 'new-page-per-pou'}
                    onChange={() => printActions.setPagePolicy('new-page-per-pou')}
                  />
                  Start each POU on a new page
                </label>
                <label className='flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'>
                  <input
                    type='radio'
                    name='print-page-policy'
                    checked={print.pagePolicy === 'may-share-page'}
                    onChange={() => printActions.setPagePolicy('may-share-page')}
                  />
                  Let short POUs share a page
                </label>
              </fieldset>
            )}
            <PageSetupFields />
          </div>
        )}

        {step === 'preview' && (
          <div className='flex min-h-0 flex-1 flex-col gap-2'>
            {renderState.status === 'loading' && (
              <div className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
                Rendering preview…
              </div>
            )}
            {renderState.status === 'error' && (
              <p data-testid='export-pdf-error' className='text-sm text-red-600 dark:text-red-400'>
                {renderState.error}
              </p>
            )}
            {renderState.status === 'ready' && (
              <PdfPreviewViewer
                bytes={renderState.bytes}
                projectPort={projectPort}
                orientation={print.pageSetup.orientation}
              />
            )}
          </div>
        )}

        {step === 'exporting' && (
          <div className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
            Exporting…
          </div>
        )}

        <div className='mt-4 flex items-center justify-between gap-3'>
          <div className='flex gap-3'>
            <button type='button' onClick={close} disabled={step === 'exporting'} className={SECONDARY_BUTTON}>
              Cancel
            </button>
            {(step === 'options' || step === 'preview') && (
              <button type='button' onClick={handleBack} className={SECONDARY_BUTTON}>
                Back
              </button>
            )}
          </div>
          {step === 'select' && (
            <button
              type='button'
              onClick={() => setStep('options')}
              disabled={selectedCount === 0}
              className={PRIMARY_BUTTON}
            >
              Next
            </button>
          )}
          {step === 'options' && (
            <button type='button' onClick={() => setStep('preview')} className={PRIMARY_BUTTON}>
              Next
            </button>
          )}
          {step === 'preview' && (
            <button
              type='button'
              onClick={() => setStep('exporting')}
              disabled={renderState.status !== 'ready'}
              className={PRIMARY_BUTTON}
            >
              Export
            </button>
          )}
        </div>
      </ModalContent>
    </Modal>
  )
}

export { ExportPdfModal }
