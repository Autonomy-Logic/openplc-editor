/**
 * Comments in the `.dt` code view are trivia, not errors (DOPE-650).
 *
 * The data-type view is the same kind of surface as the POU variables view and
 * had the same defect: a standalone `(* … *)` came back as
 * `invalid structure field: "(* a comment *)". Possible cause: missing
 * semicolon`, a message about a line the user never meant as a field.
 *
 * It reuses the POU scanner's comment pass rather than growing its own, so the
 * two views cannot end up disagreeing about what a comment is.
 */
import { parseDataTypeFromText } from '../data-type-declarations'

const fieldsOf = (text: string) => {
  const result = parseDataTypeFromText(text, 'S')
  expect(result.error).toBeUndefined()
  const dataType = result.dataType
  if (dataType === undefined || dataType.derivation !== 'structure') throw new Error('expected a structure')
  return dataType.variable
}

describe('a .dt structure accepts comments', () => {
  it('accepts a standalone block comment between fields', () => {
    const fields = fieldsOf('TYPE\n  S : STRUCT\n    (* note *)\n    a : INT;\n  END_STRUCT;\nEND_TYPE')
    expect(fields.map((field) => field.name)).toEqual(['a'])
  })

  it('accepts a line comment', () => {
    const fields = fieldsOf('TYPE\n  S : STRUCT\n    // note\n    a : INT;\n  END_STRUCT;\nEND_TYPE')
    expect(fields.map((field) => field.name)).toEqual(['a'])
  })

  it('accepts a block comment spanning several lines', () => {
    const fields = fieldsOf('TYPE\n  S : STRUCT\n    (* one\n       two *)\n    a : INT;\n  END_STRUCT;\nEND_TYPE')
    expect(fields.map((field) => field.name)).toEqual(['a'])
  })

  it('accepts a comment trailing a field', () => {
    const fields = fieldsOf('TYPE\n  S : STRUCT\n    a : INT; (* trailing *)\n  END_STRUCT;\nEND_TYPE')
    expect(fields.map((field) => field.name)).toEqual(['a'])
  })

  it('ignores a field that only exists inside a comment', () => {
    const fields = fieldsOf('TYPE\n  S : STRUCT\n    (* b : DINT; *)\n    a : INT;\n  END_STRUCT;\nEND_TYPE')
    expect(fields.map((field) => field.name)).toEqual(['a'])
  })

  it('reports an unclosed block comment as such', () => {
    const result = parseDataTypeFromText('TYPE\n  S : STRUCT\n    (* never closed\n  END_STRUCT;\nEND_TYPE', 'S')
    expect(result.error).toMatch(/Unclosed block comment/)
  })
})

/**
 * Which opener wins. The `.dt` view read `(*` before `//` regardless of which came
 * first, so a line comment mentioning a block opener lost its tail — the same defect
 * the variables view had, which is why both now share one reader.
 */
describe('a .dt field comment is read as the compiler reads it', () => {
  const documentationOf = (text: string) => fieldsOf(text).map((field) => field.documentation)

  it.each([
    { label: 'block', line: 'a : INT; (* note *)', want: 'note' },
    { label: 'line', line: 'a : INT; // note', want: 'note' },
    { label: 'line comment mentioning a block opener', line: 'a : INT; // use (* x *)', want: 'use (* x *)' },
    { label: 'block comment mentioning a line opener', line: 'a : INT; (* use // x *)', want: 'use // x' },
    { label: 'nested block comment', line: 'a : INT; (* outer (* inner *) tail *)', want: 'outer (* inner *) tail' },
  ])('$label', ({ line, want }) => {
    expect(documentationOf(`TYPE\n  S : STRUCT\n    ${line}\n  END_STRUCT;\nEND_TYPE`)).toEqual([want])
  })

  it('reports an unterminated block comment rather than eating the rest of the type', () => {
    // It swallows END_STRUCT and END_TYPE, so the only honest reading is an error.
    expect(parseDataTypeFromText('TYPE\n  S : STRUCT\n    a : INT; (* open\n  END_STRUCT;\nEND_TYPE', 'S').error).toBe(
      'Unclosed block comment',
    )
  })
})
