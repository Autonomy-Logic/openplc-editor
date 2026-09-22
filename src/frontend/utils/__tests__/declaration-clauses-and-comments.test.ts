/**
 * The parts of a declaration that are not its name (DOPE-650).
 *
 * The `AT` and `:=` clauses and the trailing comment are where the editor does
 * its only real text surgery, and every bug in them has been the same kind:
 * an offset worked out by scanning rather than taken from the parser, or a
 * comment read by a scanner that did not know what it was inside of.
 */

import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { buildTypeContext } from '../generate-iec-string-to-variables'
import { parseVariableDeclarations } from '../PLC/variable-declarations'
import { applyVariablesToText, resolveLocationsInText } from '../variable-text-edits'

const context = buildTypeContext()
const model = (text: string): PLCVariable[] => {
  const result = parseVariableDeclarations(text, context)
  expect(result.errors).toEqual([])
  return result.variables
}
const edit = (text: string, patch: (variable: PLCVariable) => PLCVariable) =>
  applyVariablesToText(text, model(text).map(patch), context)

const clear = (field: 'location' | 'initialValue') => (variable: PLCVariable) => ({
  ...variable,
  [field]: field === 'location' ? '' : null,
})

describe('clearing an AT clause removes the keyword with it', () => {
  it.each([
    { label: 'literal address', text: 'VAR\n  x : BOOL AT %QX0.0;\nEND_VAR', want: 'VAR\n  x : BOOL;\nEND_VAR' },
    { label: 'alias', text: 'VAR\n  x : BOOL AT Alias1;\nEND_VAR', want: 'VAR\n  x : BOOL;\nEND_VAR' },
    // IEC keywords are case-insensitive and STruC++ accepts the lower-case form.
    { label: 'lower-case keyword', text: 'VAR\n  x : BOOL at Alias1;\nEND_VAR', want: 'VAR\n  x : BOOL;\nEND_VAR' },
    // The alias begins with the keyword's own letters.
    { label: 'alias starting with AT', text: 'VAR\n  x : BOOL AT ATTIC;\nEND_VAR', want: 'VAR\n  x : BOOL;\nEND_VAR' },
    // Uppercasing is not length-preserving, so a scan over a folded copy of the
    // text returned offsets into a longer string.
    {
      label: 'non-ASCII text above it',
      text: 'VAR\n  (* Maß für Größe *)\n  x : BOOL at Alias1;\nEND_VAR',
      want: 'VAR\n  (* Maß für Größe *)\n  x : BOOL;\nEND_VAR',
    },
    {
      label: 'keeps a comment written inside the clause',
      text: 'VAR\n  x : BOOL (* why *) AT Alias1;\nEND_VAR',
      want: 'VAR\n  x : BOOL (* why *);\nEND_VAR',
    },
    {
      label: 'an initial value follows it',
      text: 'VAR\n  x : BOOL AT %QX0.0 := TRUE;\nEND_VAR',
      want: 'VAR\n  x : BOOL := TRUE;\nEND_VAR',
    },
  ])('$label', ({ text, want }) => {
    expect(edit(text, clear('location'))).toBe(want)
  })
})

describe('clearing an initial value removes its keyword with it', () => {
  it.each([
    { label: 'on its own', text: 'VAR\n  x : INT := 7;\nEND_VAR', want: 'VAR\n  x : INT;\nEND_VAR' },
    {
      label: 'after a location',
      text: 'VAR\n  x : INT AT %MW0 := 7;\nEND_VAR',
      want: 'VAR\n  x : INT AT %MW0;\nEND_VAR',
    },
  ])('$label', ({ text, want }) => {
    expect(edit(text, clear('initialValue'))).toBe(want)
  })
})

describe('adding a clause where there was none', () => {
  it('adds a location', () => {
    expect(edit('VAR\n  x : BOOL;\nEND_VAR', (v) => ({ ...v, location: '%QX0.0' }))).toBe(
      'VAR\n  x : BOOL AT %QX0.0;\nEND_VAR',
    )
  })

  it('adds an initial value', () => {
    expect(edit('VAR\n  x : INT;\nEND_VAR', (v) => ({ ...v, initialValue: '7' }))).toBe('VAR\n  x : INT := 7;\nEND_VAR')
  })
})

describe('trailing comments are read as the compiler reads them', () => {
  it.each([
    { label: 'block', text: 'VAR\n  a : INT; (* note *)\nEND_VAR', want: 'note' },
    { label: 'line', text: 'VAR\n  a : INT; // note\nEND_VAR', want: 'note' },
    // Whichever opener comes first owns the rest of the line.
    {
      label: 'line comment mentioning a block opener',
      text: 'VAR\n  a : INT; // see (* x *)\nEND_VAR',
      want: 'see (* x *)',
    },
    // IEC block comments nest, and STruC++ reads them that way.
    {
      label: 'nested block comment',
      text: 'VAR\n  a : INT; (* outer (* inner *) tail *)\nEND_VAR',
      want: 'outer (* inner *) tail',
    },
    { label: 'spanning lines', text: 'VAR\n  a : INT; (* one\n   two *)\nEND_VAR', want: 'one\n   two' },
  ])('$label', ({ text, want }) => {
    expect(model(text)[0].documentation).toBe(want)
  })
})

describe('a comment is not rewritten unless it changed', () => {
  it.each([
    'VAR\n  a : INT; (* note *)\nEND_VAR',
    'VAR\n  a : INT; // note\nEND_VAR',
    'VAR\n  a : INT; (* one\n   two *)\nEND_VAR',
    'VAR\n  (* standalone *)\n\n  a : INT;\nEND_VAR',
  ])('%s', (text) => {
    expect(applyVariablesToText(text, model(text), context)).toBe(text)
  })

  it('keeps the syntax the user chose when the words do change', () => {
    expect(edit('VAR\n  a : INT; // old\nEND_VAR', (v) => ({ ...v, documentation: 'new' }))).toBe(
      'VAR\n  a : INT; // new\nEND_VAR',
    )
    expect(edit('VAR\n  a : INT; (* old *)\nEND_VAR', (v) => ({ ...v, documentation: 'new' }))).toBe(
      'VAR\n  a : INT; (* new *)\nEND_VAR',
    )
  })
})

describe('resolveLocationsInText, for the LSP stub', () => {
  it.each([
    {
      label: 'one declaration',
      text: 'VAR\n  a : BOOL AT Alias1;\nEND_VAR',
      want: 'VAR\n  a : BOOL AT %QX0.0;\nEND_VAR',
    },
    // One `ParsedDeclaration` per name, all sharing the location span — the edit
    // must be queued once, not once per name.
    {
      label: 'co-declared names',
      text: 'VAR\n  a, b : BOOL AT Alias1;\nEND_VAR',
      want: 'VAR\n  a, b : BOOL AT %QX0.0;\nEND_VAR',
    },
  ])('$label', ({ text, want }) => {
    expect(resolveLocationsInText(text, (location) => (location === 'Alias1' ? '%QX0.0' : ''), context)).toBe(want)
  })

  it.each([
    { label: 'one declaration', text: 'VAR\n  a : BOOL AT Ghost;\nEND_VAR', want: 'VAR\n  a : BOOL;\nEND_VAR' },
    { label: 'co-declared names', text: 'VAR\n  a, b : BOOL AT Ghost;\nEND_VAR', want: 'VAR\n  a, b : BOOL;\nEND_VAR' },
  ])('drops an unresolved alias — $label', ({ text, want }) => {
    expect(resolveLocationsInText(text, () => '', context)).toBe(want)
  })
})
