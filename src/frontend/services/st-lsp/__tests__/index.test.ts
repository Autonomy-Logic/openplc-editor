/**
 * @jest-environment jsdom
 */
import type * as monaco from 'monaco-editor'
import type { Diagnostic } from 'vscode-languageserver-protocol'

import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { __clearBodyLineOffsetsForTests, getBodyLineOffset, setBodyLineOffset } from '../../lsp-shared/body-offsets'
import type { StartLanguageServiceOptions } from '../../lsp-shared/start-language-service'
import type { StlibSourcePort } from '../../../../middleware/shared/ports/stlib-source-port'

// Mock the LSP transport layer so `startStLsp` runs for real: the tests drive
// the hooks it hands to `startLanguageService`, not the service itself.
const mockRequestSemanticTokens = jest.fn()
const mockGetSemanticTokensLegend = jest.fn()
const mockRefreshSemanticTokens = jest.fn()
const mockGetSyncedDocumentText = jest.fn<string | undefined, [string]>()
let mockCapturedOptions: StartLanguageServiceOptions | undefined

// `vscode-languageserver-protocol`'s Node entry point is ESM-only and Jest's
// CJS transform can't parse it; index.ts only needs `CompletionRequest.type`
// as an opaque value (only reached from the scoped-completion path, unused
// by this test), so a stub avoids ever loading the real package under Jest.
jest.mock('vscode-languageserver-protocol', () => ({
  CompletionRequest: { type: 'textDocument/completion' },
}))

jest.mock('../../lsp-shared', () => ({
  startLanguageService: (options: StartLanguageServiceOptions) => {
    mockCapturedOptions = options
    return {
      // Never settles — nothing in this test awaits `ready`, and a pending
      // promise (unlike a rejected one) can never trigger an unhandled-rejection
      // warning if `warmUpScopeWorker`'s background await never gets there.
      ready: new Promise<void>(() => undefined),
      openDocument: jest.fn(),
      changeDocument: jest.fn(),
      closeDocument: jest.fn(),
      refreshSemanticTokens: () => mockRefreshSemanticTokens(),
      getSemanticTokensLegend: () => mockGetSemanticTokensLegend(),
      requestSemanticTokens: (uri: string) => mockRequestSemanticTokens(uri),
      dispose: jest.fn(),
    }
  },
  // The real registry, so `resolve-context.ts` (which imports it directly)
  // and index.ts agree on the body line.
  getBodyLineOffset: (uri: string) => getBodyLineOffset(uri),
  lspDiagnosticToMonaco: (d: Diagnostic, _api: unknown, lineOffset: number) => ({
    startLineNumber: d.range.start.line - lineOffset + 1,
    message: d.message,
  }),
  shiftSemanticTokensToBody: (data: unknown) => data,
  suppressNoDefinitionFound: jest.fn(),
}))

jest.mock('../project-sync', () => ({
  getSyncedDocumentText: (uri: string) => mockGetSyncedDocumentText(uri),
}))

import { startStLsp } from '../index'
import { getPrintSemanticTokensApi } from '../print-tokens-api'
import { pouUri, pouVarsUri } from '../types'

function makeStlibSource(): StlibSourcePort {
  return { listStlibs: jest.fn().mockResolvedValue([]), readStlib: jest.fn() }
}

function makeStPou(name: string): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: [] },
    body: { language: 'st', value: 'x := 1;' },
    documentation: '',
  } as PLCPou
}

const diagnosticAt = (line: number): Diagnostic => ({
  range: { start: { line, character: 0 }, end: { line, character: 4 } },
  message: `line ${line}`,
})

/** Enough of `monaco.editor` for the mirror, the viewport and the model-mount replay. */
function makeMonacoStub() {
  const models: Array<{ uri: { toString(): string }; getValue(): string }> = []
  const createdListeners: Array<(model: unknown) => void> = []
  const setModelMarkers = jest.fn()
  const api = {
    editor: {
      getModels: () => models,
      setModelMarkers,
      onDidCreateModel: (listener: (model: unknown) => void) => {
        createdListeners.push(listener)
        return { dispose: jest.fn() }
      },
    },
  } as unknown as typeof monaco
  const mount = (uri: string, text: string) => {
    const model = { uri: { toString: () => uri }, getValue: () => text }
    models.push(model)
    for (const listener of createdListeners) listener(model)
    return model
  }
  return { api, setModelMarkers, mount }
}

let services: Array<{ dispose(): void }> = []

function start(api?: typeof monaco) {
  const service = startStLsp({
    stlibSource: makeStlibSource(),
    workerUrlOverride: 'blob:test',
    ...(api ? { monaco: api } : {}),
  })
  services.push(service)
  return service
}

afterEach(() => {
  for (const service of services) service.dispose()
  services = []
})

describe('requestBodySemanticTokens', () => {
  beforeEach(() => {
    mockRequestSemanticTokens.mockReset()
    mockGetSemanticTokensLegend.mockReset()
    mockGetSemanticTokensLegend.mockReturnValue({ tokenTypes: [], tokenModifiers: [] })
  })

  it('returns null instead of throwing when the underlying semantic-tokens request rejects', async () => {
    mockRequestSemanticTokens.mockRejectedValue(new Error('worker crashed'))
    start()

    const api = getPrintSemanticTokensApi()
    expect(api).not.toBeNull()
    await expect(api?.requestBodySemanticTokens('Main')).resolves.toBeNull()
  })

  it('returns the shifted tokens when the request resolves normally', async () => {
    const data = new Uint32Array([1, 2, 3])
    mockRequestSemanticTokens.mockResolvedValue({ data })
    start()

    const api = getPrintSemanticTokensApi()
    const result = await api?.requestBodySemanticTokens('Main')

    expect(result).toEqual({ legend: { tokenTypes: [], tokenModifiers: [] }, data })
  })
})

