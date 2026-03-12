import { validateVariableType, getVariableRestrictionType } from '../validate-variable-type'

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
    expect(result.values).toBe('bool')
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
    expect((result.values as string[])).toContain('string')
  })
})
