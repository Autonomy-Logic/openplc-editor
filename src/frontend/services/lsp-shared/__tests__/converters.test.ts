/**
 * @jest-environment jsdom
 */
import type * as monaco from 'monaco-editor'

import {
  lspCompletionListToMonaco,
  lspCompletionToMonaco,
  lspDiagnosticToMonaco,
  lspHoverToMonaco,
  lspLocationsToMonaco,
  lspPositionToMonaco,
  lspRangeToMonaco,
  lspSignatureHelpToMonaco,
  lspSymbolKindToMonaco,
  lspTextEditToMonaco,
  monacoPositionToLsp,
  monacoRangeToLsp,
} from '../converters'

// Minimal Monaco stub.  We only touch the bits the converters
// actually use — MarkerSeverity enum, Uri.parse, completion-rule
// enum.  Casting a literal shape into `typeof monaco` keeps the
// tests free of the full Monaco import (which doesn't load under
// jsdom without setup ceremony).
const monacoStub = {
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  Uri: {
    parse: (s: string) =>
      ({
        toString: () => s,
        scheme: s.split(':')[0] ?? '',
      }) as monaco.Uri,
  },
  languages: {
    CompletionItemInsertTextRule: { None: 0, InsertAsSnippet: 4 },
  },
} as unknown as typeof monaco

describe('position + range converters', () => {
  it('round-trips a Monaco position through LSP', () => {
    const mPos: monaco.IPosition = { lineNumber: 5, column: 12 }
    const lspPos = monacoPositionToLsp(mPos)
    expect(lspPos).toEqual({ line: 4, character: 11 })
    expect(lspPositionToMonaco(lspPos)).toEqual(mPos)
  })

  it('round-trips a Monaco range through LSP', () => {
    const mRange: monaco.IRange = {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 8,
    }
    const lspRange = monacoRangeToLsp(mRange)
    expect(lspRange).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 2, character: 7 },
    })
    expect(lspRangeToMonaco(lspRange)).toEqual(mRange)
  })
})

describe('lspDiagnosticToMonaco', () => {
  const baseRange = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 5 },
  }

  it('maps each LSP severity to the matching Monaco MarkerSeverity', () => {
    expect(lspDiagnosticToMonaco({ range: baseRange, message: 'e', severity: 1 }, monacoStub).severity).toBe(8) // Error
    expect(lspDiagnosticToMonaco({ range: baseRange, message: 'w', severity: 2 }, monacoStub).severity).toBe(4) // Warning
    expect(lspDiagnosticToMonaco({ range: baseRange, message: 'i', severity: 3 }, monacoStub).severity).toBe(2) // Info
    expect(lspDiagnosticToMonaco({ range: baseRange, message: 'h', severity: 4 }, monacoStub).severity).toBe(1) // Hint
    // Missing severity defaults to Error so user always sees the issue.
    expect(lspDiagnosticToMonaco({ range: baseRange, message: 'd' }, monacoStub).severity).toBe(8)
  })

  it('preserves message, source, and code when present', () => {
    const diag = {
      range: baseRange,
      message: 'expected identifier',
      severity: 1 as const,
      source: 'strucpp',
      code: 'E1234',
    }
    const marker = lspDiagnosticToMonaco(diag, monacoStub)
    expect(marker.message).toBe('expected identifier')
    expect(marker.source).toBe('strucpp')
    expect(marker.code).toBe('E1234')
  })

  it('defaults source to "lsp" when LSP omits it and no override is given', () => {
    const marker = lspDiagnosticToMonaco({ range: baseRange, message: 'x', severity: 1 }, monacoStub)
    expect(marker.source).toBe('lsp')
  })

  it('honours the defaultSource override when LSP omits the field', () => {
    const marker = lspDiagnosticToMonaco({ range: baseRange, message: 'x', severity: 1 }, monacoStub, 0, 'strucpp')
    expect(marker.source).toBe('strucpp')
  })
})

describe('lspCompletionToMonaco', () => {
  const defaultRange: monaco.IRange = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
  }

  it('uses item.label as insertText when no insertText/textEdit', () => {
    const result = lspCompletionToMonaco({ label: 'TIMER' }, defaultRange, monacoStub)
    expect(result.insertText).toBe('TIMER')
    expect(result.range).toEqual(defaultRange)
  })

  it('honors item.insertText over label', () => {
    const result = lspCompletionToMonaco({ label: 'TIMER', insertText: 'TIMER(IN := $0)' }, defaultRange, monacoStub)
    expect(result.insertText).toBe('TIMER(IN := $0)')
  })

  it('translates textEdit.range to Monaco range', () => {
    const result = lspCompletionToMonaco(
      {
        label: 'X',
        textEdit: {
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 8 },
          },
          newText: 'NEW',
        },
      },
      defaultRange,
      monacoStub,
    )
    expect(result.range).toEqual({
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 9,
    })
    expect(result.insertText).toBe('NEW')
  })

  it('marks the item as snippet when insertTextFormat is 2', () => {
    const result = lspCompletionToMonaco(
      { label: 'IF', insertText: 'IF $1 THEN\n  $0\nEND_IF', insertTextFormat: 2 },
      defaultRange,
      monacoStub,
    )
    expect(result.insertTextRules).toBe(4) // InsertAsSnippet
  })

  it('forwards detail, sortText, filterText, preselect when present', () => {
    const result = lspCompletionToMonaco(
      {
        label: 'TON',
        detail: 'FUNCTION_BLOCK',
        sortText: 'a-TON',
        filterText: 'TON',
        preselect: true,
      },
      defaultRange,
      monacoStub,
    )
    expect(result.detail).toBe('FUNCTION_BLOCK')
    expect(result.sortText).toBe('a-TON')
    expect(result.filterText).toBe('TON')
    expect(result.preselect).toBe(true)
  })

  it('unwraps MarkupContent documentation', () => {
    const result = lspCompletionToMonaco(
      {
        label: 'X',
        documentation: { kind: 'markdown', value: '**docs**' },
      },
      defaultRange,
      monacoStub,
    )
    expect(result.documentation).toBe('**docs**')
  })
})

