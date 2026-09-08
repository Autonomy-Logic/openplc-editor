/**
 * @jest-environment jsdom
 */
import type { StlibSourcePort } from '../../../../middleware/shared/ports/stlib-source-port'

// Mock the LSP transport layer so `startStLsp` runs for real (we're testing
// `requestBodySemanticTokens`'s own error handling, not `startLanguageService`).
const mockRequestSemanticTokens = jest.fn()
const mockGetSemanticTokensLegend = jest.fn()

// `vscode-languageserver-protocol`'s Node entry point is ESM-only and Jest's
// CJS transform can't parse it; index.ts only needs `CompletionRequest.type`
// as an opaque value (only reached from the scoped-completion path, unused
// by this test), so a stub avoids ever loading the real package under Jest.
jest.mock('vscode-languageserver-protocol', () => ({
  CompletionRequest: { type: 'textDocument/completion' },
}))

jest.mock('../../lsp-shared', () => ({
  startLanguageService: () => ({
    // Never settles — nothing in this test awaits `ready`, and a pending
    // promise (unlike a rejected one) can never trigger an unhandled-rejection
    // warning if `warmUpScopeWorker`'s background await never gets there.
    ready: new Promise<void>(() => undefined),
    openDocument: jest.fn(),
    changeDocument: jest.fn(),
    closeDocument: jest.fn(),
    refreshSemanticTokens: jest.fn(),
    getSemanticTokensLegend: () => mockGetSemanticTokensLegend(),
    requestSemanticTokens: (uri: string) => mockRequestSemanticTokens(uri),
    dispose: jest.fn(),
  }),
  getBodyLineOffset: () => 0,
  lspDiagnosticToMonaco: jest.fn(),
  shiftSemanticTokensToBody: (data: unknown) => data,
  suppressNoDefinitionFound: jest.fn(),
}))

import { startStLsp } from '../index'
import { getPrintSemanticTokensApi } from '../print-tokens-api'

function makeStlibSource(): StlibSourcePort {
  return { listStlibs: jest.fn().mockResolvedValue([]), readStlib: jest.fn() }
}

describe('requestBodySemanticTokens', () => {
  beforeEach(() => {
    mockRequestSemanticTokens.mockReset()
    mockGetSemanticTokensLegend.mockReset()
    mockGetSemanticTokensLegend.mockReturnValue({ tokenTypes: [], tokenModifiers: [] })
  })

  it('returns null instead of throwing when the underlying semantic-tokens request rejects', async () => {
    mockRequestSemanticTokens.mockRejectedValue(new Error('worker crashed'))
    startStLsp({ stlibSource: makeStlibSource(), workerUrlOverride: 'blob:test' })

    const api = getPrintSemanticTokensApi()
    expect(api).not.toBeNull()
    await expect(api?.requestBodySemanticTokens('Main')).resolves.toBeNull()
  })

  it('returns the shifted tokens when the request resolves normally', async () => {
    const data = new Uint32Array([1, 2, 3])
    mockRequestSemanticTokens.mockResolvedValue({ data })
    startStLsp({ stlibSource: makeStlibSource(), workerUrlOverride: 'blob:test' })

    const api = getPrintSemanticTokensApi()
    const result = await api?.requestBodySemanticTokens('Main')

    expect(result).toEqual({ legend: { tokenTypes: [], tokenModifiers: [] }, data })
  })
})
