import type { EditorLike } from '@root/frontend/utils/save-project'
import type { TypeContext } from '@root/frontend/utils/PLC/variable-declarations'
import type { PLCPou } from '@root/middleware/shared/ports/types'

import {
  evaluateVariablesTextGate,
  type VariablesTextGateEntry,
  variablesTextGateStateFor,
} from '../variables-text-gate'

const UNCLOSED_COMMENT_BUFFER = 'VAR\n  bFirstScan : BOOL := TRUE; (* Executado (* ciclo 1 *)\n  Q1 AT %QX0.0 : BOOL;'
const MISSING_END_VAR = 'VAR\n  a : INT;\n  b : BOOL;'
const VALID_BLOCK = 'VAR\n  a : INT;\n  b : BOOL;\nEND_VAR'

const NO_LINE_REASON = (pouName: string) =>
  `The variables of "${pouName}" could not be loaded. Fix them in the variables code view.`

const entry = (
  pouName: string,
  text: string,
  source: VariablesTextGateEntry['source'] = 'code-view',
): VariablesTextGateEntry => ({ pouName, text, source })

const gate = (...entries: VariablesTextGateEntry[]) => evaluateVariablesTextGate({ entries, context: {} })

const pou = (name: string, over: Partial<PLCPou> = {}): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables: [] },
  body: { language: 'st', value: '' },
  ...over,
})

const codeView = (name: string, code: string | null): EditorLike => ({
  type: 'plc-textual',
  meta: { name },
  variable: { display: 'code', code },
})

const tableView = (name: string): EditorLike => ({
  type: 'plc-textual',
  meta: { name },
  variable: { display: 'table' },
})

describe('evaluateVariablesTextGate', () => {
  it('refuses an unclosed nested block comment, naming the POU and the line', () => {
    const verdict = gate(entry('main', UNCLOSED_COMMENT_BUFFER))

    expect(verdict).toMatchObject({ kind: 'refuse', pouName: 'main', line: 1 })
    if (verdict.kind !== 'refuse') return
    expect(verdict.reason).toMatch(/^The variables of "main" do not parse: line 1: .*Unclosed block comment/)
  })

  it('refuses a VAR block that never reaches END_VAR', () => {
    const verdict = gate(entry('main', MISSING_END_VAR))

    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.pouName).toBe('main')
    expect(typeof verdict.line).toBe('number')
    expect(verdict.reason).toMatch(/Expected `END_VAR`/)
    expect(verdict.reason.startsWith(`The variables of "main" do not parse: line ${verdict.line}: `)).toBe(true)
  })

  it('allows a block that parses', () => {
    expect(gate(entry('main', VALID_BLOCK))).toEqual({ kind: 'allow' })
  })

  it('allows a project with nothing to gate', () => {
    expect(gate()).toEqual({ kind: 'allow' })
  })

  it('refuses text the loader could not parse even when it parses now, without a line', () => {
    const verdict = gate(entry('main', VALID_BLOCK, 'unparsed'))

    expect(verdict).toEqual({ kind: 'refuse', pouName: 'main', reason: NO_LINE_REASON('main') })
  })

  it('reports the syntax error of unparsed text with its line', () => {
    const verdict = gate(entry('main', MISSING_END_VAR, 'unparsed'))

    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.reason).toMatch(/^The variables of "main" do not parse: line \d+: .*Expected `END_VAR`/)
    expect(typeof verdict.line).toBe('number')
  })

  it('names the first invalid POU in POU order', () => {
    const verdict = gate(
      entry('Alpha', VALID_BLOCK),
      entry('Bravo', MISSING_END_VAR),
      entry('Charlie', UNCLOSED_COMMENT_BUFFER),
    )

    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.pouName).toBe('Bravo')
    expect(verdict.reason).toMatch(/^The variables of "Bravo" /)
  })
})

describe('variablesTextGateStateFor', () => {
  it('takes the code-view buffer over the stored text, and the stored text only when it was not parsed', () => {
    const context: TypeContext = { isFunctionBlockType: () => false }
    const editors: Record<string, EditorLike> = {
      Buffered: codeView('Buffered', MISSING_END_VAR),
      Table: tableView('Table'),
      Cleared: codeView('Cleared', null),
    }

    const state = variablesTextGateStateFor({
      pous: [
        pou('Buffered', { variablesText: VALID_BLOCK, variablesTextUnparsed: true }),
        pou('Stored', { variablesText: MISSING_END_VAR, variablesTextUnparsed: true }),
        pou('Clean', { variablesText: VALID_BLOCK }),
        pou('Table', { variablesText: VALID_BLOCK }),
        pou('Cleared', { variablesText: VALID_BLOCK }),
        pou('Bare'),
      ],
      editorFor: (pouName) => editors[pouName],
      context,
    })

    expect(state.entries).toEqual([
      { pouName: 'Buffered', text: MISSING_END_VAR, source: 'code-view' },
      { pouName: 'Stored', text: MISSING_END_VAR, source: 'unparsed' },
    ])
    expect(state.context).toBe(context)
  })

  it('gates the stored text of an unparsed POU when there is no editor at all, as the CLI does', () => {
    const state = variablesTextGateStateFor({
      pous: [pou('main', { variablesText: MISSING_END_VAR, variablesTextUnparsed: true })],
      editorFor: () => undefined,
      context: {},
    })

    expect(evaluateVariablesTextGate(state)).toMatchObject({ kind: 'refuse', pouName: 'main' })
  })
})
