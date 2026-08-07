import {
  getVariableRestrictionType,
  isGenericTypeName,
  resolveNewVariableType,
  validateVariableType,
} from '../validate-variable-type'

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

  it('keeps the single-entry shape for a singleton generic', () => {
    expect(getVariableRestrictionType('ANY_STRING')).toEqual({ values: ['STRING'], definition: 'base-type' })
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

describe('isGenericTypeName', () => {
  it('recognises ANY and every ANY_* family, case-insensitively', () => {
    expect(isGenericTypeName('ANY')).toBe(true)
    expect(isGenericTypeName('any')).toBe(true)
    expect(isGenericTypeName('ANY_NUM')).toBe(true)
    expect(isGenericTypeName('any_int')).toBe(true)
    expect(isGenericTypeName('ANY_ELEMENTARY')).toBe(true)
  })

  it('rejects concrete and user-defined type names', () => {
    expect(isGenericTypeName('INT')).toBe(false)
    expect(isGenericTypeName('BOOL')).toBe(false)
    expect(isGenericTypeName('TIME')).toBe(false)
    expect(isGenericTypeName('MyStruct')).toBe(false)
    expect(isGenericTypeName('')).toBe(false)
  })
})

describe('resolveNewVariableType', () => {
  it('falls back to DINT when the box is not wired to any pin', () => {
    expect(resolveNewVariableType(undefined)).toEqual({ definition: 'base-type', value: 'dint' })
  })

  it('mirrors a concrete pin type, ignoring any bound siblings', () => {
    expect(resolveNewVariableType('TIME')).toEqual({ definition: 'base-type', value: 'TIME' })
    expect(resolveNewVariableType('BOOL', [{ pinType: 'ANY', variableType: 'REAL' }])).toEqual({
      definition: 'base-type',
      value: 'BOOL',
    })
  })

  it('keeps a derived (user-defined) pin type as-is', () => {
    expect(resolveNewVariableType('MyStruct')).toEqual({ definition: 'derived', value: 'MyStruct' })
  })

  describe('generic pins (issue #479)', () => {
    it('adopts the type already bound to another generic pin of the same block', () => {
      // MOVE: IN : ANY bound to an INT, so OUT : ANY must be an INT too.
      expect(resolveNewVariableType('ANY', [{ pinType: 'ANY', variableType: 'INT' }])).toEqual({
        definition: 'base-type',
        value: 'INT',
      })
      // ADD: IN1 : ANY_NUM bound to a REAL — used to create a SINT.
      expect(resolveNewVariableType('ANY_NUM', [{ pinType: 'ANY_NUM', variableType: 'REAL' }])).toEqual({
        definition: 'base-type',
        value: 'REAL',
      })
    })

    it('accepts a user-defined type bound to an ANY pin', () => {
      expect(resolveNewVariableType('ANY', [{ pinType: 'ANY', variableType: 'MyStruct' }])).toEqual({
        definition: 'derived',
        value: 'MyStruct',
      })
    })

    it('ignores siblings sitting on concrete pins', () => {
      // MOVE's EN : BOOL says nothing about how the ANY pins resolved.
      expect(resolveNewVariableType('ANY_NUM', [{ pinType: 'BOOL', variableType: 'BOOL' }])).toEqual({
        definition: 'base-type',
        value: 'DINT',
      })
    })

    it('ignores siblings whose type the pin would reject', () => {
      expect(resolveNewVariableType('ANY_INT', [{ pinType: 'ANY_NUM', variableType: 'REAL' }])).toEqual({
        definition: 'base-type',
        value: 'DINT',
      })
    })

    it('ignores siblings with no bound type, or a still-generic one', () => {
      expect(
        resolveNewVariableType('ANY_INT', [
          { pinType: 'ANY_INT', variableType: '' },
          { pinType: 'ANY_INT', variableType: 'ANY_INT' },
          { pinType: 'ANY_INT', variableType: 'LINT' },
        ]),
      ).toEqual({ definition: 'base-type', value: 'LINT' })
    })

    it('prefers DINT over the first flattened entry when there is nothing to infer from', () => {
      // The flattened ANY_NUM/ANY_INT sets start at SINT — the old default.
      expect(resolveNewVariableType('ANY_NUM')).toEqual({ definition: 'base-type', value: 'DINT' })
      expect(resolveNewVariableType('ANY_INT')).toEqual({ definition: 'base-type', value: 'DINT' })
      expect(resolveNewVariableType('ANY')).toEqual({ definition: 'base-type', value: 'DINT' })
    })

    it('honours the restriction when DINT is not in it', () => {
      expect(resolveNewVariableType('ANY_BIT')).toEqual({ definition: 'base-type', value: 'BOOL' })
      expect(resolveNewVariableType('ANY_REAL')).toEqual({ definition: 'base-type', value: 'REAL' })
      expect(resolveNewVariableType('ANY_STRING')).toEqual({ definition: 'base-type', value: 'STRING' })
    })

    it('falls back to DINT for an unknown generic name', () => {
      expect(resolveNewVariableType('ANY_NOT_A_GENERIC')).toEqual({ definition: 'base-type', value: 'dint' })
    })
  })
})
