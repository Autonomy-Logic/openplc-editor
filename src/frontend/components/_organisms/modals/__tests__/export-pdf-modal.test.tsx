/**
 * Export-to-PDF wizard — the preview render reaching the screen.
 *
 * The render resolves asynchronously (font import plus the pdf-lib layout), and
 * the effect that starts it used to list the state it sets in its own
 * dependencies, so the re-render cancelled the render in flight and `Export`
 * stayed disabled forever. These tests hold the render asynchronous on purpose:
 * resolving it synchronously passes against the broken code too.
 *
 * The modal and the mocked service are imported dynamically: Jest does not hoist
 * `vi.mock`, so a static import would pull in the real print-actions module (and
 * the LSP chain behind it) before the mock is registered.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type * as PrintActions from '@root/frontend/services/print-actions'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '@root/middleware/shared/ports/project-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

vi.mock('@root/frontend/services/print-actions', () => ({
  renderPrintPdf: vi.fn(),
  executeExportPdf: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 595, height: 842 }),
          render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
        }),
      destroy: () => Promise.resolve(),
    }),
    destroy: () => Promise.resolve(),
  }),
}))

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort(),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort<ProjectPort>({ preparePdfPreviewWorker: () => Promise.resolve() }),
  device: stubPort(),
  orchestrator: stubPort(),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  capabilities: EDITOR_CAPABILITIES,
}

type RenderResult = Awaited<ReturnType<typeof PrintActions.renderPrintPdf>>

let ExportPdfModal: () => JSX.Element
let printActions: typeof PrintActions

beforeAll(async () => {
  printActions = await import('@root/frontend/services/print-actions')
  ExportPdfModal = (await import('../export-pdf-modal')).ExportPdfModal
})

const renderPrintPdf = () => vi.mocked(printActions.renderPrintPdf)
const executeExportPdf = () => vi.mocked(printActions.executeExportPdf)

/** Resolves on a later task, the way the real render does. */
function renderAfterATick(): Promise<RenderResult> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true, bytes: new Uint8Array([1, 2, 3]) }), 0)
  })
}

function openWizard() {
  const store = createTestStore()
  store.getState().projectActions.createPou({
    type: 'program',
    data: { language: 'st', name: 'Main', variables: [], body: { language: 'st', value: '' }, documentation: '' },
  })
  store.getState().modalActions.onOpenChange('export-pdf', true)
  render(<ExportPdfModal />, { wrapper: createStoreWrapper(store, ports) })
}

function clickButton(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function exportButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Export' })
}

describe('ExportPdfModal preview', () => {
  beforeEach(() => {
    renderPrintPdf().mockReset()
    renderPrintPdf().mockImplementation(renderAfterATick)
    executeExportPdf().mockReset()
    executeExportPdf().mockResolvedValue({ success: true })
  })

  it('enables Export once the asynchronous render resolves', async () => {
    openWizard()

    clickButton('Next')
    clickButton('Next')

    expect(exportButton().disabled).toBe(true)
    await waitFor(() => expect(exportButton().disabled).toBe(false))
    expect(renderPrintPdf()).toHaveBeenCalledTimes(1)
  })

  it('renders again after going back to the options step', async () => {
    openWizard()

    clickButton('Next')
    clickButton('Next')
    await waitFor(() => expect(exportButton().disabled).toBe(false))

    clickButton('Back')
    clickButton('Next')

    await waitFor(() => expect(exportButton().disabled).toBe(false))
    expect(renderPrintPdf()).toHaveBeenCalledTimes(2)
  })

  it('keeps the rendered bytes when a failed export sends the wizard back to the preview', async () => {
    executeExportPdf().mockResolvedValue({ success: false })
    openWizard()

    clickButton('Next')
    clickButton('Next')
    await waitFor(() => expect(exportButton().disabled).toBe(false))

    clickButton('Export')

    await waitFor(() => expect(executeExportPdf()).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(exportButton().disabled).toBe(false))
    expect(renderPrintPdf()).toHaveBeenCalledTimes(1)
  })
})
