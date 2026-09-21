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
