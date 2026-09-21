/**
 * The scanner's contract (DOPE-650).
 *
 * Two behaviours are load-bearing and neither was expressible with the regexes
 * this replaced:
 *
 *   - a comment anywhere is trivia, not a syntax error, and the bytes the user
 *     wrote survive untouched;
 *   - the `AT` operand is whatever the user put there, because an alias name is
 *     free text and the table lets them type one with a space or a hyphen in it.
 *
 * Comment syntax is pinned to STruC++ rather than to intuition, because the
 * table disagreeing with the compiler about what was declared is the failure
 * mode this whole change exists to remove. Every expectation below about
 * nesting, `//`, and C-style delimiters was checked against the pinned 0.6.7.
 */

import { blankComments, scanVariableDeclarations } from '../variable-declaration-scanner'
import { buildScanContext } from '../generate-iec-string-to-variables'

const scan = (source: string) => scanVariableDeclarations(source, buildScanContext())

/** The variables, asserting the scan was clean first so a failure names itself. */
const variablesOf = (source: string) => {
  const result = scan(source)
  expect(result.errors).toEqual([])
  return result.variables
}

describe('comments are trivia, not syntax errors', () => {
  it('accepts a block comment on its own line inside a VAR block', () => {
    const vars = variablesOf('VAR\n  (* standalone *)\n  a : BOOL;\nEND_VAR')
    expect(vars).toHaveLength(1)
    expect(vars[0].name).toBe('a')
  })

  it('accepts a block comment spanning several lines', () => {
    const vars = variablesOf('VAR\n  (* line one\n     line two *)\n  a : BOOL;\nEND_VAR')
    expect(vars).toHaveLength(1)
    expect(vars[0].name).toBe('a')
  })

  it('accepts a line comment on its own line', () => {
    expect(variablesOf('VAR\n  // standalone\n  a : BOOL;\nEND_VAR')).toHaveLength(1)
  })

  it('accepts a line comment trailing a declaration, as its documentation', () => {
    // Both comment forms fill the Documentation column. Writing
    // `a : BOOL; // what it does` and finding the column empty would be the
    // kind of surprise that sends people back to the table view.
    const vars = variablesOf('VAR\n  a : BOOL; // trailing\nEND_VAR')
    expect(vars).toHaveLength(1)
    expect(vars[0].documentation).toBe('trailing')
  })

  it('accepts comments between blocks and before the first one', () => {
    const vars = variablesOf(
      '(* header *)\nVAR\n  a : BOOL;\nEND_VAR\n(* between *)\nVAR_INPUT\n  b : INT;\nEND_VAR\n// trailer',
    )
    expect(vars.map((v) => v.name)).toEqual(['a', 'b'])
  })

  it('accepts a comment holding text that would otherwise be a declaration', () => {
    const vars = variablesOf('VAR\n  (* b : INT; *)\n  a : BOOL;\nEND_VAR')
    expect(vars.map((v) => v.name)).toEqual(['a'])
  })

  it('still reads a trailing block comment as the documentation', () => {
    const vars = variablesOf('VAR\n  a : BOOL; (* what it does *)\nEND_VAR')
    expect(vars[0].documentation).toBe('what it does')
  })

  it('does not let a comment on the NEXT line become documentation', () => {
    // A section header above a declaration is a comment about the section, not
    // about the variable under it. Only the trailing form is documentation.
    const vars = variablesOf('VAR\n  a : BOOL;\n  (* --- timers --- *)\n  t : BOOL;\nEND_VAR')
    expect(vars.map((v) => v.documentation)).toEqual(['', ''])
  })

  describe('matching STruC++ exactly', () => {
    it('nests block comments', () => {
      // strucpp nests: `(* a (* b *) c *)` is ONE comment. A first-`*)` scan
      // would leave ` c *)` as live code and the table would then disagree
      // with the compiler about what was declared.
      const vars = variablesOf('VAR\n  (* outer (* inner *) b : INT; *)\n  a : BOOL;\nEND_VAR')
      expect(vars.map((v) => v.name)).toEqual(['a'])
    })

    it('reports an unclosed block comment instead of swallowing the rest', () => {
      const result = scan('VAR\n  (* never closed\n  a : BOOL;\nEND_VAR')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/Unclosed block comment opened on line 2/)
    })

    it('does not treat a C-style block comment as a comment', () => {
      // strucpp answers ``Expected `END_VAR`, found `/` `` for this. Accepting
      // it here would let the user write something the compiler rejects.
      const result = scan('VAR\n  /* standalone */\n  a : BOOL;\nEND_VAR')
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('blankComments keeps offsets aligned', () => {
    it('preserves length and line structure', () => {
      const source = 'VAR\n  (* hi *)\n  a : BOOL;\nEND_VAR'
      const { code } = blankComments(source)
      expect(code).toHaveLength(source.length)
      expect(code.split('\n')).toHaveLength(source.split('\n').length)
      expect(code).toContain('a : BOOL;')
      expect(code).not.toContain('hi')
    })

    it('preserves newlines inside a multi-line comment', () => {
      const source = 'VAR\n  (* one\n     two *)\n  a : BOOL;\nEND_VAR'
      const { code } = blankComments(source)
      expect(code.split('\n')).toHaveLength(source.split('\n').length)
    })
  })
})

describe('the AT operand is whatever the user wrote', () => {
  it('reads an alias containing a space', () => {
    // The killer: this used to match the TYPE group, so the variable silently
    // became a user data type named "BOOL AT Motor Start" with no location.
    const vars = variablesOf('VAR\n  start : BOOL AT Motor Start;\nEND_VAR')
    expect(vars[0].location).toBe('Motor Start')
    expect(vars[0].type).toEqual({ definition: 'base-type', value: 'BOOL' })
  })

  it('reads an alias containing a hyphen', () => {
    const vars = variablesOf('VAR\n  r : BOOL AT relay-1;\nEND_VAR')
    expect(vars[0].location).toBe('relay-1')
    expect(vars[0].type).toEqual({ definition: 'base-type', value: 'BOOL' })
  })

  it('still reads a literal IEC address', () => {
    const vars = variablesOf('VAR\n  a : BOOL AT %QX0.0;\nEND_VAR')
    expect(vars[0].location).toBe('%QX0.0')
  })

  it('reads an alias in the alternate ordering', () => {
    const vars = variablesOf('VAR\n  start AT Motor Start : BOOL;\nEND_VAR')
    expect(vars[0].location).toBe('Motor Start')
    expect(vars[0].type).toEqual({ definition: 'base-type', value: 'BOOL' })
  })

  it('stops the location at the initial value', () => {
    const vars = variablesOf('VAR\n  a : BOOL AT Motor Start := TRUE;\nEND_VAR')
    expect(vars[0].location).toBe('Motor Start')
    expect(vars[0].initialValue).toBe('TRUE')
  })

  it('does not mistake an identifier merely containing AT for the keyword', () => {
    const vars = variablesOf('VAR\n  water : BOOL;\n  GATE : BOOL;\nEND_VAR')
    expect(vars.map((v) => v.location)).toEqual(['', ''])
  })

  it('does not mistake a type named with an AT prefix for the keyword', () => {
    const vars = variablesOf('VAR\n  x : ATTRIBUTE_T;\nEND_VAR')
    expect(vars[0].type).toEqual({ definition: 'user-data-type', value: 'ATTRIBUTE_T' })
    expect(vars[0].location).toBe('')
  })
})

describe('a malformed type is refused rather than invented', () => {
  it('refuses a two-word type', () => {
    // Would otherwise be persisted as a user data type literally named
    // "My Type", shown in the type cell and emitted verbatim into the ST.
    const result = scan('VAR\n  x : My Type;\nEND_VAR')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/not a valid type name/)
  })

  it('refuses a type with unsupported characters', () => {
    const result = scan('VAR\n  counter : INT @;\nEND_VAR')
    expect(result.errors[0].message).toMatch(/invalid or unsupported characters/)
  })

  it('accepts a namespaced type', () => {
    const vars = variablesOf('VAR\n  t : mylib.TON;\nEND_VAR')
    expect(vars[0].type).toEqual({ definition: 'user-data-type', value: 'mylib.TON' })
  })
})

describe('the source map addresses the user bytes', () => {
  const source = 'VAR\n  counter : INT AT %MW0 := 7; (* how many *)\nEND_VAR'

  it('spans each field exactly', () => {
    const [block] = scan(source).blocks
    const [decl] = block.declarations
    const at = (span: { start: number; end: number }) => source.slice(span.start, span.end)

    expect(at(decl.fields.name)).toBe('counter')
    expect(at(decl.fields.type)).toBe('INT')
    expect(at(decl.fields.location!)).toBe('%MW0')
    expect(at(decl.fields.initialValue!)).toBe('7')
    expect(at(decl.fields.documentation!).trim()).toBe('how many')
  })

  it('leaves the trailing comment outside the declaration span', () => {
    const [block] = scan(source).blocks
    const [decl] = block.declarations
    expect(source.slice(decl.span.start, decl.span.end)).toBe('counter : INT AT %MW0 := 7')
    expect(source.slice(decl.span.start, decl.span.end)).not.toContain('(*')
  })

  it('reports the block keyword and END_VAR spans', () => {
    const [block] = scan(source).blocks
    expect(source.slice(block.headerSpan.start, block.headerSpan.end)).toBe('VAR')
    expect(source.slice(block.endVarSpan.start, block.endVarSpan.end)).toBe('END_VAR')
  })

  it('keeps spans correct when a comment sits earlier in the text', () => {
    // The whole point of blanking comments in place: an earlier comment must
    // not shift any later offset.
    const withComment = 'VAR\n  (* a long preamble comment *)\n  counter : INT;\nEND_VAR'
    const [block] = scan(withComment).blocks
    const [decl] = block.declarations
    expect(withComment.slice(decl.fields.name.start, decl.fields.name.end)).toBe('counter')
    expect(withComment.slice(decl.fields.type.start, decl.fields.type.end)).toBe('INT')
  })
})

describe('block headers and qualifiers', () => {
  it('carries the block flag onto every variable under it', () => {
    const vars = variablesOf('VAR CONSTANT\n  k : INT := 1;\n  j : INT := 2;\nEND_VAR')
    expect(vars.map((v) => v.flag)).toEqual(['constant', 'constant'])
  })

  it('maps PERSISTENT onto retain', () => {
    expect(variablesOf('VAR RETAIN PERSISTENT\n  h : DINT;\nEND_VAR')[0].flag).toBe('retain')
  })

  it('reports an unknown qualifier by name', () => {
    const result = scan('VAR BOGUS\n  a : INT;\nEND_VAR')
    expect(result.errors[0].message).toMatch(/Unknown variable block qualifier "BOGUS"/)
  })

  it('reports a block left unterminated', () => {
    const result = scan('VAR\n  a : INT;')
    expect(result.errors[0].message).toMatch(/Missing END_VAR/)
    // The declaration before it still parsed — refusing it would lose more
    // than it protects.
    expect(result.variables.map((v) => v.name)).toEqual(['a'])
  })
})

describe('line numbers survive comments', () => {
  it('reports the declaration line, not the line the scan happened to reach', () => {
    const result = scan('VAR\n  (* one\n     two\n     three *)\n  bad line here\nEND_VAR')
    expect(result.errors[0].line).toBe(5)
    expect(result.errors[0].message).toMatch(/Syntax error on line 5/)
  })
})
