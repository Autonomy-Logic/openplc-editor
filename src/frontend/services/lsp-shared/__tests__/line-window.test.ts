/**
 * @jest-environment jsdom
 */
import type { DocumentSymbol as LspDocumentSymbol, TextEdit as LspTextEdit } from 'vscode-languageserver-protocol'

import {
  clipEditsToWindow,
  clipSymbolsToWindow,
  lspLineInWindow,
  modelMatchesDocumentWindow,
} from '../internal/line-window'

// `Motor` occupies lines 2..4 of the aggregate datatypes document, so
// its `.dt` view is windowed to [2, 5).
const MOTOR = { startLine: 2, endLineExclusive: 5 }

const edit = (startLine: number, endLine: number): LspTextEdit => ({
  range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: 4 } },
  newText: `${startLine}..${endLine}`,
})

describe('lspLineInWindow', () => {
  it('accepts every line when there is no window', () => {
    expect(lspLineInWindow(0)).toBe(true)
    expect(lspLineInWindow(9999)).toBe(true)
  })

  it('rejects the line the view TYPE frame translates onto', () => {
    // View line 1 with lineOffset 1 reaches aggregate line 1, the
    // previous entry (`Colors`).
    expect(lspLineInWindow(1, MOTOR)).toBe(false)
  })

  it('rejects the line the view END_TYPE frame translates onto', () => {
    expect(lspLineInWindow(5, MOTOR)).toBe(false)
  })

  it('accepts the entry own lines', () => {
    expect(lspLineInWindow(2, MOTOR)).toBe(true)
    expect(lspLineInWindow(3, MOTOR)).toBe(true)
    expect(lspLineInWindow(4, MOTOR)).toBe(true)
  })
})

describe('clipEditsToWindow', () => {
  it('keeps every edit when there is no window', () => {
    const edits = [edit(0, 0), edit(7, 9)]
    expect(clipEditsToWindow(edits)).toEqual(edits)
  })

  it('keeps edits fully inside the window', () => {
    const inside = edit(2, 4)
    expect(clipEditsToWindow([inside], MOTOR)).toEqual([inside])
  })

  it('drops edits for the rest of the document', () => {
    expect(clipEditsToWindow([edit(0, 0), edit(5, 5), edit(6, 8)], MOTOR)).toEqual([])
  })

  it('drops an edit straddling the window end rather than truncating it', () => {
    expect(clipEditsToWindow([edit(4, 5)], MOTOR)).toEqual([])
  })

  it('drops an edit starting before the window', () => {
    expect(clipEditsToWindow([edit(1, 3)], MOTOR)).toEqual([])
  })

  it('keeps a whole-last-line edit ending at {endLineExclusive, 0}, clamped inside the window', () => {
    // LSP ranges are end-exclusive: line 4 plus its newline ends at {5, 0}.
    const boundary: LspTextEdit = {
      range: { start: { line: 4, character: 0 }, end: { line: 5, character: 0 } },
      newText: '  END_STRUCT;\n',
    }
    expect(clipEditsToWindow([boundary], MOTOR)).toEqual([
      {
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: Number.MAX_SAFE_INTEGER } },
        newText: '  END_STRUCT;',
      },
    ])
  })

  it('still drops a boundary edit reaching into the next line content', () => {
    const intoNextLine: LspTextEdit = {
      range: { start: { line: 4, character: 0 }, end: { line: 5, character: 3 } },
      newText: 'anything',
    }
    expect(clipEditsToWindow([intoNextLine], MOTOR)).toEqual([])
  })
})