describe('lspCompletionListToMonaco', () => {
  const defaultRange: monaco.IRange = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
  }

  it('returns empty suggestions for null', () => {
    expect(lspCompletionListToMonaco(null, defaultRange, monacoStub).suggestions).toEqual([])
  })

  it('handles a plain array', () => {
    const result = lspCompletionListToMonaco([{ label: 'A' }, { label: 'B' }], defaultRange, monacoStub)
    expect(result.suggestions.map((s) => s.label)).toEqual(['A', 'B'])
    expect(result.incomplete).toBe(false)
  })

  it('preserves the isIncomplete flag', () => {
    const result = lspCompletionListToMonaco({ isIncomplete: true, items: [{ label: 'A' }] }, defaultRange, monacoStub)
    expect(result.incomplete).toBe(true)
  })
})

describe('lspHoverToMonaco', () => {
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 4 },
  }

  it('returns null for null hover', () => {
    expect(lspHoverToMonaco(null)).toBeNull()
  })

  it('wraps a string content as a Monaco markdown segment', () => {
    const result = lspHoverToMonaco({ contents: 'x : INT' })
    expect(result?.contents).toEqual([{ value: 'x : INT' }])
  })

  it('wraps MarkedString with a language into a fenced block', () => {
    const result = lspHoverToMonaco({
      contents: { language: 'iec-st', value: 'VAR x : INT;' },
    })
    expect(result?.contents[0]?.value).toContain('```iec-st\n')
    expect(result?.contents[0]?.value).toContain('VAR x : INT;')
  })

  it('preserves range when present', () => {
    const result = lspHoverToMonaco({ contents: 'docs', range })
    expect(result?.range).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 5,
    })
  })
})

describe('lspLocationsToMonaco', () => {
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  }

  it('returns null for null input', () => {
    expect(lspLocationsToMonaco(null, monacoStub)).toBeNull()
  })

  it('wraps a single Location into an array', () => {
    const result = lspLocationsToMonaco(
      { uri: 'inmemory://pou/foo.st', range },
      monacoStub,
    ) as monaco.languages.Location[]
    expect(result).toHaveLength(1)
    expect(result[0].uri.toString()).toBe('inmemory://pou/foo.st')
  })

  it('handles an array of Locations', () => {
    const result = lspLocationsToMonaco(
      [
        { uri: 'inmemory://pou/a.st', range },
        { uri: 'inmemory://pou/b.st', range },
      ],
      monacoStub,
    ) as monaco.languages.Location[]
    expect(result.map((l) => l.uri.toString())).toEqual(['inmemory://pou/a.st', 'inmemory://pou/b.st'])
  })
})

describe('lspSymbolKindToMonaco', () => {
  it('returns a 0-indexed value (LSP-1)', () => {
    // LSP SymbolKind.Function = 12; Monaco SymbolKind.Function = 11.
    expect(lspSymbolKindToMonaco(12)).toBe(11)
  })
})

describe('lspTextEditToMonaco', () => {
  it('translates range + newText', () => {
    const edit = lspTextEditToMonaco({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      newText: 'NEW',
    })
    expect(edit.text).toBe('NEW')
    expect(edit.range).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 4,
    })
  })
})

describe('lspSignatureHelpToMonaco', () => {
  it('returns null for null input', () => {
    expect(lspSignatureHelpToMonaco(null)).toBeNull()
  })

  it('maps signatures + active indices', () => {
    const result = lspSignatureHelpToMonaco({
      signatures: [
        {
          label: 'TON(IN: BOOL; PT: TIME)',
          documentation: 'timer on-delay',
          parameters: [{ label: 'IN: BOOL' }, { label: 'PT: TIME' }],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    })
    expect(result?.signatures).toHaveLength(1)
    expect(result?.signatures[0].label).toContain('TON')
    expect(result?.activeParameter).toBe(1)
  })

  it('defaults active indices when LSP omits them', () => {
    const result = lspSignatureHelpToMonaco({
      signatures: [{ label: 'X', parameters: [] }],
    })
    expect(result?.activeSignature).toBe(0)
    expect(result?.activeParameter).toBe(0)
  })
})
