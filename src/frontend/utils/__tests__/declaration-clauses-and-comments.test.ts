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
import { normalizeOneVariablePerLine, parseVariableDeclarations } from '../PLC/variable-declarations'
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

describe('adding both clauses at once', () => {
  // Two clauses added to a declaration that had neither are two inserts at one
  // offset, and the one applied last ends up leftmost. Queued in the order they
  // must appear, the result was `a : BOOL := TRUE AT %QX0.0;` — which does not
  // parse, so the next patch regenerated the block and took the comments with
  // it.
  it.each([
    {
      label: 'location and initial value',
      text: 'VAR\n  a : BOOL;\nEND_VAR',
      patch: { location: '%QX0.0', initialValue: 'TRUE' },
      want: 'VAR\n  a : BOOL AT %QX0.0 := TRUE;\nEND_VAR',
    },
    {
      label: 'location, initial value and a comment',
      text: 'VAR\n  a : BOOL;\nEND_VAR',
      patch: { location: '%QX0.0', initialValue: 'TRUE', documentation: 'note' },
      want: 'VAR\n  a : BOOL AT %QX0.0 := TRUE; (* note *)\nEND_VAR',
    },
    {
      label: 'an initial value beside a location that was already there',
      text: 'VAR\n  a : BOOL AT %QX0.0;\nEND_VAR',
      patch: { initialValue: 'TRUE' },
      want: 'VAR\n  a : BOOL AT %QX0.0 := TRUE;\nEND_VAR',
    },
    {
      label: 'a location beside an initial value that was already there',
      text: 'VAR\n  a : BOOL := TRUE;\nEND_VAR',
      patch: { location: '%QX0.0' },
      want: 'VAR\n  a : BOOL AT %QX0.0 := TRUE;\nEND_VAR',
    },
  ])('$label', ({ text, patch, want }) => {
    const after = edit(text, (variable) => ({ ...variable, ...patch }))
    expect(after).toBe(want)
    // The point of the ordering rule: what comes out has to parse.
    expect(parseVariableDeclarations(after, context).errors).toEqual([])
  })
})

describe('a comment the block form cannot hold', () => {
  // The Documentation cell is free text spliced between delimiters. A `*)` in it
  // closed the comment early and a lone `(*` opened a nested one that swallowed
  // the rest of the file — in both cases the declaration stopped parsing and the
  // next patch fell back to regenerating the block.
  it.each([
    { label: 'a closer', documentation: 'see *) here' },
    { label: 'an opener', documentation: 'see (* here' },
    { label: 'both, unbalanced', documentation: 'see *) and (* too' },
  ])('keeps the text and changes the delimiters — $label', ({ documentation }) => {
    const after = edit('VAR\n  a : BOOL;\nEND_VAR', (variable) => ({ ...variable, documentation }))
    const reparsed = parseVariableDeclarations(after, context)

    expect(reparsed.errors).toEqual([])
    expect(reparsed.variables[0].documentation).toBe(documentation)
  })

  it('stays a block comment when the text balances', () => {
    const after = edit('VAR\n  a : BOOL;\nEND_VAR', (variable) => ({
      ...variable,
      documentation: 'see (* nested *) here',
    }))

    expect(after).toContain('(* see (* nested *) here *)')
    expect(parseVariableDeclarations(after, context).errors).toEqual([])
  })

  it('moves an existing block comment to the line form when it has to', () => {
    const after = edit('VAR\n  a : BOOL; (* old *)\nEND_VAR', (variable) => ({ ...variable, documentation: 'new *)' }))

    expect(after).toBe('VAR\n  a : BOOL; // new *)\nEND_VAR')
    expect(parseVariableDeclarations(after, context).errors).toEqual([])
  })
})

describe('clearing the Documentation cell removes the comment', () => {
  it.each([
    { label: 'block', text: 'VAR\n  a : BOOL; (* old *)\nEND_VAR' },
    { label: 'line', text: 'VAR\n  a : BOOL; // old\nEND_VAR' },
    { label: 'block, spanning lines', text: 'VAR\n  a : BOOL; (* one\n   two *)\nEND_VAR' },
  ])('$label', ({ text }) => {
    // Emptying the inner span alone left `(**)` and a bare `//` behind: a comment
    // the user did not write and cannot see the text of.
    expect(edit(text, (variable) => ({ ...variable, documentation: '' }))).toBe('VAR\n  a : BOOL;\nEND_VAR')
  })
})

describe('a line holding two declarations', () => {
  it('gives the trailing comment to the first of them', () => {
    const variables = model('VAR\n  a : INT; b : INT; (* note *)\nEND_VAR')
    expect(variables.map((variable) => [variable.name, variable.documentation])).toEqual([
      ['a', 'note'],
      ['b', ''],
    ])
  })

  it('does not read a comment opener out of a string on that line', () => {
    // `a`'s scan runs over `b`'s text, and the `//` inside the URL was taken for
    // a comment: `a` came back documented `x';`, and normalising the line wrote
    // `a : INT; //x';` into the user's file.
    const variables = model("VAR\n  a : INT; url : STRING := 'http://x';\nEND_VAR")
    expect(variables.map((variable) => [variable.name, variable.documentation])).toEqual([
      ['a', ''],
      ['url', ''],
    ])
  })

  it.each([
    { label: 'a URL', first: 'a : INT;', second: "url : STRING := 'http://x';" },
    { label: 'a comment opener in a string', first: 'a : INT;', second: "s : STRING := '(* not a comment';" },
    { label: 'a dollar-escaped quote', first: 'a : INT;', second: "s : STRING := 'it$'s';" },
  ])('normalises it without inventing a comment — $label', ({ first, second }) => {
    // Each declaration goes on its own line and NOTHING is added: the literal's
    // punctuation is not a comment, so neither line grows one.
    expect(normalizeOneVariablePerLine(`VAR\n  ${first} ${second}\nEND_VAR`, context)).toBe(
      `VAR\n  ${first}\n  ${second}\nEND_VAR`,
    )
  })
})

describe('a file written with CRLF stays written with CRLF', () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n')

  it('inserts a new declaration with the file\u2019s own line ending', () => {
    const source = crlf('VAR\n  a : BOOL;\nEND_VAR')
    const variables = model(source)
    const after = applyVariablesToText(source, [...variables, { ...variables[0], name: 'b' }], context)

    expect(after).toBe(crlf('VAR\n  a : BOOL;\n  b : BOOL;\nEND_VAR'))
    expect(after).not.toMatch(/[^\r]\n/)
  })

  it('keeps the line ending when a comment changes', () => {
    // The `\r` sat inside the comment's span, so replacing the text dropped it
    // and left that one line ending with a bare `\n`.
    const source = crlf('VAR\n  a : BOOL; // old\nEND_VAR')
    const after = applyVariablesToText(source, [{ ...model(source)[0], documentation: 'new' }], context)

    expect(after).toBe(crlf('VAR\n  a : BOOL; // new\nEND_VAR'))
  })

  it('normalises a crowded line without changing the line ending', () => {
    const source = crlf('VAR\n  a : BOOL; b : INT;\nEND_VAR')
    expect(normalizeOneVariablePerLine(source, context)).toBe(crlf('VAR\n  a : BOOL;\n  b : INT;\nEND_VAR'))
  })

  it('leaves an LF file alone', () => {
    const source = 'VAR\n  a : BOOL;\nEND_VAR'
    const variables = model(source)
    expect(applyVariablesToText(source, [...variables, { ...variables[0], name: 'b' }], context)).not.toContain('\r')
  })
})
