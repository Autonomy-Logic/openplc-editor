import { wrapUnsupportedComments } from '../wrap-unsupported-comments'

describe('wrapUnsupportedComments', () => {
  // -------------------------------------------------------------------------
  // Pass-through: no changes when no unsupported comments
  // -------------------------------------------------------------------------
  it('returns the same value when there are no comments', () => {
    const code = 'x := 1;\ny := 2;'
    expect(wrapUnsupportedComments(code)).toBe(code)
  })

  it('leaves (* *) comments unchanged', () => {
    const code = '(* this is a comment *)\nx := 1;'
    expect(wrapUnsupportedComments(code)).toBe(code)
  })

  // -------------------------------------------------------------------------
  // // line comments
  // -------------------------------------------------------------------------
  it('wraps // line comments ending with \\n', () => {
    const code = '// hello\nx := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('(*')
    expect(result).toContain('*)')
    expect(result).toContain('x := 1;')
  })

  it('wraps // line comments ending with \\r\\n', () => {
    const code = '// hello\r\nx := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('(*')
    expect(result).toContain('*)')
  })

  it('wraps // comment at end of file (no newline)', () => {
    const code = 'x := 1;\n// trailing comment'
    const result = wrapUnsupportedComments(code)
    // Unterminated comment gets closing *)
    expect(result).toContain('(*')
    expect(result.endsWith('*)')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // /* */ block comments
  // -------------------------------------------------------------------------
  it('wraps /* */ block comments', () => {
    const code = '/* block comment */\nx := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('(*')
    expect(result).toContain('*)')
  })

  it('handles /* comment at end of file without closing */', () => {
    const code = '/* unterminated'
    const result = wrapUnsupportedComments(code)
    expect(result.endsWith('*)')).toBe(true)
  })

  it('does not treat /*/ as a closed comment', () => {
    // The sneaky case where /*/ should NOT be interpreted as a full open+close
    const code = '/*/ still in comment */\nx := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('x := 1;')
  })

  // -------------------------------------------------------------------------
  // String context protection
  // -------------------------------------------------------------------------
  it('does not wrap // inside single-quoted strings', () => {
    const code = "x := '// not a comment';\ny := 1;"
    const result = wrapUnsupportedComments(code)
    expect(result).toBe(code)
  })

  it('does not wrap // inside double-quoted strings', () => {
    const code = 'x := "// not a comment";\ny := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toBe(code)
  })

  it('respects backslash escapes inside strings', () => {
    // A backslash before the closing quote means the quote is escaped
    const code = "x := '\\\\'; // real comment\ny := 1;"
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('(*')
    expect(result).toContain('*)')
  })

  it('handles odd number of backslashes before closing quote', () => {
    // Odd backslash count means the quote is escaped (string continues)
    const code = "x := '\\'still string'; // comment\ny := 1;"
    const result = wrapUnsupportedComments(code)
    // After the escaped quote, string continues through to second quote
    expect(result).toContain('(*')
  })

  it('handles $ escape character inside strings', () => {
    // $ acts as escape for next character
    const code = "x := '$'still string'; // comment\ny := 1;"
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('(*')
  })

  // -------------------------------------------------------------------------
  // C code blocks {{ }}
  // -------------------------------------------------------------------------
  it('does not wrap comments inside {{ }} C blocks', () => {
    const code = '{{ // c-style comment\nint x = 0; }}\ny := 1;'
    const result = wrapUnsupportedComments(code)
    // Inside {{ }}, content passes through unchanged
    expect(result).toContain('// c-style comment')
  })

  it('handles nested {{ within C blocks', () => {
    const code = '{{ {{ // inner comment }} }}\ny := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('// inner comment')
  })

  // -------------------------------------------------------------------------
  // Closing *) inside non-(**) comments
  // -------------------------------------------------------------------------
  it('breaks *) sequences inside // comments to prevent premature close', () => {
    const code = '// contains *) inside\nx := 1;'
    const result = wrapUnsupportedComments(code)
    // The *) should be neutralized (replaced with _) so it does not close the wrapping comment
    expect(result).toContain('_)')
    expect(result).toContain('x := 1;')
  })

  it('breaks *) sequences inside /* */ comments', () => {
    const code = '/* contains *) inside */\nx := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('_)')
  })

  // -------------------------------------------------------------------------
  // Mixed scenarios
  // -------------------------------------------------------------------------
  it('handles multiple // comments', () => {
    const code = '// first\nx := 1;\n// second\ny := 2;'
    const result = wrapUnsupportedComments(code)
    // Both comments should be wrapped
    const occurrences = result.split('(*').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('handles mixed (* and // comments', () => {
    const code = '(* standard *)\n// line comment\nx := 1;'
    const result = wrapUnsupportedComments(code)
    expect(result).toContain('(* standard *)')
    expect(result).toContain('x := 1;')
  })
})
