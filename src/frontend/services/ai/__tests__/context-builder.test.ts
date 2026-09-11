/**
 * The FIM context is everything the completion model is told about the code it
 * is completing. The editor shows only a POU's body, so this module synthesizes
 * the wrapper around it — the declaration header before the cursor and the
 * closing keyword after it. Get either wrong and the model writes a second
 * PROGRAM header into the body, or keeps generating past the end of the POU.
 *
 * The real store is seeded rather than mocked (the module reads it directly)
 * and the real context collector runs, so nothing here mocks a module and the
 * file runs under jest (editor) and vitest (web) alike.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'
import type * as monaco from 'monaco-editor'

import type { PLCPou, PLCVariable } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { buildFIMContext } from '../context-builder'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Monaco's `ITextModel` has well over a hundred members; a fake that satisfies
 * the whole interface would be pure noise. Only `getValue` and `getOffsetAt`
 * are read here, so the assertion is confined to this one helper.
 */
function makeModel(text: string): monaco.editor.ITextModel {
  const model = {
    getValue: () => text,
    getOffsetAt: (pos: { lineNumber: number; column: number }) => {
      const lines = text.split('\n')
      let offset = 0
      for (let i = 0; i < pos.lineNumber - 1; i++) offset += lines[i].length + 1
      return offset + pos.column - 1
    },
  }
  return model as unknown as monaco.editor.ITextModel
}

/** Same reasoning as `makeModel`: `Position` is a class, only two fields read. */
function makePosition(lineNumber: number, column: number): monaco.Position {
  return { lineNumber, column } as unknown as monaco.Position
}

function makeVariable(name: string, type = 'INT', cls: PLCVariable['class'] = 'local'): PLCVariable {
  return { name, class: cls, type: { definition: 'base-type', value: type }, location: '', documentation: '' }
}

function makePou(name: string, pouType: PLCPou['pouType'] = 'program', vars: PLCVariable[] = []): PLCPou {
  return {
    name,
    pouType,
    interface: { variables: vars },
    body: { language: 'st', value: '' },
    documentation: '',
  }
}

