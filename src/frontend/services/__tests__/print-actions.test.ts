/**
 * print-actions.ts test file
 *
 * Mirrors export-actions.test.ts's shape: every collaborator this module
 * talks to (the store, flow-writeback, toast, the ST print-tokens API, and
 * Monaco's static tokenizer) is mocked so the tests exercise only this
 * file's own assembly/branching logic.
 */

import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { PagePolicy, PageSetup, PrintRenderMode } from '../../store/slices/print'

const mockTokenize = vi.fn()
vi.mock('monaco-editor', () => ({
  editor: { tokenize: (...args: unknown[]) => mockTokenize(...args) },
}))

const mockGetState = vi.fn()
vi.mock('../../store', () => ({
  openPLCStoreBase: { getState: () => mockGetState() },
}))

const mockFlushFlowWriteBacks = vi.fn()
vi.mock('../../store/slices/shared/flow-writeback', () => ({
  flushFlowWriteBacks: (...args: unknown[]) => mockFlushFlowWriteBacks(...args),
}))

const mockToast = vi.fn()
vi.mock('../../utils/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

const mockGetPrintSemanticTokensApi = vi.fn()
vi.mock('../st-lsp', () => ({
  getPrintSemanticTokensApi: () => mockGetPrintSemanticTokensApi(),
}))

import { OPENPLC_LIGHT_EDITOR_FOREGROUND, resolveOpenPlcTokenColor } from '../../utils/monaco/openplc-theme-data'
import { collectSelectedPous, executeExportPdf, renderPrintPdf } from '../print-actions'

const DEFAULT_PAGE_SETUP: PageSetup = {
  size: 'a4',
  orientation: 'portrait',
  margins: { top: 36, right: 36, bottom: 36, left: 36 },
}

function makePou(overrides: Partial<PLCPou> & { name: string; body: PLCPou['body'] }): PLCPou {
  return {
    pouType: 'program',
    ...overrides,
  }
}

function makeState(overrides?: {
  pous?: PLCPou[]
  projectName?: string
  selectedPouNames?: string[]
  renderMode?: PrintRenderMode
  pagePolicy?: PagePolicy
  pageSetup?: PageSetup
}) {
  return {
    project: {
      meta: { name: overrides?.projectName ?? 'MyProject', type: 'plc-project' as const, path: 'proj-1' },
      data: { pous: overrides?.pous ?? [] },
    },
    print: {
      selectedPouNames: overrides?.selectedPouNames ?? [],
      renderMode: overrides?.renderMode ?? 'normal',
      pagePolicy: overrides?.pagePolicy ?? 'new-page-per-pou',
      pageSetup: overrides?.pageSetup ?? DEFAULT_PAGE_SETUP,
    },
  }
}

function makeProjectPort(overrides?: Partial<ProjectPort>): ProjectPort {
  return {
    renderPdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    exportPdfFile: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as unknown as ProjectPort
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetState.mockReturnValue(makeState())
  mockFlushFlowWriteBacks.mockReturnValue([])
  mockGetPrintSemanticTokensApi.mockReturnValue(null)
  // One token spanning the whole (non-empty) line — enough to prove
  // print-actions wires tokenize()'s result into ColoredLine[] correctly,
  // without asserting on Monaco's own tokenizing behavior.
  mockTokenize.mockImplementation((text: string) =>
    text.split('\n').map((line) => (line.length > 0 ? [{ offset: 0, type: 'identifier', language: 'il' }] : [])),
  )
})

describe('collectSelectedPous', () => {
  it('returns an empty array for an empty selection', async () => {
    mockGetState.mockReturnValue(makeState({ pous: [makePou({ name: 'main', body: { language: 'st', value: '' } })] }))
    expect(await collectSelectedPous([])).toEqual([])
  })

  it('filters to the selection and preserves project.data.pous array order, not selection order', async () => {
    const pouC = makePou({ name: 'C', body: { language: 'il', value: 'X' } })
    const pouA = makePou({ name: 'A', body: { language: 'il', value: 'Y' } })
    const pouB = makePou({ name: 'B', body: { language: 'il', value: 'Z' } })
    mockGetState.mockReturnValue(makeState({ pous: [pouC, pouA, pouB] }))

    const result = await collectSelectedPous(['B', 'A'])

    expect(result.map((p) => p.name)).toEqual(['A', 'B'])
  })

  it('maps interface.variables through toPrintVars, filling in defaults for absent optional fields', async () => {
    const fullVar: PLCVariable = {
      name: 'X',
      class: 'input',
      type: { definition: 'base-type', value: 'BOOL' },
      location: '%IX0.0',
      initialValue: 'TRUE',
      documentation: 'doc',
      debug: true,
      flag: 'constant',
    }
    const minimalVar: PLCVariable = {
      name: 'Y',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
    }
    const pou = makePou({
      name: 'MyIl',
      body: { language: 'il', value: 'X' },
      interface: { variables: [fullVar, minimalVar] },
    })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    const [result] = await collectSelectedPous(['MyIl'])

    expect(result?.variables).toEqual([
      {
        name: 'X',
        varClass: 'input',
        flag: 'constant',
        type: 'BOOL',
        location: '%IX0.0',
        initialValue: 'TRUE',
        documentation: 'doc',
        debug: true,
      },
      {
        name: 'Y',
        varClass: '',
        flag: '',
        type: 'INT',
        location: '',
        initialValue: '',
        documentation: '',
        debug: false,
      },
    ])
  })

  it('builds a "ld" PrintPou from a ladder body', async () => {
    const rungs = [{ id: 'r1', comment: '', defaultBounds: [], reactFlowViewport: [], selectedNodes: [], nodes: [], edges: [] }]
    const pou = makePou({
      name: 'MyLadder',
      pouType: 'function-block',
      body: { language: 'ld', value: { name: 'MyLadder', rungs } },
      interface: { variables: [] },
    })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    const [result] = await collectSelectedPous(['MyLadder'])

    expect(result).toEqual({ name: 'MyLadder', kind: 'ld', rungs, variables: [] })
  })

  it('builds a "fbd" PrintPou from an fbd body', async () => {
    const rung = { comment: '', selectedNodes: [], nodes: [], edges: [] }
    const pou = makePou({
      name: 'MyFbd',
      body: { language: 'fbd', value: { name: 'MyFbd', rung } },
      interface: { variables: [] },
    })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    const [result] = await collectSelectedPous(['MyFbd'])

    expect(result).toEqual({ name: 'MyFbd', kind: 'fbd', rung, variables: [] })
  })

  it('silently excludes a "ld" POU whose body.value has no rungs array', async () => {
    const pou = makePou({ name: 'BadLd', body: { language: 'ld', value: { name: 'BadLd' } } })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    expect(await collectSelectedPous(['BadLd'])).toEqual([])
  })

  it('silently excludes a "fbd" POU whose body.value is not an object', async () => {
    const pou = makePou({ name: 'BadFbd', body: { language: 'fbd', value: 'not-an-object' } })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    expect(await collectSelectedPous(['BadFbd'])).toEqual([])
  })

  it.each(['il', 'cpp', 'python'] as const)('builds a "%s" PrintPou with colored lines from Monaco tokenize', async (language) => {
    const pou = makePou({ name: 'MyText', body: { language, value: 'LINE_ONE\nLINE_TWO' } })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    const [result] = await collectSelectedPous(['MyText'])

    expect(result?.kind).toBe(language)
    if (result?.kind !== 'ld' && result?.kind !== 'fbd') {
      expect(result?.lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['LINE_ONE', 'LINE_TWO'])
    }
    expect(mockTokenize).toHaveBeenCalledWith('LINE_ONE\nLINE_TWO', language)
  })

  it('colors "st" lines from the LSP semantic-tokens response when available', async () => {
    const requestBodySemanticTokens = vi.fn().mockResolvedValue({
      legend: { tokenTypes: ['variable'], tokenModifiers: [] },
      data: new Uint32Array([0, 0, 1, 0, 0]),
    })
    mockGetPrintSemanticTokensApi.mockReturnValue({ requestBodySemanticTokens })
    const pou = makePou({ name: 'MyST', body: { language: 'st', value: 'A := B;' } })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    const [result] = await collectSelectedPous(['MyST'])

    expect(requestBodySemanticTokens).toHaveBeenCalledWith('MyST')
    expect(result?.kind).toBe('st')
    if (result?.kind !== 'ld' && result?.kind !== 'fbd') {
      expect(result?.lines).toEqual([
        {
          runs: [
            { text: 'A', color: resolveOpenPlcTokenColor('variable') },
            { text: ' := B;', color: OPENPLC_LIGHT_EDITOR_FOREGROUND },
          ],
        },
      ])
    }
  })

  it('falls back to one uncolored run per line when the ST print-tokens API is unavailable', async () => {
    mockGetPrintSemanticTokensApi.mockReturnValue(null)
    const pou = makePou({ name: 'MyST', body: { language: 'st', value: 'A := B;\nC := D;' } })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    const [result] = await collectSelectedPous(['MyST'])

    if (result?.kind !== 'ld' && result?.kind !== 'fbd') {
      expect(result?.lines).toEqual([
        { runs: [{ text: 'A := B;', color: OPENPLC_LIGHT_EDITOR_FOREGROUND }] },
        { runs: [{ text: 'C := D;', color: OPENPLC_LIGHT_EDITOR_FOREGROUND }] },
      ])
    }
  })

  it('silently excludes an "sfc" POU — no PrintPou renderer exists for it', async () => {
    const pou = makePou({ name: 'MySfc', body: { language: 'sfc', value: '' } })
    mockGetState.mockReturnValue(makeState({ pous: [pou] }))

    expect(await collectSelectedPous(['MySfc'])).toEqual([])
  })
})

describe('renderPrintPdf', () => {
  it('flushes write-backs, builds a PrintRequest from the print slice, and renders it', async () => {
    const pou = makePou({ name: 'MyIl', body: { language: 'il', value: 'X' } })
    mockGetState.mockReturnValue(
      makeState({
        pous: [pou],
        projectName: 'Widgets',
        selectedPouNames: ['MyIl'],
        renderMode: 'scale-to-fit',
        pagePolicy: 'may-share-page',
        pageSetup: { size: 'letter', orientation: 'landscape', margins: { top: 1, right: 2, bottom: 3, left: 4 } },
      }),
    )
    const bytes = new Uint8Array([9, 9, 9])
    const projectPort = makeProjectPort({ renderPdf: vi.fn().mockResolvedValue(bytes) })

    const result = await renderPrintPdf(projectPort)

    expect(result).toEqual({ ok: true, bytes })
    expect(mockFlushFlowWriteBacks).toHaveBeenCalledTimes(1)
    expect(projectPort.renderPdf).toHaveBeenCalledWith({
      projectName: 'Widgets',
      mode: 'scale-to-fit',
      pagePolicy: 'may-share-page',
      page: { size: 'letter', orientation: 'landscape', marginsPt: { top: 1, right: 2, bottom: 3, left: 4 } },
      pous: [{ name: 'MyIl', kind: 'il', lines: expect.any(Array), variables: [] }],
    })
  })

  it('returns ok:false without rendering when flushFlowWriteBacks reports stale flows', async () => {
    mockFlushFlowWriteBacks.mockReturnValue(['Stale1', 'Stale2'])
    const projectPort = makeProjectPort()

    const result = await renderPrintPdf(projectPort)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Stale1, Stale2')
    expect(projectPort.renderPdf).not.toHaveBeenCalled()
  })

  it('returns ok:false when the selection resolves to zero printable POUs', async () => {
    const pou = makePou({ name: 'MySfc', body: { language: 'sfc', value: '' } })
    mockGetState.mockReturnValue(makeState({ pous: [pou], selectedPouNames: ['MySfc'] }))
    const projectPort = makeProjectPort()

    const result = await renderPrintPdf(projectPort)

    expect(result).toEqual({ ok: false, error: 'No printable POUs are selected.' })
    expect(projectPort.renderPdf).not.toHaveBeenCalled()
  })

  it('catches a rejected renderPdf and returns its message', async () => {
    const pou = makePou({ name: 'MyIl', body: { language: 'il', value: 'X' } })
    mockGetState.mockReturnValue(makeState({ pous: [pou], selectedPouNames: ['MyIl'] }))
    const projectPort = makeProjectPort({ renderPdf: vi.fn().mockRejectedValue(new Error('worker crashed')) })

    const result = await renderPrintPdf(projectPort)

    expect(result).toEqual({ ok: false, error: 'worker crashed' })
  })
})

describe('executeExportPdf', () => {
  it('saves the bytes, toasts success, and returns success:true', async () => {
    mockGetState.mockReturnValue(makeState({ projectName: 'Widgets' }))
    const bytes = new Uint8Array([1, 2, 3])
    const exportPdfFile = vi.fn().mockResolvedValue({ success: true })
    const projectPort = makeProjectPort({ exportPdfFile })

    const result = await executeExportPdf(projectPort, bytes)

    expect(result).toEqual({ success: true })
    expect(exportPdfFile).toHaveBeenCalledWith('Widgets.pdf', bytes)
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'default' }))
  })

  it('returns success:false without toasting when the save dialog was canceled', async () => {
    const exportPdfFile = vi.fn().mockResolvedValue({ success: false, canceled: true })
    const projectPort = makeProjectPort({ exportPdfFile })

    const result = await executeExportPdf(projectPort, new Uint8Array())

    expect(result).toEqual({ success: false })
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('toasts a failure and returns success:false on a real save error', async () => {
    const exportPdfFile = vi.fn().mockResolvedValue({ success: false, error: 'disk full' })
    const projectPort = makeProjectPort({ exportPdfFile })

    const result = await executeExportPdf(projectPort, new Uint8Array())

    expect(result).toEqual({ success: false })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail', description: 'disk full' }))
  })

  it('catches unexpected exceptions and toasts a generic failure', async () => {
    const exportPdfFile = vi.fn().mockRejectedValue(new Error('boom'))
    const projectPort = makeProjectPort({ exportPdfFile })

    const result = await executeExportPdf(projectPort, new Uint8Array())

    expect(result).toEqual({ success: false })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail', description: 'boom' }))
  })
})