describe('clipSymbolsToWindow', () => {
  // strucpp answers DocumentSymbol[]: one top-level entry per type in the
  // aggregate datatypes document, one per POU in a `pou://` document with
  // its VAR declarations as children.
  const symbol = (
    name: string,
    startLine: number,
    endLine: number,
    children?: LspDocumentSymbol[],
  ): LspDocumentSymbol => {
    const range = { start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 } }
    return { name, kind: 13, range, selectionRange: range, children }
  }

  const COLORS = symbol('Colors', 1, 1)
  const MOTOR_SYMBOL = symbol('Motor', 2, 4, [symbol('speed', 3, 3)])
  const AGGREGATE = [COLORS, MOTOR_SYMBOL]

  it('keeps every symbol when there is no window', () => {
    expect(clipSymbolsToWindow(AGGREGATE)).toEqual(AGGREGATE)
  })

  it('keeps only the entry the .dt view renders', () => {
    expect(clipSymbolsToWindow(AGGREGATE, MOTOR)).toEqual([MOTOR_SYMBOL])
  })

  it('keeps a matching entry whole, children included', () => {
    expect(clipSymbolsToWindow(AGGREGATE, MOTOR)[0].children).toEqual([symbol('speed', 3, 3)])
  })

  it('lifts the children of a POU enclosing the variables window', () => {
    const pou = symbol('main', 0, 11, [symbol('State', 2, 2), symbol('Enable', 3, 3), symbol('body_local', 7, 7)])
    expect(clipSymbolsToWindow([pou], { startLine: 1, endLineExclusive: 5 })).toEqual([
      symbol('State', 2, 2),
      symbol('Enable', 3, 3),
    ])
  })

  it('drops an enclosing symbol whose children all sit outside', () => {
    const pou = symbol('main', 0, 11, [symbol('body_local', 7, 7)])
    expect(clipSymbolsToWindow([pou], { startLine: 1, endLineExclusive: 5 })).toEqual([])
  })

  it('drops entries that end before the window', () => {
    expect(clipSymbolsToWindow([COLORS], MOTOR)).toEqual([])
  })

  it('drops entries that start past the window', () => {
    expect(clipSymbolsToWindow([symbol('Later', 6, 8)], MOTOR)).toEqual([])
  })

  it('drops a preamble symbol when the window is the body editor bound', () => {
    // A body editor has no explicit window: the provider bounds it by the
    // preamble the model never renders, so `lineOffset` is the window start.
    const pou = symbol('main', 0, 11, [symbol('State', 2, 2), symbol('Enable', 3, 3)])
    const bodyBound = { startLine: 5, endLineExclusive: Number.MAX_SAFE_INTEGER }
    expect(clipSymbolsToWindow([pou], bodyBound)).toEqual([])
  })

  it('keeps everything when the body editor has no preamble', () => {
    const pou = symbol('main', 0, 11, [symbol('State', 2, 2)])
    const noPreamble = { startLine: 0, endLineExclusive: Number.MAX_SAFE_INTEGER }
    expect(clipSymbolsToWindow([pou], noPreamble)).toEqual([pou])
  })
})

describe('modelMatchesDocumentWindow', () => {
  // pou:// document: declaration line 0, VAR block lines 1..6, body after.
  const POU_DOC = [
    'FUNCTION_BLOCK FB0',
    'VAR',
    '  State : enum_dt := idle;',
    '  Enable : BOOL := FALSE;',
    'END_VAR',
    'ST body line;',
  ].join('\n')
  const VARS_WINDOW = { startLine: 1, endLineExclusive: 5 }
  const PRISTINE_VARS = ['VAR', '  State : enum_dt := idle;', '  Enable : BOOL := FALSE;', 'END_VAR'].join('\n')

  it('matches a pristine pouvars buffer', () => {
    expect(modelMatchesDocumentWindow(PRISTINE_VARS, POU_DOC, 1, VARS_WINDOW)).toBe(true)
  })

  it('rejects a buffer that drifted from the document (reformatted indent)', () => {
    const drifted = PRISTINE_VARS.replace('  State', '    State')
    expect(modelMatchesDocumentWindow(drifted, POU_DOC, 1, VARS_WINDOW)).toBe(false)
  })

  it('matches a dt view whose frame lines sit outside the window', () => {
    // Aggregate doc: TYPE / Colors / Motor.. / END_TYPE; Motor.dt renders
    // its own frames around the entry, offset = span.start - 1.
    const aggregate = [
      'TYPE',
      '  Colors : (RED) := RED;',
      '  Motor : STRUCT',
      '    speed : INT;',
      '  END_STRUCT;',
      'END_TYPE',
    ].join('\n')
    const motorView = ['TYPE', '  Motor : STRUCT', '    speed : INT;', '  END_STRUCT;', 'END_TYPE'].join('\n')
    expect(modelMatchesDocumentWindow(motorView, aggregate, 1, { startLine: 2, endLineExclusive: 5 })).toBe(true)
  })

  it('normalises CRLF in the model buffer', () => {
    expect(modelMatchesDocumentWindow(PRISTINE_VARS.replace(/\n/g, '\r\n'), POU_DOC, 1, VARS_WINDOW)).toBe(true)
  })

  it('rejects when the window start precedes the model frame', () => {
    expect(modelMatchesDocumentWindow(PRISTINE_VARS, POU_DOC, 5, { startLine: 1, endLineExclusive: 5 })).toBe(false)
  })
})
