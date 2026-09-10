/**
 * @jest-environment jsdom
 */
import type * as monaco from 'monaco-editor'
import type { DocumentSymbol, Location as LspLocation, MessageConnection } from 'vscode-languageserver-protocol'

// The package's Node entry is ESM-only; the providers only read the request
// type constants, so a stub keeps Jest away from it.
jest.mock('vscode-languageserver-protocol', () => ({
  CompletionRequest: { type: 'textDocument/completion' },
  HoverRequest: { type: 'textDocument/hover' },
  SignatureHelpRequest: { type: 'textDocument/signatureHelp' },
  DefinitionRequest: { type: 'textDocument/definition' },
  ReferencesRequest: { type: 'textDocument/references' },
  DocumentSymbolRequest: { type: 'textDocument/documentSymbol' },
  DocumentFormattingRequest: { type: 'textDocument/formatting' },
}))

import { __clearBodyLineOffsetsForTests, setBodyLineOffset } from '../body-offsets'
import { OUTLINE_TARGET_COLUMN_BASE, outlineBindingFor } from '../navigation'
import { type ProviderHooks, registerLspProviders } from '../providers'

const POU = 'inmemory://pou/main.st'
const OTHER = 'inmemory://pou/other.st'

class FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

function makeHarness(hooks: ProviderHooks, editorLine = 1) {
  const providers: Record<string, unknown> = {}
  const register = (key: string) => (_language: string, provider: unknown) => {
    providers[key] = provider
    return { dispose: jest.fn() }
  }
  const model = {
    uri: { toString: () => POU },
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1, word: '' }),
  } as unknown as monaco.editor.ITextModel
  const editor = {
    getModel: () => model,
    getPosition: () => ({ lineNumber: editorLine, column: 1 }),
    setSelection: jest.fn(),
  }
  const api = {
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    Range: FakeRange,
    languages: {
      registerCompletionItemProvider: register('completion'),
      registerHoverProvider: register('hover'),
      registerSignatureHelpProvider: register('signature'),
      registerDefinitionProvider: register('definition'),
      registerReferenceProvider: register('references'),
      registerDocumentSymbolProvider: register('symbols'),
      registerDocumentFormattingEditProvider: register('formatting'),
    },
    editor: { getEditors: () => [editor], onDidCreateEditor: () => ({ dispose: jest.fn() }) },
  } as unknown as typeof monaco
  const sendRequest = jest.fn()
  registerLspProviders({
    connection: { sendRequest } as unknown as MessageConnection,
    monacoApi: api,
    languageId: 'st',
    hooks: { resolveLspContext: () => ({ lspUri: POU, lineOffset: 5 }), ...hooks },
  })
  return {
    model,
    sendRequest,
    definition: providers.definition as monaco.languages.DefinitionProvider,
    symbols: providers.symbols as monaco.languages.DocumentSymbolProvider,
  }
}

const at = (uri: string, line: number, character = 2): LspLocation => ({
  uri,
  range: { start: { line, character }, end: { line, character: character + 4 } },
})

const token = {} as monaco.CancellationToken
const position = { lineNumber: 2, column: 6 } as monaco.Position

beforeEach(() => __clearBodyLineOffsetsForTests())

describe('provideDefinition', () => {
  it('shows each target where the mapper puts it, as a parsed Monaco URI', async () => {
    const { model, sendRequest, definition } = makeHarness({
      mapDefinitionLocation: (loc) => ({ uri: `mirror:${loc.uri}`, range: new FakeRange(1, 1, 1, 1) }),
    })
    sendRequest.mockResolvedValue([at(OTHER, 3)])

    const result = (await definition.provideDefinition(model, position, token)) as monaco.languages.Location[]

    expect(result.map((l) => l.uri.toString())).toEqual([`mirror:${OTHER}`])
    expect(result[0].range).toEqual(new FakeRange(1, 1, 1, 1))
  })

  it('claims the definition with a self location when every target is unreachable', async () => {
    const { model, sendRequest, definition } = makeHarness({ mapDefinitionLocation: () => null })
    sendRequest.mockResolvedValue([at('file:///typeshed/builtins.pyi', 3)])

    const result = (await definition.provideDefinition(model, position, token)) as monaco.languages.Location[]

    expect(result).toHaveLength(1)
    expect(result[0].uri).toBe(model.uri)
    expect(result[0].range).toEqual(new FakeRange(2, 5, 2, 5))
  })

  it("shifts a target into its own document's body view by default", async () => {
    const { model, sendRequest, definition } = makeHarness({})
    setBodyLineOffset(OTHER, 4)
    sendRequest.mockResolvedValue(at(OTHER, 7))

    const result = (await definition.provideDefinition(model, position, token)) as monaco.languages.Location[]

    expect(result[0].uri.toString()).toBe(OTHER)
    expect(result[0].range).toMatchObject({ startLineNumber: 4, startColumn: 3 })
  })
})

