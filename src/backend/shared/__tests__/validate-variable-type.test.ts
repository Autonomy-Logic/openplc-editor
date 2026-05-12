import { getVariableRestrictionType, validateVariableType } from '@root/frontend/utils/PLC/validate-variable-type'

describe('validateVariableType', () => {
  it('returns valid for exact type match', () => {
    const result = validateVariableType('BOOL', 'BOOL')
    expect(result).toEqual({ isValid: true, error: undefined })
  })

  it('returns valid for case-insensitive match', () => {
    const result = validateVariableType('bool', 'BOOL')
    expect(result).toEqual({ isValid: true, error: undefined })
  })

  it('returns invalid for type mismatch', () => {
    const result = validateVariableType('INT', 'BOOL')
    expect(result).toEqual({
      isValid: false,
      error: 'Expected: BOOL, Got: INT',
    })
  })

  it('returns valid for ANY expected type', () => {
    const result = validateVariableType('DINT', 'ANY')
    expect(result).toEqual({ isValid: true, error: undefined })
  })

  it('returns valid for ANY_INT when selected type is compatible', () => {
    const result = validateVariableType('INT', 'ANY_INT')
    expect(result.isValid).toBe(true)
  })

  it('returns invalid for ANY_INT when selected type is incompatible', () => {
    const result = validateVariableType('BOOL', 'ANY_INT')
    expect(result.isValid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns valid for ANY_NUM when selected type is numeric', () => {
    const result = validateVariableType('REAL', 'ANY_NUM')
    expect(result.isValid).toBe(true)
  })

  it('returns invalid for ANY_NUM when selected type is not numeric', () => {
    const result = validateVariableType('BOOL', 'ANY_NUM')
    expect(result.isValid).toBe(false)
  })

  it('returns valid for ANY_STRING when selected type is STRING', () => {
    const result = validateVariableType('STRING', 'ANY_STRING')
    expect(result.isValid).toBe(true)
  })

  it('returns invalid for ANY_STRING when selected type is incompatible', () => {
    const result = validateVariableType('INT', 'ANY_STRING')
    expect(result.isValid).toBe(false)
  })

  // Regression: composite generics like ANY_ELEMENTARY / ANY_MAGNITUDE /
  // ANY_INTEGRAL are `z.union(z.literal(ANY_*))` whose `.options` are
  // ZodLiterals pointing at OTHER generics, not strings.  The previous
  // one-level expansion crashed with "subValue.toUpperCase is not a
  // function" when the recursion hit one of these and tried to map
  // strings over what were actually ZodLiteral instances.
  //
  // GE / LE / GT / LT / EQ / NE blocks all take ANY_ELEMENTARY per
  // IEC 61131-3, so connecting any variable to one of those triggered
  // the crash on every project that uses them.
  describe('nested generics (regression: ANY_ELEMENTARY → ANY_MAGNITUDE → REAL)', () => {
    it('accepts REAL for ANY_MAGNITUDE', () => {
      const result = validateVariableType('REAL', 'ANY_MAGNITUDE')
      expect(result.isValid).toBe(true)
    })

    it('accepts INT for ANY_MAGNITUDE', () => {
      const result = validateVariableType('INT', 'ANY_MAGNITUDE')
      expect(result.isValid).toBe(true)
    })

    it('accepts TIME for ANY_MAGNITUDE (literal embedded in union)', () => {
      const result = validateVariableType('TIME', 'ANY_MAGNITUDE')
      expect(result.isValid).toBe(true)
    })

    it('rejects BOOL for ANY_MAGNITUDE', () => {
      const result = validateVariableType('BOOL', 'ANY_MAGNITUDE')
      expect(result.isValid).toBe(false)
    })

    it('accepts REAL for ANY_ELEMENTARY (two levels of nesting)', () => {
      const result = validateVariableType('REAL', 'ANY_ELEMENTARY')
      expect(result.isValid).toBe(true)
    })

    it('accepts BOOL for ANY_ELEMENTARY (via ANY_BIT)', () => {
      const result = validateVariableType('BOOL', 'ANY_ELEMENTARY')
      expect(result.isValid).toBe(true)
    })

    it('accepts INT for ANY_INTEGRAL', () => {
      const result = validateVariableType('INT', 'ANY_INTEGRAL')
      expect(result.isValid).toBe(true)
    })

    it('accepts WORD for ANY_INTEGRAL', () => {
      const result = validateVariableType('WORD', 'ANY_INTEGRAL')
      expect(result.isValid).toBe(true)
    })

    it('rejects REAL for ANY_INTEGRAL', () => {
      const result = validateVariableType('REAL', 'ANY_INTEGRAL')
      expect(result.isValid).toBe(false)
    })
  })
})

describe('getVariableRestrictionType', () => {
  it('returns undefined values/definition for ANY', () => {
    const result = getVariableRestrictionType('ANY')
    expect(result).toEqual({ values: undefined, definition: undefined })
  })

  it('returns base-type values for ANY_INT', () => {
    const result = getVariableRestrictionType('ANY_INT')
    expect(result.definition).toBe('base-type')
    expect(Array.isArray(result.values)).toBe(true)
    expect((result.values as string[]).length).toBeGreaterThan(0)
  })

  it('returns base-type for known base types', () => {
    const result = getVariableRestrictionType('BOOL')
    expect(result.definition).toBe('base-type')
    expect(result.values).toBe('BOOL')
  })

  it('returns derived for unknown types', () => {
    const result = getVariableRestrictionType('MyCustomType')
    expect(result.definition).toBe('derived')
    expect(result.values).toBe('MyCustomType')
  })

  it('returns base-type values for ANY_NUM', () => {
    const result = getVariableRestrictionType('ANY_NUM')
    expect(result.definition).toBe('base-type')
    expect(Array.isArray(result.values)).toBe(true)
  })

  it('returns base-type values for ANY_STRING (single-option generic)', () => {
    const result = getVariableRestrictionType('ANY_STRING')
    expect(result.definition).toBe('base-type')
    expect(Array.isArray(result.values)).toBe(true)
    expect(result.values as string[]).toContain('STRING')
  })

  // Same regression scope as above — these composite generics couldn't
  // be flattened before, so callers consuming the result for UI hints
  // (e.g. block-input type tooltips) got an empty list at best, and the
  // crashy path at worst.
  it('flattens ANY_MAGNITUDE to its concrete base types', () => {
    const result = getVariableRestrictionType('ANY_MAGNITUDE')
    expect(result.definition).toBe('base-type')
    expect(result.values).toEqual(expect.arrayContaining(['REAL', 'LREAL', 'INT', 'DINT', 'TIME']))
  })

  it('flattens ANY_ELEMENTARY across two nesting levels', () => {
    const result = getVariableRestrictionType('ANY_ELEMENTARY')
    expect(result.definition).toBe('base-type')
    // Must reach base types through both ANY_MAGNITUDE and ANY_BIT.
    expect(result.values).toEqual(expect.arrayContaining(['REAL', 'INT', 'BOOL', 'WORD']))
  })

  it('flattens ANY_INTEGRAL (ANY_INT ∪ ANY_BIT)', () => {
    const result = getVariableRestrictionType('ANY_INTEGRAL')
    expect(result.definition).toBe('base-type')
    expect(result.values).toEqual(expect.arrayContaining(['INT', 'BOOL', 'BYTE', 'DWORD']))
  })
})
