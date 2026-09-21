/**
 * A table edit must not cost the user their text (DOPE-650).
 *
 * The rule every test here checks is the same one: the declaration text is the
 * source of truth, so editing a variable changes the bytes that describe that
 * variable and nothing else. Comments, blank lines, indentation and the order
 * of untouched declarations all survive.
 *
 * The old behaviour was a single `generateIecVariablesToString` over the whole
 * model, so the first cell edit after typing a comment deleted it.
 */

import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { buildScanContext } from '../generate-iec-string-to-variables'
import { scanVariableDeclarations } from '../variable-declaration-scanner'
import { applyVariablesToText } from '../variable-text-edits'

const context = buildScanContext()

const apply = (text: string, variables: PLCVariable[]) => applyVariablesToText(text, variables, context)

/** The model the text currently describes — what the store would be holding. */
const modelOf = (text: string): PLCVariable[] => {
  const result = scanVariableDeclarations(text, context)
  expect(result.errors).toEqual([])
  return result.variables
}

const edit = (variables: PLCVariable[], name: string, patch: Partial<PLCVariable>): PLCVariable[] =>
  variables.map((variable) => (variable.name === name ? { ...variable, ...patch } : variable))

const RICH = `VAR
  (* --- counters --- *)

  counter : INT := 0;    (* how many times *)
  // a line comment of its own
  total   : DINT;
END_VAR`

describe('an edit leaves everything it did not touch alone', () => {
  it('renames a variable without disturbing comments or alignment', () => {
    const out = apply(RICH, edit(modelOf(RICH), 'counter', { name: 'tally' }))

    expect(out).toContain('(* --- counters --- *)')
    expect(out).toContain('// a line comment of its own')
    expect(out).toContain('tally : INT := 0;    (* how many times *)')
    expect(out).toContain('total   : DINT;')
    // The blank line the user left under the section header is still there.
    expect(out).toContain('--- counters --- *)\n\n')
  })

  it('changes a type in place', () => {
    const out = apply(RICH, edit(modelOf(RICH), 'total', { type: { definition: 'base-type', value: 'LINT' } }))
    expect(out).toContain('total   : LINT;')
    expect(out).toContain('counter : INT := 0;')
    expect(out).toContain('// a line comment of its own')
  })

  it('adds a location to a declaration that had none', () => {
    const out = apply(RICH, edit(modelOf(RICH), 'total', { location: '%MD0' }))
    expect(out).toContain('total   : DINT AT %MD0;')
  })

  it('changes an existing location, including to an alias with a space', () => {
    const text = 'VAR\n  a : BOOL AT %QX0.0; (* keep me *)\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { location: 'Motor Start' }))
    expect(out).toBe('VAR\n  a : BOOL AT Motor Start; (* keep me *)\nEND_VAR')
  })

  it('removes a location, taking the AT keyword with it', () => {
    const text = 'VAR\n  a : BOOL AT %QX0.0;\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { location: '' }))
    expect(out).toBe('VAR\n  a : BOOL;\nEND_VAR')
  })

  it('removes an initial value, taking the := with it', () => {
    const text = 'VAR\n  a : INT := 7;\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { initialValue: null }))
    expect(out).toBe('VAR\n  a : INT;\nEND_VAR')
  })

  it('adds an initial value where there was none', () => {
    const text = 'VAR\n  a : INT;\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { initialValue: '7' }))
    expect(out).toBe('VAR\n  a : INT := 7;\nEND_VAR')
  })

  it('edits documentation inside the comment the user wrote', () => {
    const text = 'VAR\n  a : INT; (* old text *)\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { documentation: 'new text' }))
    expect(out).toBe('VAR\n  a : INT; (* new text *)\nEND_VAR')
  })

  it('keeps a // documentation comment in its own syntax when edited', () => {
    // Rewriting it to `(* … *)` would be the tool editing the user's style.
    const text = 'VAR\n  a : INT; // old text\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { documentation: 'new text' }))
    expect(out).toBe('VAR\n  a : INT; // new text\nEND_VAR')
  })

  it('adds documentation where there was none', () => {
    const text = 'VAR\n  a : INT;\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { documentation: 'explained' }))
    expect(out).toBe('VAR\n  a : INT; (* explained *)\nEND_VAR')
  })
})