describe('pouvars view sync', () => {
  // pou://main, LSP lines: 0 PROGRAM main · 1 VAR · 2 Level · 3 Enable · 4 END_VAR · 5 body
  const MAIN_DOC = ['PROGRAM main', 'VAR', '  Level : INT;', '  Enable : BOOL;', 'END_VAR', 'Level := 1;'].join('\n')
  const PRISTINE_VARS = ['VAR', '  Level : INT;', '  Enable : BOOL;', 'END_VAR'].join('\n')
  const MARKER_CTX = { markerOwner: 'strucpp-lsp', bodyOffset: 5, defaultSource: 'strucpp' }

  beforeEach(() => {
    __clearBodyLineOffsetsForTests()
    mockRefreshSemanticTokens.mockReset()
    mockGetSyncedDocumentText.mockReset()
    mockCapturedOptions = undefined
    openPLCStoreBase.setState((s) => ({
      project: { ...s.project, data: { ...s.project.data, pous: [makeStPou('main')] } },
    }))
    setBodyLineOffset(pouUri('main'), 5)
  })

  it('mirrors the VAR-block slice of a publish onto a mounted variables view', () => {
    const { api, setModelMarkers, mount } = makeMonacoStub()
    start(api)
    const model = mount(pouVarsUri('main'), PRISTINE_VARS)

    mockCapturedOptions?.diagnosticsMirror?.(
      { uri: pouUri('main'), diagnostics: [diagnosticAt(0), diagnosticAt(2), diagnosticAt(6)] },
      { ...MARKER_CTX, monacoApi: api },
    )

    expect(setModelMarkers).toHaveBeenCalledWith(model, 'strucpp-lsp', [{ startLineNumber: 2, message: 'line 2' }])
  })

  it('replays the last publish onto a variables view that mounts afterwards', () => {
    const { api, setModelMarkers, mount } = makeMonacoStub()
    start(api)

    mockCapturedOptions?.diagnosticsMirror?.(
      { uri: pouUri('main'), diagnostics: [diagnosticAt(3)] },
      { ...MARKER_CTX, monacoApi: api },
    )
    expect(setModelMarkers).not.toHaveBeenCalled()

    const model = mount(pouVarsUri('main'), PRISTINE_VARS)

    expect(setModelMarkers).toHaveBeenCalledWith(model, 'strucpp-lsp', [{ startLineNumber: 3, message: 'line 3' }])
  })

  it('leaves a body model mount alone', () => {
    const { api, setModelMarkers, mount } = makeMonacoStub()
    start(api)
    mockCapturedOptions?.diagnosticsMirror?.(
      { uri: pouUri('main'), diagnostics: [diagnosticAt(3)] },
      { ...MARKER_CTX, monacoApi: api },
    )

    mount(pouUri('main'), 'Level := 1;')

    expect(setModelMarkers).not.toHaveBeenCalled()
  })

  it('clips variables-view tokens to the VAR blocks, minus the lines the buffer no longer shares with the synced document', () => {
    const { api, mount } = makeMonacoStub()
    start(api)
    mockGetSyncedDocumentText.mockReturnValue(MAIN_DOC)
    mount(pouVarsUri('main'), PRISTINE_VARS.replace('  Level : INT;', '  Level : INT;\n  Count : INT;'))

    const viewport = mockCapturedOptions?.resolveSemanticTokensViewport?.(pouUri('main'), pouVarsUri('main'), 1)

    expect(viewport).toMatchObject({ startLine: 1, endLineExclusive: 5 })
    expect([1, 2, 3, 4].map((line) => viewport?.keepLine?.(line))).toEqual([true, true, false, false])
  })

  it('gives a variables view no tokens until project-sync has sent its document', () => {
    const { api, mount } = makeMonacoStub()
    start(api)
    mockGetSyncedDocumentText.mockReturnValue(undefined)
    mount(pouVarsUri('main'), PRISTINE_VARS)

    expect(mockCapturedOptions?.resolveSemanticTokensViewport?.(pouUri('main'), pouVarsUri('main'), 1)).toEqual({
      startLine: 0,
      endLineExclusive: 0,
    })
  })

  it('keeps body editors on the open-ended window', () => {
    const { api } = makeMonacoStub()
    start(api)

    expect(mockCapturedOptions?.resolveSemanticTokensViewport?.(pouUri('main'), pouUri('main'), 5)).toEqual({
      startLine: 5,
      endLineExclusive: Number.POSITIVE_INFINITY,
    })
  })

  it('re-tokenises when a mounted variables view POU changes its VAR blocks, and not on a body edit', () => {
    const { api, mount } = makeMonacoStub()
    start(api)
    const updateMain = (change: (pou: PLCPou) => PLCPou) =>
      openPLCStoreBase.setState((s) => ({
        project: {
          ...s.project,
          data: { ...s.project.data, pous: s.project.data.pous.map((p) => (p.name === 'main' ? change(p) : p)) },
        },
      }))

    updateMain((p) => ({ ...p, interface: { ...p.interface, variables: [] } }))
    expect(mockRefreshSemanticTokens).not.toHaveBeenCalled()

    mount(pouVarsUri('main'), PRISTINE_VARS)
    updateMain((p) => ({ ...p, body: { language: 'st', value: 'x := 2;' } }))
    expect(mockRefreshSemanticTokens).not.toHaveBeenCalled()

    updateMain((p) => ({ ...p, interface: { ...p.interface, variables: [] } }))
    expect(mockRefreshSemanticTokens).toHaveBeenCalledTimes(1)
  })
})