describe('provideDocumentSymbols', () => {
  // pou://main: 0 declaration, 1 VAR, 2 Level, 3 Enable, 4 END_VAR, body from 5.
  const leaf = (name: string, line: number): DocumentSymbol => ({
    name,
    kind: 13,
    range: { start: { line, character: 2 }, end: { line, character: 12 } },
    selectionRange: { start: { line, character: 2 }, end: { line, character: 7 } },
  })
  const document: DocumentSymbol[] = [
    {
      name: 'main',
      kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
      selectionRange: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } },
      children: [leaf('Level', 2), leaf('Enable', 3), leaf('State', 7)],
    },
  ]

  it('lists the declarations before the body, bound to the outline navigator on the current line', async () => {
    const navigate = jest.fn(() => true)
    const { model, sendRequest, symbols } = makeHarness({ navigateOutline: navigate }, 4)
    sendRequest.mockResolvedValue(document)

    const result = (await symbols.provideDocumentSymbols(model, token)) as monaco.languages.DocumentSymbol[]

    expect(result.map((s) => s.name)).toEqual(['Level', 'Enable', 'State'])
    expect(result[0].range).toEqual({
      startLineNumber: 4,
      startColumn: OUTLINE_TARGET_COLUMN_BASE,
      endLineNumber: 4,
      endColumn: OUTLINE_TARGET_COLUMN_BASE,
    })
    expect(outlineBindingFor(POU, result[1].range)).toMatchObject({ target: { uri: POU, lineLsp: 3, characterLsp: 2 } })
    expect(result[2].range).toMatchObject({ startLineNumber: 3, startColumn: 3 })
  })

  it('rewraps a flat SymbolInformation response the same way', async () => {
    const navigate = jest.fn(() => true)
    const { model, sendRequest, symbols } = makeHarness({ navigateOutline: navigate }, 2)
    const flat = (name: string, line: number) => ({
      name,
      kind: 13,
      containerName: 'main',
      location: { uri: POU, range: { start: { line, character: 2 }, end: { line, character: 12 } } },
    })
    sendRequest.mockResolvedValue([flat('Level', 2), flat('State', 7)])

    const result = (await symbols.provideDocumentSymbols(model, token)) as monaco.languages.DocumentSymbol[]

    expect(result.map((s) => [s.name, s.detail])).toEqual([
      ['Level', 'main'],
      ['State', 'main'],
    ])
    expect(result[0].range).toMatchObject({ startLineNumber: 2, startColumn: OUTLINE_TARGET_COLUMN_BASE })
    expect(outlineBindingFor(POU, result[0].range)).toMatchObject({ target: { uri: POU, lineLsp: 2, characterLsp: 2 } })
    expect(result[1].range).toMatchObject({ startLineNumber: 3, startColumn: 3 })
  })

  it('drops them when no outline navigator is configured', async () => {
    const { model, sendRequest, symbols } = makeHarness({})
    sendRequest.mockResolvedValue(document)

    const result = (await symbols.provideDocumentSymbols(model, token)) as monaco.languages.DocumentSymbol[]

    expect(result.map((s) => s.name)).toEqual(['State'])
  })

  it('leaves a windowed view to its window, bound entries or not', async () => {
    const { model, sendRequest, symbols } = makeHarness({
      navigateOutline: () => true,
      resolveLspContext: () => ({ lspUri: POU, lineOffset: 1, lineWindow: { startLine: 1, endLineExclusive: 5 } }),
    })
    sendRequest.mockResolvedValue(document)

    const result = (await symbols.provideDocumentSymbols(model, token)) as monaco.languages.DocumentSymbol[]

    expect(result.map((s) => s.name)).toEqual(['Level', 'Enable'])
    expect(result.every((s) => s.range.startColumn < OUTLINE_TARGET_COLUMN_BASE)).toBe(true)
  })
})