function seedPous(pous: PLCPou[]): void {
  const current = openPLCStoreBase.getState().project
  openPLCStoreBase.getState().projectActions.setProject({
    ...current,
    data: {
      ...current.data,
      pous,
      dataTypes: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
  })
}

beforeEach(() => {
  seedPous([makePou('Main')])
})

// ---------------------------------------------------------------------------
// Prefix / suffix extraction
// ---------------------------------------------------------------------------

describe('buildFIMContext', () => {
  it('splits the document at the cursor into prefix and suffix', () => {
    const ctx = buildFIMContext(makeModel('line one\nline two\nline three'), makePosition(2, 5), 'Main', 'st')

    expect(ctx.prefix.endsWith('line one\nline')).toBe(true)
    expect(ctx.suffix).toBe(' two\nline three')
    expect(ctx.language).toBe('st')
  })

  it('caps the code prefix so a long POU cannot crowd out the synthetic header', () => {
    // The header is the only thing telling the model what POU it is inside; it
    // is charged against the same budget and must survive a 10k-character body.
    const text = 'x'.repeat(10_000)

    const ctx = buildFIMContext(makeModel(text), makePosition(1, 10_001), 'Main', 'st')

    expect(ctx.prefix).toContain('PROGRAM Main')
    expect(ctx.prefix.length).toBe(3000)
  })

  it('caps the suffix so a long tail cannot crowd out the request', () => {
    const text = `head${'y'.repeat(5000)}`

    const ctx = buildFIMContext(makeModel(text), makePosition(1, 5), 'Main', 'st')

    expect(ctx.suffix.length).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// Synthetic POU header
// ---------------------------------------------------------------------------

describe('synthetic header', () => {
  it('declares the POU and its variables ahead of the ST body', () => {
    seedPous([makePou('Main', 'program', [makeVariable('speed'), makeVariable('running', 'BOOL', 'output')])])

    const ctx = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'st')

    expect(ctx.prefix).toContain('PROGRAM Main')
    expect(ctx.prefix).toContain('VAR_OUTPUT\n  running : BOOL;\nEND_VAR')
    expect(ctx.prefix).toContain('VAR\n  speed : INT;\nEND_VAR')
  })

  it.each([
    ['function', 'FUNCTION Scale'],
    ['function-block', 'FUNCTION_BLOCK Scale'],
  ] as const)('uses the %s keyword so the model writes a body of the right kind', (pouType, expected) => {
    seedPous([makePou('Scale', pouType)])

    expect(buildFIMContext(makeModel('x'), makePosition(1, 2), 'Scale', 'st').prefix).toContain(expected)
  })

  it('uses the same IEC header for IL as for ST', () => {
    expect(buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'il').prefix).toContain('PROGRAM Main')
  })

  it('writes a Python comment header instead of IEC syntax', () => {
    // An IEC header in a Python POU would be read as code and the model would
    // continue in the wrong language.
    seedPous([makePou('Script', 'program', [makeVariable('speed')])])

    const ctx = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Script', 'python')

    expect(ctx.prefix).toContain('# POU: Script (program)')
    expect(ctx.prefix).toContain('#   speed: INT')
    expect(ctx.prefix).not.toContain('PROGRAM')
  })

  it('writes a C++ comment header instead of IEC syntax', () => {
    seedPous([makePou('Driver', 'program', [makeVariable('speed')])])

    const ctx = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Driver', 'cpp')

    expect(ctx.prefix).toContain('// POU: Driver (program)')
    expect(ctx.prefix).toContain('//   speed: INT')
  })

  it.each(['python', 'cpp'] as const)('omits the %s variable list when the POU declares none', (language) => {
    const ctx = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', language)

    expect(ctx.prefix).not.toContain('speed')
    expect(ctx.prefix.endsWith('\n\nx')).toBe(true)
  })

  it('prepends nothing when the POU is not in the project', () => {
    // A stale editor can outlive its POU; the completion must still work off
    // the raw text rather than claiming a POU that no longer exists.
    const ctx = buildFIMContext(makeModel('x := 1;'), makePosition(1, 8), 'Deleted', 'st')

    expect(ctx.prefix).toBe('x := 1;')
  })
})

// ---------------------------------------------------------------------------
// Synthetic closing boundary
// ---------------------------------------------------------------------------

describe('synthetic suffix', () => {
  it.each([
    ['program', 'END_PROGRAM'],
    ['function', 'END_FUNCTION'],
    ['function-block', 'END_FUNCTION_BLOCK'],
  ] as const)('closes a %s with its own keyword when the cursor is at the end', (pouType, endKeyword) => {
    // Without a boundary the model keeps generating past the end of the POU.
    seedPous([makePou('Target', pouType)])

    const ctx = buildFIMContext(makeModel('x := 1;'), makePosition(1, 8), 'Target', 'st')

    expect(ctx.suffix).toBe(`\n\n${endKeyword}`)
  })

  it('leaves a blank line between the cursor and the boundary keyword', () => {
    // With the keyword flush against the cursor the span reads as already
    // closed and the model returns an empty completion — most visibly right
    // after a trailing comment line.
    const ctx = buildFIMContext(makeModel('(* do the thing *)\n'), makePosition(2, 1), 'Main', 'st')

    expect(ctx.suffix.startsWith('\n\n')).toBe(true)
  })

  it.each([
    ['python', '\n\n# END POU'],
    ['cpp', '\n\n// END POU'],
  ] as const)('closes a %s POU with a comment boundary', (language, expected) => {
    expect(buildFIMContext(makeModel('x = 1'), makePosition(1, 6), 'Main', language).suffix).toBe(expected)
  })

  it('leaves the suffix empty when the POU behind it is gone', () => {
    expect(buildFIMContext(makeModel('x := 1;'), makePosition(1, 8), 'Deleted', 'st').suffix).toBe('')
  })

  it('leaves real trailing code alone instead of appending a boundary', () => {
    const ctx = buildFIMContext(makeModel('a := 1;\nb := 2;'), makePosition(1, 8), 'Main', 'st')

    expect(ctx.suffix).toBe('\nb := 2;')
  })
})

// ---------------------------------------------------------------------------
// Project-context cache
// ---------------------------------------------------------------------------

describe('project context', () => {
  it('describes the surrounding project, not just the current POU', () => {
    seedPous([makePou('Main', 'program', [makeVariable('speed')]), makePou('Helper')])

    const ctx = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'st')

    expect(ctx.projectContext).toContain('Current POU: Main [program]')
    expect(ctx.projectContext).toContain('PROGRAM Helper')
  })

  it('reuses the collected context across keystrokes while the project is unchanged', () => {
    // Every keystroke calls this; re-walking the project each time is the cost
    // the single-entry cache exists to avoid.
    const first = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'st')
    const second = buildFIMContext(makeModel('xy'), makePosition(1, 3), 'Main', 'st')

    expect(second.projectContext).toBe(first.projectContext)
  })

  it('recollects once the project changes, so a deleted variable cannot linger', () => {
    seedPous([makePou('Main', 'program', [makeVariable('speed')])])
    const before = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'st')
    expect(before.projectContext).toContain('speed')

    seedPous([makePou('Main', 'program', [makeVariable('torque')])])
    const after = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'st')

    expect(after.projectContext).toContain('torque')
    expect(after.projectContext).not.toContain('speed')
  })

  it('recollects when the POU changes, so one editor cannot serve another’s context', () => {
    seedPous([makePou('Main', 'program', [makeVariable('speed')]), makePou('Helper', 'program', [makeVariable('t')])])
    const main = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'st')

    const helper = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Helper', 'st')

    expect(main.projectContext).toContain('Current POU: Main')
    expect(helper.projectContext).toContain('Current POU: Helper')
  })

  it('recollects when the language changes, so ST syntax cannot leak into a Python request', () => {
    seedPous([makePou('Main', 'program', [makeVariable('speed')])])
    buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'st')

    const python = buildFIMContext(makeModel('x'), makePosition(1, 2), 'Main', 'python')

    expect(python.projectContext).toContain('# Current POU: Main [program]')
  })
})
