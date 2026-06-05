import { builtinFunctions, getLiteralType, isLegalIdentifier, sanitizeVariableInput } from '../keywords'

describe('getLiteralType', () => {
  it('returns undefined for non-literal strings', () => {
    expect(getLiteralType('myVar')).toBeUndefined()
  })

  it('returns types for boolean literal TRUE', () => {
    const result = getLiteralType('TRUE')
    expect(result).toBeDefined()
    expect(result).toContain('ANY')
    expect(result).toContain('BOOL')
  })

  it('returns types for boolean literal FALSE', () => {
    const result = getLiteralType('FALSE')
    expect(result).toBeDefined()
    expect(result).toContain('BOOL')
  })

  it('returns types for 0 (matches bool and numeric)', () => {
    const result = getLiteralType('0')
    expect(result).toBeDefined()
    expect(result).toContain('BOOL')
    expect(result).toContain('INT')
    expect(result).toContain('REAL')
  })

  it('returns types for 1 (matches bool and numeric)', () => {
    const result = getLiteralType('1')
    expect(result).toBeDefined()
    expect(result).toContain('BOOL')
  })

  it('returns types for binary literal', () => {
    const result = getLiteralType('2#1010')
    expect(result).toBeDefined()
    expect(result).toContain('INT')
  })

  it('returns types for octal literal', () => {
    const result = getLiteralType('8#77')
    expect(result).toBeDefined()
    expect(result).toContain('INT')
  })

  it('returns types for hex literal', () => {
    const result = getLiteralType('16#FF')
    expect(result).toBeDefined()
    expect(result).toContain('INT')
  })

  it('returns types for negative integer literal', () => {
    const result = getLiteralType('-42')
    expect(result).toBeDefined()
    expect(result).toContain('INT')
  })

  it('returns types for float literal', () => {
    const result = getLiteralType('3.14')
    expect(result).toBeDefined()
    expect(result).toContain('REAL')
  })

  it('returns types for negative float literal', () => {
    const result = getLiteralType('-1.5')
    expect(result).toBeDefined()
    expect(result).toContain('LREAL')
  })

  it('returns types for TIME literal', () => {
    const result = getLiteralType('T#50ms')
    expect(result).toBeDefined()
    expect(result).toContain('TIME')
  })

  it('returns types for DATE literal', () => {
    const result = getLiteralType('D#2024-01-01')
    expect(result).toBeDefined()
    expect(result).toContain('DATE')
  })

  it('returns types for TOD literal', () => {
    const result = getLiteralType('TOD#12:00:00')
    expect(result).toBeDefined()
    expect(result).toContain('TOD')
  })

  it('returns types for DT literal', () => {
    const result = getLiteralType('DT#2024-01-01')
    expect(result).toBeDefined()
    expect(result).toContain('DT')
  })

  it('returns types for string literal', () => {
    const result = getLiteralType("'hello'")
    expect(result).toBeDefined()
    expect(result).toContain('STRING')
  })

  it('prepends ANY to the returned types', () => {
    const result = getLiteralType('TRUE')
    expect(result?.[0]).toBe('ANY')
  })
})

describe('isLegalIdentifier', () => {
  it('returns true for a valid identifier', () => {
    expect(isLegalIdentifier('myVar')).toEqual([true, ''])
  })

  it('returns true for identifier starting with underscore', () => {
    expect(isLegalIdentifier('_temp')).toEqual([true, ''])
  })

  it('returns false for a literal value', () => {
    const [legal, reason] = isLegalIdentifier('TRUE')
    expect(legal).toBe(false)
    expect(reason).toBe('is a literal')
  })

  it('returns false for a reserved keyword', () => {
    const [legal, reason] = isLegalIdentifier('PROGRAM')
    expect(legal).toBe(false)
    expect(reason).toBe('is a reserved word')
  })

  it('returns false for a reserved keyword (case insensitive)', () => {
    const [legal, reason] = isLegalIdentifier('program')
    expect(legal).toBe(false)
    expect(reason).toBe('is a reserved word')
  })

  it('returns false for a builtin function name', () => {
    const [legal, reason] = isLegalIdentifier('ABS')
    expect(legal).toBe(false)
    expect(reason).toBe('is a reserved word')
  })

  it('returns false for a name with illegal characters', () => {
    const [legal, reason] = isLegalIdentifier('my-var')
    expect(legal).toBe(false)
    expect(reason).toBe('contains illegal characters')
  })

  it('returns false for a name starting with a digit', () => {
    const [legal, reason] = isLegalIdentifier('1abc')
    expect(legal).toBe(false)
    expect(reason).toBe('contains illegal characters')
  })

  it('returns false for a name with spaces', () => {
    const [legal, reason] = isLegalIdentifier('my var')
    expect(legal).toBe(false)
    expect(reason).toBe('contains illegal characters')
  })

  it('returns false for an empty string', () => {
    const [legal, reason] = isLegalIdentifier('')
    expect(legal).toBe(false)
    expect(reason).toBe('contains illegal characters')
  })
})

