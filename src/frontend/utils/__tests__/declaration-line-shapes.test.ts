/**
 * Every line shape, through every operation (DOPE-650).
 *
 * The "one line" assumption has produced a defect in every review round of this
 * change: co-declared names sharing a span, two declarations sharing a line, a
 * block keyword sharing a line, a whole block on one line. Each was reported,
 * fixed, and replaced by the next shape.
 *
 * So this is a matrix rather than a list of cases. For every shape a user can
 * legally write, every operation the table performs is applied and the result is
 * held to two invariants that are what "no data loss" actually means:
 *
 *   1. the text still parses;
 *   2. it declares exactly the variables the model says it should — no more, no
 *      fewer, whatever the layout was.
 *
 * A new shape belongs in `SHAPES`, not in a new test.
 */

import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { buildTypeContext } from '../generate-iec-string-to-variables'
import { normalizeOneVariablePerLine, parseVariableDeclarations } from '../PLC/variable-declarations'
import { applyVariablesToText } from '../variable-text-edits'

const context = buildTypeContext()

const model = (text: string): PLCVariable[] => {
  const result = parseVariableDeclarations(text, context)
  expect(result.errors).toEqual([])
  return result.variables
}

/** The names a text declares, which is the invariant every case checks. */
const namesIn = (text: string): string[] => {
  const result = parseVariableDeclarations(text, context)
  expect(result.errors.map((error) => error.message)).toEqual([])
  return result.variables.map((variable) => variable.name)
}

const local = (name: string, type = 'BOOL'): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: type },
  location: '',
  initialValue: null,
  documentation: '',
  debug: false,
})

/** Every layout a user can legally write, with the variables each declares. */
const SHAPES: Array<{ label: string; text: string; names: string[] }> = [
  { label: 'one per line', text: 'VAR\n  a : INT;\n  b : INT;\nEND_VAR', names: ['a', 'b'] },
  { label: 'co-declared names', text: 'VAR\n  a, b : INT;\nEND_VAR', names: ['a', 'b'] },
  { label: 'two declarations on a line', text: 'VAR\n  a : INT; b : INT;\nEND_VAR', names: ['a', 'b'] },
  { label: 'both kinds of crowding', text: 'VAR\n  a, b : INT; c, d : INT;\nEND_VAR', names: ['a', 'b', 'c', 'd'] },
  { label: 'header shares the line', text: 'VAR a : INT;\n  b : INT;\nEND_VAR', names: ['a', 'b'] },
  { label: 'END_VAR shares the line', text: 'VAR\n  a : INT;\n  b : INT; END_VAR', names: ['a', 'b'] },
  { label: 'whole block on one line', text: 'VAR a : INT; b : INT; END_VAR', names: ['a', 'b'] },
  { label: 'tab indented', text: 'VAR\n\ta : INT;\n\tb : INT;\nEND_VAR', names: ['a', 'b'] },
  {
    label: 'several blocks, mixed shapes',
    text: 'VAR_INPUT i : BOOL;\nEND_VAR\nVAR\n  a, b : INT;\nEND_VAR\nVAR_OUTPUT\n  q : BOOL; END_VAR',
    names: ['i', 'a', 'b', 'q'],
  },
  {
    label: 'comments between and after declarations',
    text: 'VAR\n  (* section *)\n  a : INT; (* first *)\n\n  b : INT; // second\nEND_VAR',
    names: ['a', 'b'],
  },
]

describe('every line shape parses to the variables it declares', () => {
  it.each(SHAPES)('$label', ({ text, names }) => {
    expect(namesIn(text)).toEqual(names)
  })
})

describe('deleting one variable leaves every other one in the file', () => {
  it.each(SHAPES)('$label', ({ text, names }) => {
    for (const victim of names) {
      const kept = names.filter((name) => name !== victim)
      const out = applyVariablesToText(
        text,
        model(text).filter((variable) => variable.name !== victim),
        context,
      )
      expect({ shape: victim, names: namesIn(out) }).toEqual({ shape: victim, names: kept })
    }
  })
})

describe('adding a variable puts it inside its block', () => {
  it.each(SHAPES)('$label', ({ text, names }) => {
    const out = applyVariablesToText(text, [...model(text), local('added')], context)
    const after = namesIn(out)

    // The new declaration joins the block of its own class, which is not
    // necessarily the end of the POU — so the invariant is that it arrives and
    // that the declarations already there keep their order.
    expect(after).toContain('added')
    expect(after.filter((name) => name !== 'added')).toEqual(names)
  })
})

describe('reordering keeps every variable', () => {
  it.each(SHAPES)('$label', ({ text, names }) => {
    const reversed = [...model(text)].reverse()
    const out = applyVariablesToText(text, reversed, context)
    expect(namesIn(out).slice().sort()).toEqual([...names].sort())
  })
})

describe('renaming touches only the variable renamed', () => {
  it.each(SHAPES)('$label', ({ text, names }) => {
    const out = applyVariablesToText(
      text,
      model(text).map((variable) => (variable.name === names[0] ? { ...variable, name: 'renamed' } : variable)),
      context,
    )
    expect(namesIn(out)).toEqual(['renamed', ...names.slice(1)])
  })
})

describe('normalising is idempotent and preserves the variable set', () => {
  it.each(SHAPES)('$label', ({ text, names }) => {
    const once = normalizeOneVariablePerLine(text, context)
    expect(namesIn(once)).toEqual(names)
    expect(normalizeOneVariablePerLine(once, context)).toBe(once)
  })
})

describe('a shape that is already one declaration per line is left alone', () => {
  it.each(SHAPES.filter((shape) => shape.label === 'one per line' || shape.label === 'tab indented'))(
    '$label',
    ({ text }) => {
      expect(normalizeOneVariablePerLine(text, context)).toBe(text)
      expect(applyVariablesToText(text, model(text), context)).toBe(text)
    },
  )
})

describe('an empty block still accepts a declaration', () => {
  it.each([
    { label: 'on two lines', text: 'VAR\nEND_VAR' },
    { label: 'on one line', text: 'VAR END_VAR' },
  ])('$label', ({ text }) => {
    const out = applyVariablesToText(text, [local('added')], context)
    expect(namesIn(out)).toEqual(['added'])
  })
})

/**
 * Where a new variable lands when its class has more than one block. The table
 * appends it; the text has to append it too, or the next load reads the order back
 * out of the text and the row moves.
 */
describe('adding to a POU with two blocks of the same class', () => {
  const source = 'VAR\n  a : INT;\nEND_VAR\nVAR\n  b : INT;\nEND_VAR'

  it('appends to the last block, matching the table', () => {
    const variables = model(source)
    const after = applyVariablesToText(source, [...variables, { ...variables[0], name: 'added' }], context)

    expect(after).toBe('VAR\n  a : INT;\nEND_VAR\nVAR\n  b : INT;\n  added : INT;\nEND_VAR')
    expect(model(after).map((variable) => variable.name)).toEqual(['a', 'b', 'added'])
  })
})
