/**
 * A load/save round trip must not reformat the file (DOPE-650).
 *
 * `variablesText` is written back verbatim now, so anything the loader drops
 * when it slices the VAR section becomes a byte diff in every POU file the
 * first time a project is saved — noise in every user's git history, and it
 * undercuts the promise that the text is preserved.
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { parseTextualPouFromString } from '../pou-text-parser'

const textOf = (pou: PLCPou) => pou.variablesText

describe('the stored declaration text keeps the block indentation', () => {
  it('starts at the line holding VAR, not at the keyword', () => {
    const source = 'PROGRAM main\n  VAR\n    a : INT;\n  END_VAR\n\n  a := 1;\n\nEND_PROGRAM'
    expect(textOf(parseTextualPouFromString(source, 'st', 'program'))).toBe('  VAR\n    a : INT;\n  END_VAR')
  })

  it('keeps a tab indent', () => {
    const source = 'PROGRAM main\n\tVAR\n\t\ta : INT;\n\tEND_VAR\n\n\ta := 1;\n\nEND_PROGRAM'
    expect(textOf(parseTextualPouFromString(source, 'st', 'program'))).toBe('\tVAR\n\t\ta : INT;\n\tEND_VAR')
  })

  it('keeps an unindented block unindented', () => {
    const source = 'PROGRAM main\nVAR\n  a : INT;\nEND_VAR\n\na := 1;\n\nEND_PROGRAM'
    expect(textOf(parseTextualPouFromString(source, 'st', 'program'))).toBe('VAR\n  a : INT;\nEND_VAR')
  })

  it('keeps comments and blank lines inside the block', () => {
    const source =
      'PROGRAM main\n  VAR\n    (* note *)\n\n    a : INT;  // trailing\n  END_VAR\n\n  a := 1;\n\nEND_PROGRAM'
    const text = textOf(parseTextualPouFromString(source, 'st', 'program')) ?? ''
    expect(text).toContain('(* note *)')
    expect(text).toContain('// trailing')
    expect(text).toContain('*)\n\n')
  })

  it('marks a POU whose declarations parsed as not needing repair', () => {
    const pou = parseTextualPouFromString(
      'PROGRAM main\n  VAR\n    a : INT;\n  END_VAR\n\n  ;\n\nEND_PROGRAM',
      'st',
      'program',
    )
    expect(pou.variablesTextUnparsed).toBeUndefined()
  })
})
