/**
 * @jest-environment jsdom
 */
import type { TextEdit as LspTextEdit } from 'vscode-languageserver-protocol'

import { clipEditsToWindow, lspLineInWindow, modelMatchesDocumentWindow } from '../internal/line-window'

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
