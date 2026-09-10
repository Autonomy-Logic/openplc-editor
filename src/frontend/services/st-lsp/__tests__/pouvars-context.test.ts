/**
 * @jest-environment jsdom
 */
import type { Diagnostic } from 'vscode-languageserver-protocol'

import { diagnosticsInVarBlocks, pouVarsTokenViewport, pouVarsWindow } from '../pouvars-context'

// Synthesized POU document, LSP (0-indexed) lines:
//   0  PROGRAM main
//   1  VAR
//   2    Level : INT;
//   3    Enable : BOOL;
//   4  END_VAR
//   5  Level := 1;          ← body starts here, so bodyLineOffset = 5
const POU_DOC = ['PROGRAM main', 'VAR', '  Level : INT;', '  Enable : BOOL;', 'END_VAR', 'Level := 1;'].join('\n')
const PRISTINE_VARS = ['VAR', '  Level : INT;', '  Enable : BOOL;', 'END_VAR'].join('\n')
const BODY_LINE = 5
const VAR_LINES = [1, 2, 3, 4]
const EMPTY = { startLine: 0, endLineExclusive: 0 }

const diagnosticAt = (line: number): Diagnostic => ({
  range: { start: { line, character: 0 }, end: { line, character: 4 } },
  message: `line ${line}`,
})

describe('pouVarsWindow', () => {
  it('covers the VAR blocks between the declaration line and the body', () => {
    expect(pouVarsWindow(BODY_LINE)).toEqual({ startLine: 1, endLineExclusive: 5 })
  })

  it('is null while the body line is unregistered — an unpopulated registry reads 0', () => {
    expect(pouVarsWindow(0)).toBeNull()
  })

  it('is null for a document with no VAR block at all', () => {
    expect(pouVarsWindow(1)).toBeNull()
  })
})

describe('diagnosticsInVarBlocks', () => {
  it('keeps what falls inside the VAR blocks', () => {
    const inside = [diagnosticAt(1), diagnosticAt(4)]
    expect(diagnosticsInVarBlocks([diagnosticAt(0), ...inside, diagnosticAt(5)], BODY_LINE)).toEqual(inside)
  })

  it('drops the declaration line and the body', () => {
    expect(diagnosticsInVarBlocks([diagnosticAt(0), diagnosticAt(5), diagnosticAt(9)], BODY_LINE)).toEqual([])
  })

  it('returns nothing while the body line is unregistered', () => {
    expect(diagnosticsInVarBlocks([diagnosticAt(2)], 0)).toEqual([])
  })
})

describe('pouVarsTokenViewport', () => {
  it('keeps every VAR line of a pristine buffer', () => {
    const viewport = pouVarsTokenViewport(PRISTINE_VARS, POU_DOC, BODY_LINE)
    expect(viewport).toMatchObject({ startLine: 1, endLineExclusive: 5 })
    expect(VAR_LINES.map((line) => viewport.keepLine?.(line))).toEqual([true, true, true, true])
  })

  it('blanks only the lines an uncommitted edit moved', () => {
    const edited = PRISTINE_VARS.replace('  Level : INT;', '  Level : INT;\n  Count : INT;')
    const viewport = pouVarsTokenViewport(edited, POU_DOC, BODY_LINE)
    expect(VAR_LINES.map((line) => viewport.keepLine?.(line))).toEqual([true, true, false, false])
  })

  it('is empty while the body line is unregistered', () => {
    expect(pouVarsTokenViewport(PRISTINE_VARS, POU_DOC, 0)).toEqual(EMPTY)
  })

  it('is empty when the model or the synced document is missing', () => {
    expect(pouVarsTokenViewport(undefined, POU_DOC, BODY_LINE)).toEqual(EMPTY)
    expect(pouVarsTokenViewport(PRISTINE_VARS, undefined, BODY_LINE)).toEqual(EMPTY)
  })
})