describe('adding and removing declarations', () => {
  it('inserts a new variable before END_VAR, at the block indentation', () => {
    const model = modelOf(RICH)
    const out = apply(RICH, [
      ...model,
      {
        name: 'extra',
        class: 'local',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        documentation: '',
      },
    ])

    expect(out).toContain('  extra : BOOL;\n')
    expect(out).toContain('(* --- counters --- *)')
    expect(out).toContain('// a line comment of its own')
    expect(out.indexOf('extra')).toBeLessThan(out.indexOf('END_VAR'))
  })

  it('opens a new block when the class has none yet', () => {
    const model = modelOf(RICH)
    const out = apply(RICH, [
      ...model,
      {
        name: 'inbound',
        class: 'input',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        documentation: '',
      },
    ])

    expect(out).toContain('VAR_INPUT')
    expect(out).toContain('inbound : BOOL;')
    expect(out).toContain('(* --- counters --- *)')
  })

  it('deletes a declaration without leaving a blank line', () => {
    const model = modelOf(RICH)
    const out = apply(
      RICH,
      model.filter((variable) => variable.name !== 'counter'),
    )

    expect(out).not.toContain('counter :')
    // The section header survives — it is the user's, not the variable's.
    expect(out).toContain('(* --- counters --- *)')
    expect(out).toContain('total   : DINT;')
    expect(out).toContain('// a line comment of its own')
    // Its trailing documentation went with it.
    expect(out).not.toContain('how many times')
  })

  it('reorders declarations by moving whole lines', () => {
    const text = 'VAR\n  a : INT;\n  b : INT;\n  c : INT;\nEND_VAR'
    const model = modelOf(text)
    const out = apply(text, [model[2], model[0], model[1]])
    expect(out).toBe('VAR\n  c : INT;\n  a : INT;\n  b : INT;\nEND_VAR')
  })

  it('leaves a standalone comment where it is when declarations move around it', () => {
    const text = 'VAR\n  a : INT;\n  (* pinned *)\n  b : INT;\nEND_VAR'
    const model = modelOf(text)
    const out = apply(text, [model[1], model[0]])
    expect(out).toContain('(* pinned *)')
    expect(out.indexOf('b : INT;')).toBeLessThan(out.indexOf('a : INT;'))
  })
})

describe('round-trip stability', () => {
  it('returns the text byte for byte when nothing changed', () => {
    expect(apply(RICH, modelOf(RICH))).toBe(RICH)
  })

  it('stays stable across repeated no-op applications', () => {
    const once = apply(RICH, modelOf(RICH))
    expect(apply(once, modelOf(once))).toBe(RICH)
  })

  it('keeps the model intact after a patch', () => {
    // The patched text must still describe exactly what was asked for —
    // otherwise the table and the text have drifted, which is the bug.
    const next = edit(modelOf(RICH), 'counter', { name: 'tally', location: 'Motor Start', documentation: 'renamed' })
    const reparsed = modelOf(apply(RICH, next))

    expect(reparsed.map((v) => v.name)).toEqual(['tally', 'total'])
    expect(reparsed[0].location).toBe('Motor Start')
    expect(reparsed[0].documentation).toBe('renamed')
    expect(reparsed[0].initialValue).toBe('0')
  })

  it('falls back to a canonical serialisation only when the text cannot be scanned', () => {
    const broken = 'VAR\n  (* unterminated\n  a : INT;\nEND_VAR'
    const out = applyVariablesToText(
      broken,
      [{ name: 'a', class: 'local', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' }],
      context,
    )
    expect(out).toContain('a : INT;')
    expect(out).not.toContain('unterminated')
  })
})
