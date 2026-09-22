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
import { buildTypeContext } from '../generate-iec-string-to-variables'
import { parseVariableDeclarations } from '../PLC/variable-declarations'
import { applyVariablesToText, resolveLocationsInText } from '../variable-text-edits'

const context = buildTypeContext()

const apply = (text: string, variables: PLCVariable[]) => applyVariablesToText(text, variables, context)

/** The model the text currently describes — what the store would be holding. */
const modelOf = (text: string): PLCVariable[] => {
  const result = parseVariableDeclarations(text, context)
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

  it('leaves a lower-case type name as the user wrote it', () => {
    // The parser canonicalises `bool` to `BOOL` in the model, so comparing the
    // two exactly made every declaration written in lower case an edit — the
    // project was retyped just by being opened, and the first save wrote that
    // back to the user's file.
    const text = 'VAR\n\tflag : bool;\n\tcount : int := 0;\nEND_VAR'
    expect(apply(text, modelOf(text))).toBe(text)
  })

  it('still rewrites the type when it actually changed', () => {
    const text = 'VAR\n\tflag : bool;\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'flag', { type: { definition: 'base-type', value: 'DINT' } }))
    expect(out).toBe('VAR\n\tflag : DINT;\nEND_VAR')
  })

  it('adds a location to a declaration that had none', () => {
    const out = apply(RICH, edit(modelOf(RICH), 'total', { location: '%MD0' }))
    expect(out).toContain('total   : DINT AT %MD0;')
  })

  it('changes an existing location to an alias', () => {
    const text = 'VAR\n  a : BOOL AT %QX0.0; (* keep me *)\nEND_VAR'
    const out = apply(text, edit(modelOf(text), 'a', { location: 'Motor_Start' }))
    expect(out).toBe('VAR\n  a : BOOL AT Motor_Start; (* keep me *)\nEND_VAR')
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

describe('a declaration must never take its neighbour with it', () => {
  // Every case here deleted a variable the user had not touched. They are the
  // reason DOPE-650's own machinery could not be trusted: the table said one
  // thing, the file said another, and the file is what ships.

  it('deletes only the named variable when a line comment mentions a block opener', () => {
    // `(*` inside a `//` comment was read as a block-comment opener, and the
    // hunt for its `*)` ran into the next declaration — which then sat inside
    // the first one's line span.
    const text = 'VAR\n  a : INT; // see (* note\n  b : INT; (* real *)\nEND_VAR'
    expect(
      apply(
        text,
        modelOf(text).filter((variable) => variable.name !== 'a'),
      ),
    ).toBe('VAR\n  b : INT; (* real *)\nEND_VAR')
  })

  it('reads the documentation of a line comment that mentions a block opener', () => {
    const text = 'VAR\n  a : INT; // use (* literal *)\nEND_VAR'
    expect(modelOf(text)[0].documentation).toBe('use (* literal *)')
  })

  it('still takes a genuine multi-line trailing block comment with the declaration', () => {
    const text = 'VAR\n  a : INT; (* long\n     explanation *)\n  b : INT;\nEND_VAR'
    expect(modelOf(text)[0].documentation).toBe('long\n     explanation')
    expect(
      apply(
        text,
        modelOf(text).filter((variable) => variable.name !== 'a'),
      ),
    ).toBe('VAR\n  b : INT;\nEND_VAR')
  })

  it('keeps the survivor when one of two co-declared names is deleted', () => {
    // `a, b : INT;` is one declaration and two variables, so both shared its
    // line span and deleting either blanked the line.
    const text = 'VAR\n  a, b : INT;\nEND_VAR'
    expect(
      apply(
        text,
        modelOf(text).filter((variable) => variable.name !== 'a'),
      ),
    ).toBe('VAR\n  b : INT;\nEND_VAR')
  })

  it('normalises a co-declared line to one variable per line, keeping its comment', () => {
    const text = 'VAR\n  a, b : INT; (* both *)\nEND_VAR'
    expect(apply(text, modelOf(text))).toBe('VAR\n  a : INT; (* both *)\n  b : INT; (* both *)\nEND_VAR')
  })
})

describe('a class change is a move, not an edit', () => {
  it('moves the declaration into the block of its new class', () => {
    // Matched by name to its OLD declaration, the change was applied as a field
    // edit — and no field on the line carries the class, so the declaration
    // stayed in `VAR` and the class silently reverted on the next load.
    const text = 'VAR\n  a : INT;\nEND_VAR\nVAR_OUTPUT\n  q : BOOL;\nEND_VAR'
    const out = apply(
      text,
      modelOf(text).map((variable) => (variable.name === 'a' ? { ...variable, class: 'output' as const } : variable)),
    )
    expect(modelOf(out).map((variable) => `${variable.name}:${variable.class}`)).toEqual(['a:output', 'q:output'])
  })
})

describe('clearing a clause whose operand starts with its keyword', () => {
  it('removes the whole AT clause when the alias begins with "AT"', () => {
    // `lastIndexOf('AT', operand.start)` matched the alias's own first two
    // letters, so only the operand went and `x : BOOL AT;` was written to disk.
    const text = 'VAR\n  x : BOOL AT ATTIC_LIGHT;\nEND_VAR'
    expect(
      apply(
        text,
        modelOf(text).map((variable) => ({ ...variable, location: '' })),
      ),
    ).toBe('VAR\n  x : BOOL;\nEND_VAR')
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
    const next = edit(modelOf(RICH), 'counter', { name: 'tally', location: 'Motor_Start', documentation: 'renamed' })
    const reparsed = modelOf(apply(RICH, next))

    expect(reparsed.map((v) => v.name)).toEqual(['tally', 'total'])
    expect(reparsed[0].location).toBe('Motor_Start')
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

describe('resolveLocationsInText, for the LSP stub', () => {
  const aliases = new Map([
    ['Motor_Start', '%IX0.0'],
    ['relay_1', '%QX0.1'],
  ])
  const resolve = (location: string) => (location.startsWith('%') ? location : (aliases.get(location) ?? ''))

  it('swaps an alias for its address and leaves everything else alone', () => {
    const text = 'VAR\n  (* keep me *)\n  start : BOOL AT Motor_Start; (* and me *)\nEND_VAR'
    const out = resolveLocationsInText(text, resolve, context)

    expect(out).toBe('VAR\n  (* keep me *)\n  start : BOOL AT %IX0.0; (* and me *)\nEND_VAR')
  })

  it('passes a literal address through untouched', () => {
    const text = 'VAR\n  a : BOOL AT %QX0.0;\nEND_VAR'
    expect(resolveLocationsInText(text, resolve, context)).toBe(text)
  })

  it('drops the AT clause for an alias no producer declares any more', () => {
    // An orphaned alias resolves to nothing at compile time; leaving `AT` with
    // a dangling operand would break the VAR block for strucpp and take every
    // symbol after it out of scope.
    const text = 'VAR\n  a : BOOL AT Ghost_Alias;\nEND_VAR'
    expect(resolveLocationsInText(text, resolve, context)).toBe('VAR\n  a : BOOL;\nEND_VAR')
  })

  it('never changes the line count', () => {
    // `bodyLineOffset` and the pouvars diagnostics mirror both depend on this.
    const text = 'VAR\n  (* a *)\n  a : BOOL AT Motor_Start;\n  b : BOOL AT Ghost;\n  c : BOOL AT relay_1;\nEND_VAR'
    const out = resolveLocationsInText(text, resolve, context)
    expect(out.split('\n')).toHaveLength(text.split('\n').length)
  })

  it('returns the text untouched when it cannot be scanned', () => {
    const broken = 'VAR\n  (* unterminated\nEND_VAR'
    expect(resolveLocationsInText(broken, resolve, context)).toBe(broken)
  })
})

describe('matching by id', () => {
  it('follows a variable through a rename when both sides carry an id', () => {
    const text = 'VAR\n  counter : INT; (* doc *)\nEND_VAR'
    const model = modelOf(text).map((variable) => ({ ...variable, id: 'v1' }))
    const out = apply(text, [{ ...model[0], id: 'v1', name: 'tally' }])
    expect(out).toBe('VAR\n  tally : INT; (* doc *)\nEND_VAR')
  })
})

describe('reordering refuses to guess', () => {
  it('leaves a block alone when two declarations share a name', () => {
    // Invalid IEC — `validateVariableSet` refuses it — but this runs on text
    // that has not necessarily been through the validator. A name is the only
    // identity a declaration has here, so reordering used to overwrite one
    // with the other: `a : INT; a : DINT;` came back as `a : INT; a : INT;`,
    // silently rewriting a declaration the user never touched.
    const text = 'VAR\n  a : INT;\n  a : DINT;\n  b : INT;\nEND_VAR'
    const model = modelOf(text)
    expect(apply(text, [model[2], model[0], model[1]])).toBe(text)
  })

  it('reorders one block without letting another block decide its order', () => {
    const text = 'VAR_INPUT\n  x : INT;\nEND_VAR\nVAR\n  x : BOOL;\n  y : INT;\nEND_VAR'
    const model = modelOf(text)
    // Same name in two blocks: legal nowhere, but the ordering index must be
    // per block regardless, or one block's positions steer the other's.
    const out = apply(text, [model[0], model[2], model[1]])
    expect(out).toBe('VAR_INPUT\n  x : INT;\nEND_VAR\nVAR\n  y : INT;\n  x : BOOL;\nEND_VAR')
  })

  it('leaves the order alone when a declaration is not in the model at all', () => {
    const text = 'VAR\n  a : INT;\n  b : INT;\nEND_VAR'
    const model = modelOf(text)
    // `b` is absent and `c` is unknown: deletion handles removals, so an
    // unmatched declaration here means the two views disagree.
    const out = apply(text, [model[0]])
    expect(out).toBe('VAR\n  a : INT;\nEND_VAR')
  })
})

describe('the committed text follows the committed model, not the typed buffer', () => {
  it('restores a type the user declined, leaving the rest of the line alone', () => {
    // The shape of the type-change-decline path in `commitCode` (found by
    // CodeRabbit on PR #1130). The user types a new type, the modal asks, they
    // decline, and `finalVariables` keeps the OLD type while the buffer still
    // carries the new one. `commitCode` reconciles the two through this
    // function before storing the text — without it the declined type reaches
    // disk and the LSP stub, because the text is what gets serialised.
    const typed = 'VAR\n  (* keep *)\n  Counter : Helper AT %MW0;  (* doc *)\nEND_VAR'
    const committedModel: PLCVariable[] = [
      {
        name: 'Counter',
        class: 'local',
        type: { definition: 'base-type', value: 'INT' },
        location: '%MW0',
        documentation: 'doc',
      },
    ]

    const out = apply(typed, committedModel)

    expect(out).toBe('VAR\n  (* keep *)\n  Counter : INT AT %MW0;  (* doc *)\nEND_VAR')
    expect(out).not.toContain('Helper')
  })

  it('returns the buffer untouched when the model already agrees with it', () => {
    // The overwhelmingly common case: nothing was declined, so reconciling
    // must not disturb a single byte.
    const typed = 'VAR\n  (* keep *)\n  Counter : INT AT %MW0;  (* doc *)\nEND_VAR'
    expect(apply(typed, modelOf(typed))).toBe(typed)
  })
})
