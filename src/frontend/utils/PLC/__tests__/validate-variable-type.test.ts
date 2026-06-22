import { getVariableRestrictionType, validateVariableType } from '../validate-variable-type'

describe('validateVariableType', () => {
  it('accepts anything for the bare ANY generic', () => {
    expect(validateVariableType('BOOL', 'ANY').isValid).toBe(true)
    expect(validateVariableType('REAL', 'ANY').isValid).toBe(true)
  })

  it('case-insensitively matches concrete types', () => {
    expect(validateVariableType('bool', 'BOOL').isValid).toBe(true)
    expect(validateVariableType('BOOL', 'bool').isValid).toBe(true)
    expect(validateVariableType('INT', 'BOOL').isValid).toBe(false)
  })

  it('resolves leaf generics (ANY_INT, ANY_BIT, ANY_REAL) to their base type set', () => {
    expect(validateVariableType('INT', 'ANY_INT').isValid).toBe(true)
    expect(validateVariableType('LREAL', 'ANY_REAL').isValid).toBe(true)
    expect(validateVariableType('BOOL', 'ANY_BIT').isValid).toBe(true)
    expect(validateVariableType('REAL', 'ANY_INT').isValid).toBe(false)
  })

  describe('composite generics (regression for EQ block crash)', () => {
    // Composite generics are unions of OTHER generic literals, not flat
    // strings: their `.options` contains ZodLiteral instances pointing
    // back into the schema. A naive `.toLowerCase()` walker over
    // `.options` crashes on these — the validator must recurse.

    it('ANY_NUM accepts every INT and REAL subtype', () => {
      // ANY_NUM = ANY_INT ∪ ANY_REAL
      for (const t of ['SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT', 'REAL', 'LREAL']) {
        expect(validateVariableType(t, 'ANY_NUM').isValid).toBe(true)
      }
      expect(validateVariableType('BOOL', 'ANY_NUM').isValid).toBe(false)
      expect(validateVariableType('STRING', 'ANY_NUM').isValid).toBe(false)
    })

    it('ANY_INTEGRAL accepts INT and BIT subtypes', () => {
      // ANY_INTEGRAL = ANY_INT ∪ ANY_BIT
      expect(validateVariableType('INT', 'ANY_INTEGRAL').isValid).toBe(true)
      expect(validateVariableType('BOOL', 'ANY_INTEGRAL').isValid).toBe(true)
      expect(validateVariableType('DWORD', 'ANY_INTEGRAL').isValid).toBe(true)
      expect(validateVariableType('REAL', 'ANY_INTEGRAL').isValid).toBe(false)
    })

    it('ANY_MAGNITUDE accepts INT, REAL, and TIME', () => {
      // ANY_MAGNITUDE = ANY_REAL ∪ ANY_INT ∪ TIME (plain literal embedded)
      expect(validateVariableType('REAL', 'ANY_MAGNITUDE').isValid).toBe(true)
      expect(validateVariableType('INT', 'ANY_MAGNITUDE').isValid).toBe(true)
      expect(validateVariableType('TIME', 'ANY_MAGNITUDE').isValid).toBe(true)
      expect(validateVariableType('BOOL', 'ANY_MAGNITUDE').isValid).toBe(false)
    })

    it('ANY_ELEMENTARY accepts the full base-type closure (EQ block path)', () => {
      // ANY_ELEMENTARY = ANY_MAGNITUDE ∪ ANY_BIT ∪ ANY_CHARS ∪ ANY_DATE.
      // This is what EQ/NE/LT/GT/LE/GE comparator inputs declare and
      // what triggered the original "subValue.toLowerCase is not a
      // function" crash when adding an EQ block to a Ladder rung.
      for (const t of [
        'SINT',
        'INT',
        'DINT',
        'LINT',
        'USINT',
        'UINT',
        'UDINT',
        'ULINT',
        'REAL',
        'LREAL',
        'BOOL',
        'BYTE',
        'WORD',
        'DWORD',
        'LWORD',
        'TIME',
        'DATE',
        'TOD',
        'DT',
      ]) {
        expect(validateVariableType(t, 'ANY_ELEMENTARY')).toEqual({ isValid: true })
      }
    })
  })

  describe('pointer / address-word compatibility (ADR block)', () => {
    // ADR() returns a pointer-width address typed as ULINT (CODESYS __XWORD).
    // A POINTER TO <T> variable holds such an address, so the two must be
    // interchangeable at a block pin, independently of <T> and direction.
    it('accepts a POINTER TO <T> variable on a ULINT pin', () => {
      expect(validateVariableType('POINTER TO INT', 'ULINT').isValid).toBe(true)
      expect(validateVariableType('POINTER TO REAL', 'ULINT').isValid).toBe(true)
      expect(validateVariableType('pointer to int', 'ulint').isValid).toBe(true)
    })

    it('accepts a ULINT variable on a POINTER TO <T> pin (reverse direction)', () => {
      expect(validateVariableType('ULINT', 'POINTER TO INT').isValid).toBe(true)
    })

    it('does not treat other integer words as pointer-compatible', () => {
      expect(validateVariableType('POINTER TO INT', 'UDINT').isValid).toBe(false)
      expect(validateVariableType('POINTER TO INT', 'DWORD').isValid).toBe(false)
      expect(validateVariableType('POINTER TO INT', 'INT').isValid).toBe(false)
    })

    it('still rejects a plain INT on a ULINT pin', () => {
      expect(validateVariableType('INT', 'ULINT').isValid).toBe(false)
    })
  })

  it('returns a non-empty error message when validation fails', () => {
    const result = validateVariableType('BOOL', 'ANY_REAL')
    expect(result.isValid).toBe(false)
    expect(result.error).toMatch(/Expected/i)
  })
})

describe('getVariableRestrictionType', () => {
  it('returns undefined values for the bare ANY generic', () => {
    expect(getVariableRestrictionType('ANY')).toEqual({ values: undefined, definition: undefined })
  })

  it('flattens composite generics like ANY_ELEMENTARY without crashing', () => {
    const restriction = getVariableRestrictionType('ANY_ELEMENTARY')
    expect(restriction.definition).toBe('base-type')
    expect(Array.isArray(restriction.values)).toBe(true)
    expect((restriction.values as string[]).length).toBeGreaterThan(10)
    expect(restriction.values).toContain('BOOL')
    expect(restriction.values).toContain('REAL')
    expect(restriction.values).toContain('TIME')
  })

  it('returns the concrete base-type name uppercased', () => {
    expect(getVariableRestrictionType('BOOL')).toEqual({ values: 'BOOL', definition: 'base-type' })
  })

  it('preserves casing for derived (user-defined) type names', () => {
    expect(getVariableRestrictionType('MyDerivedType')).toEqual({
      values: 'MyDerivedType',
      definition: 'derived',
    })
  })
})
