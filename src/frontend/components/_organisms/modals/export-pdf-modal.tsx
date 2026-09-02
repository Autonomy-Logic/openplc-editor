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
import { useCallback, useEffect, useRef, useState } from 'react'

import { type PLCPou, projectCapabilities } from '../../../../middleware/shared/ports/types'
import { useProject } from '../../../../middleware/shared/providers'
import { executeExportPdf, renderPrintPdf } from '../../../services/print-actions'
import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'
import { PageSetupFields } from '../../_molecules/page-setup-fields'

/**
 * pdf.js is only needed for this one preview step, and it's a large library —
 * dynamically imported (both itself and its worker asset) so it never lands
 * in the main bundle for a session that never opens the wizard, matching how
 * monaco-editor and the LSP/compile workers are already loaded lazily.
 */
let workerConfigured = false
async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  if (!workerConfigured) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
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

/** pdf.js canvas viewer — one page at a time, Prev/Next when there's more than one. */
const PdfPreviewViewer = ({ bytes }: { bytes: Uint8Array }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [docState, setDocState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; doc: PDFDocumentProxy; numPages: number }
    | { status: 'error'; error: string }
  >({ status: 'loading' })
  const [pageNum, setPageNum] = useState(1)

  useEffect(() => {
    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null
    setDocState({ status: 'loading' })

    void loadPdfJs().then((pdfjsLib) => {
      if (cancelled) return
      // pdf.js may transfer the buffer it's given — a copy keeps `bytes` intact
      // for Export, which reuses the exact same bytes handed to this viewer.
      loadingTask = pdfjsLib.getDocument({ data: bytes.slice() })
      loadingTask.promise
        .then((doc) => {
          if (cancelled) return
          setDocState({ status: 'ready', doc, numPages: doc.numPages })
          setPageNum(1)
        })
        .catch((err: unknown) => {
          if (cancelled) return
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
  }, [bytes])

  useEffect(() => {
    if (docState.status !== 'ready') return
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let renderTask: RenderTask | null = null

    void docState.doc.getPage(pageNum).then((page) => {
      if (cancelled) return
      const viewport = page.getViewport({ scale: 1.25 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      renderTask = page.render({ canvas, viewport })
      return renderTask.promise
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [docState, pageNum])

  if (docState.status === 'loading') {
    return (
      <div className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
        Opening the preview…
      </div>
    )
  }
  if (docState.status === 'error') {
    return (
      <p data-testid='export-pdf-preview-error' className='text-sm text-red-600 dark:text-red-400'>
        {docState.error}
      </p>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      <div className='min-h-0 flex-1 overflow-auto rounded-md border border-neutral-200 bg-neutral-100 p-2 dark:border-neutral-800 dark:bg-neutral-900'>
        <canvas ref={canvasRef} className='mx-auto shadow' />
      </div>
      {docState.numPages > 1 && (
        <div className='flex items-center justify-center gap-3 text-sm text-neutral-850 dark:text-neutral-300'>
          <button
            type='button'
            onClick={() => setPageNum((n) => Math.max(1, n - 1))}
            disabled={pageNum <= 1}
            className='rounded-md bg-neutral-100 px-2 py-1 disabled:opacity-50 dark:bg-neutral-850'
          >
            Prev
          </button>
          <span>
            Page {pageNum} of {docState.numPages}
          </span>
          <button
            type='button'
            onClick={() => setPageNum((n) => Math.min(docState.numPages, n + 1))}
            disabled={pageNum >= docState.numPages}
            className='rounded-md bg-neutral-100 px-2 py-1 disabled:opacity-50 dark:bg-neutral-850'
          >
            Next
          </button>
        </div>
      )}
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
      <ModalContent className='flex h-[600px] w-[560px] select-none flex-col rounded-lg p-6'>
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
            {renderState.status === 'ready' && <PdfPreviewViewer bytes={renderState.bytes} />}
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
