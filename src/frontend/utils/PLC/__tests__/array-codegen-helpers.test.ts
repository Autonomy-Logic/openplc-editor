import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import {
  generateStructMember,
  getArrayBaseTypeValue,
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
  mapBaseTypeToIEC,
} from '../array-codegen-helpers'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function makeScalarVar(name: string, baseType: string): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'base-type', value: baseType },
    location: '',
    documentation: '',
  }
}

function makeArrayVar(
  name: string,
  baseTypeDef: 'base-type' | 'user-data-type',
  baseTypeVal: string,
  dimensions: string[],
): PLCVariable {
  return {
    name,
    class: 'local',
    type: {
      definition: 'array',
      value: `ARRAY[${dimensions.join(', ')}] OF ${baseTypeVal}`,
      data: {
        baseType: { definition: baseTypeDef, value: baseTypeVal },
        dimensions: dimensions.map((d) => ({ dimension: d })),
      },
    },
    location: '',
    documentation: '',
  }
}

function makeUserTypeVar(name: string, value: string): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'user-data-type', value },
    location: '',
    documentation: '',
  }
}

// ---------------------------------------------------------------------------
// isArrayVariable
// ---------------------------------------------------------------------------
describe('isArrayVariable', () => {
  it('returns true for array variables', () => {
    expect(isArrayVariable(makeArrayVar('arr', 'base-type', 'INT', ['0..5']))).toBe(true)
  })

  it('returns false for scalar variables', () => {
    expect(isArrayVariable(makeScalarVar('x', 'INT'))).toBe(false)
  })

  it('returns false for user data type variables', () => {
    expect(isArrayVariable(makeUserTypeVar('x', 'MyStruct'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getArrayTotalElements
// ---------------------------------------------------------------------------
describe('getArrayTotalElements', () => {
  it('returns correct count for a 1D array', () => {
    expect(getArrayTotalElements(makeArrayVar('arr', 'base-type', 'INT', ['0..9']))).toBe(10)
  })

  it('returns product of dimensions for multi-dimensional arrays', () => {
    expect(getArrayTotalElements(makeArrayVar('matrix', 'base-type', 'INT', ['0..2', '0..3']))).toBe(12)
  })

  it('returns 0 for non-array variables', () => {
    expect(getArrayTotalElements(makeScalarVar('x', 'INT'))).toBe(0)
  })

  it('returns 0 when data is missing', () => {
    const v: PLCVariable = {
      name: 'broken',
      class: 'local',
      type: { definition: 'array', value: 'ARRAY[0..5] OF INT' },
      location: '',
      documentation: '',
    }
    expect(getArrayTotalElements(v)).toBe(0)
  })

  it('returns 0 when a dimension range is invalid', () => {
    const v: PLCVariable = {
      name: 'bad',
      class: 'local',
      type: {
        definition: 'array',
        value: 'ARRAY[bad] OF INT',
        data: {
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: 'bad' }],
        },
      },
      location: '',
      documentation: '',
    }
    expect(getArrayTotalElements(v)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getArrayBaseTypeValue
// ---------------------------------------------------------------------------
describe('getArrayBaseTypeValue', () => {
  it('returns the base type value for an array', () => {
    expect(getArrayBaseTypeValue(makeArrayVar('arr', 'base-type', 'INT', ['0..5']))).toBe('INT')
  })

  it('returns empty string for non-array', () => {
    expect(getArrayBaseTypeValue(makeScalarVar('x', 'INT'))).toBe('')
  })

  it('returns empty string for array without data', () => {
    const v: PLCVariable = {
      name: 'broken',
      class: 'local',
      type: { definition: 'array', value: 'ARRAY[0..5] OF INT' },
      location: '',
      documentation: '',
    }
    expect(getArrayBaseTypeValue(v)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// mapBaseTypeToIEC
// ---------------------------------------------------------------------------
describe('mapBaseTypeToIEC', () => {
  it('maps known base types to IEC C names', () => {
    expect(mapBaseTypeToIEC('bool')).toBe('IEC_BOOL')
    expect(mapBaseTypeToIEC('sint')).toBe('IEC_SINT')
    expect(mapBaseTypeToIEC('int')).toBe('IEC_INT')
    expect(mapBaseTypeToIEC('dint')).toBe('IEC_DINT')
    expect(mapBaseTypeToIEC('lint')).toBe('IEC_LINT')
    expect(mapBaseTypeToIEC('usint')).toBe('IEC_USINT')
    expect(mapBaseTypeToIEC('uint')).toBe('IEC_UINT')
    expect(mapBaseTypeToIEC('udint')).toBe('IEC_UDINT')
    expect(mapBaseTypeToIEC('ulint')).toBe('IEC_ULINT')
    expect(mapBaseTypeToIEC('byte')).toBe('IEC_BYTE')
    expect(mapBaseTypeToIEC('word')).toBe('IEC_WORD')
    expect(mapBaseTypeToIEC('dword')).toBe('IEC_DWORD')
    expect(mapBaseTypeToIEC('lword')).toBe('IEC_LWORD')
    expect(mapBaseTypeToIEC('real')).toBe('IEC_REAL')
    expect(mapBaseTypeToIEC('lreal')).toBe('IEC_LREAL')
    expect(mapBaseTypeToIEC('string')).toBe('IEC_STRING')
  })

  it('is case-insensitive', () => {
    expect(mapBaseTypeToIEC('INT')).toBe('IEC_INT')
    expect(mapBaseTypeToIEC('Bool')).toBe('IEC_BOOL')
  })

  it('falls back to uppercased value for unknown types', () => {
    expect(mapBaseTypeToIEC('mytype')).toBe('MYTYPE')
  })
})

// ---------------------------------------------------------------------------
// getVariableIECType
// ---------------------------------------------------------------------------
describe('getVariableIECType', () => {
  it('returns IEC type for scalar base-type variable', () => {
    expect(getVariableIECType(makeScalarVar('x', 'int'))).toBe('IEC_INT')
  })

  it('returns IEC type for array base-type element', () => {
    expect(getVariableIECType(makeArrayVar('arr', 'base-type', 'real', ['0..5']))).toBe('IEC_REAL')
  })

  it('returns uppercased value for user-data-type', () => {
    expect(getVariableIECType(makeUserTypeVar('x', 'MyStruct'))).toBe('MYSTRUCT')
  })

  it('returns IEC type for array without data (falls through to value)', () => {
    const v: PLCVariable = {
      name: 'arr',
      class: 'local',
      type: { definition: 'array', value: 'customArr' },
      location: '',
      documentation: '',
    }
    expect(getVariableIECType(v)).toBe('CUSTOMARR')
  })
})

// ---------------------------------------------------------------------------
// getArrayStartIndex
// ---------------------------------------------------------------------------
describe('getArrayStartIndex', () => {
  it('returns the lower bound of the first dimension', () => {
    expect(getArrayStartIndex(makeArrayVar('arr', 'base-type', 'INT', ['3..7']))).toBe(3)
  })

  it('returns 0 for arrays starting at 0', () => {
    expect(getArrayStartIndex(makeArrayVar('arr', 'base-type', 'INT', ['0..5']))).toBe(0)
  })

  it('returns 0 for non-array variables', () => {
    expect(getArrayStartIndex(makeScalarVar('x', 'INT'))).toBe(0)
  })

  it('returns 0 for array without data', () => {
    const v: PLCVariable = {
      name: 'arr',
      class: 'local',
      type: { definition: 'array', value: 'ARRAY[0..5] OF INT' },
      location: '',
      documentation: '',
    }
    expect(getArrayStartIndex(v)).toBe(0)
  })

  it('returns 0 when dimensions array is empty', () => {
    const v: PLCVariable = {
      name: 'arr',
      class: 'local',
      type: {
        definition: 'array',
        value: 'ARRAY[] OF INT',
        data: {
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [],
        },
      },
      location: '',
      documentation: '',
    }
    expect(getArrayStartIndex(v)).toBe(0)
  })

  it('returns 0 when first dimension range is invalid', () => {
    const v: PLCVariable = {
      name: 'arr',
      class: 'local',
      type: {
        definition: 'array',
        value: 'ARRAY[bad] OF INT',
        data: {
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: 'bad' }],
        },
      },
      location: '',
      documentation: '',
    }
    expect(getArrayStartIndex(v)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// generateStructMember
// ---------------------------------------------------------------------------
describe('generateStructMember', () => {
  // Numeric/time/bit base types resolve to strucpp's IECVar wrapper —
  // the c_blocks_code.cpp baseline keeps file-scope raw typedefs for
  // user locals; the auto-generated struct uses `strucpp::IEC_*` so
  // user writes via the macro route through `IECVar::operator=` and
  // respect forcing.
  it('generates a strucpp-qualified pointer member for scalar variables', () => {
    const result = generateStructMember(makeScalarVar('myVar', 'int'))
    expect(result).toBe('  strucpp::IEC_INT *MYVAR;\n')
  })

  it('generates a strucpp-qualified pointer member for array variables', () => {
    const result = generateStructMember(makeArrayVar('sensors', 'base-type', 'real', ['0..5']))
    expect(result).toBe('  strucpp::IEC_REAL *SENSORS;\n')
  })

  // STRING / WSTRING use the same `strucpp::` qualification as every
  // other elementary type — the field is a pointer to
  // `IECStringVar<254>`, identical to the wrapper every numeric pin
  // uses.  No raw POD shape, no scan-boundary stub.
  it('generates a strucpp-qualified pointer member for STRING', () => {
    const result = generateStructMember(makeScalarVar('msg', 'string'))
    expect(result).toBe('  strucpp::IEC_STRING *MSG;\n')
  })
})