describe('builtinFunctions', () => {
  it('is an array of strings', () => {
    expect(Array.isArray(builtinFunctions)).toBe(true)
    expect(builtinFunctions.length).toBeGreaterThan(0)
    expect(typeof builtinFunctions[0]).toBe('string')
  })

  it('contains known standard functions', () => {
    expect(builtinFunctions).toContain('ABS')
    expect(builtinFunctions).toContain('CONCAT')
    expect(builtinFunctions).toContain('SHL')
  })
})

describe('sanitizeVariableInput', () => {
  // NOTE: sanitizeVariableInput requires an HTMLInputElement (DOM API).
  // We construct a minimal object that satisfies the function's property access.
  // No jest.fn() or vi.fn() is needed since we only read/write plain properties.

  const makeInput = (value: string, cursor?: number): HTMLInputElement => {
    return {
      value,
      selectionStart: cursor ?? value.length,
      selectionEnd: cursor ?? value.length,
    } as unknown as HTMLInputElement
  }

  it('prepends underscore when value starts with a digit', () => {
    const el = makeInput('3abc', 0)
    sanitizeVariableInput(el)
    expect(el.value).toBe('_3abc')
  })

  it('replaces whitespace with underscores', () => {
    const el = makeInput('my var', 6)
    sanitizeVariableInput(el)
    expect(el.value).toBe('my_var')
  })

  it('replaces hyphens with underscores', () => {
    const el = makeInput('my-var', 6)
    sanitizeVariableInput(el)
    expect(el.value).toBe('my_var')
  })

  it('removes invalid characters', () => {
    const el = makeInput('abc@#$def', 9)
    sanitizeVariableInput(el)
    expect(el.value).toBe('abcdef')
  })

  it('leaves a valid identifier unchanged', () => {
    const el = makeInput('myVar_1', 3)
    sanitizeVariableInput(el)
    expect(el.value).toBe('myVar_1')
  })

  it('adjusts cursor position when characters are added', () => {
    const el = makeInput('3abc', 1)
    sanitizeVariableInput(el)
    // underscore prepended: length went from 4 to 5, offset = +1
    expect(el.selectionStart).toBe(2)
    expect(el.selectionEnd).toBe(2)
  })

  it('adjusts cursor position when characters are removed', () => {
    const el = makeInput('ab@cd', 5)
    sanitizeVariableInput(el)
    // @ removed: length went from 5 to 4, offset = -1
    expect(el.value).toBe('abcd')
    expect(el.selectionStart).toBe(4)
    expect(el.selectionEnd).toBe(4)
  })

  it('handles selectionStart being null (defaults to 0)', () => {
    const el = {
      value: 'abc',
      selectionStart: null,
      selectionEnd: null,
    } as unknown as HTMLInputElement
    sanitizeVariableInput(el)
    expect(el.value).toBe('abc')
    expect(el.selectionStart).toBe(0)
  })

  it('handles multiple transformations simultaneously', () => {
    const el = makeInput('1a-b c@d', 8)
    sanitizeVariableInput(el)
    // 1 -> _1, - -> _, space -> _, @ removed
    expect(el.value).toBe('_1a_b_cd')
  })
})
