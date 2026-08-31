import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { SHM_SCALAR_TYPES } from '../../python/shm-type-map'
import {
  generateStructMember,
  getArrayBaseTypeValue,
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
  isVariableLengthArray,
  mapBaseTypeToIEC,
  mapUserTypeToIEC,
  multiDimensionalContainerType,
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
describe('the two native languages accept the same elementary types', () => {
  // A type either crosses into both a C++ block and a Python block, or neither.
  // They drifted once already: TIME / DATE / TOD / DT / WSTRING were in the
  // Python shared-memory table but absent from the C++ map, so a C++ block
  // declaring `TIME` emitted `strucpp::TIME` — a name that does not exist — and
  // the build failed on generated code the user never wrote. Nothing catches
  // that except a build, and nobody builds every type by hand.
  const scalarOf = (value: string): PLCVariable => ({
    name: 'v',
    class: 'input',
    type: { definition: 'base-type', value },
    location: '',
    documentation: '',
    debug: false,
  })

  const pythonTypes = [...Object.keys(SHM_SCALAR_TYPES), 'string', 'wstring']

  it.each(pythonTypes)('%s has a C++ spelling too', (type) => {
    expect(mapBaseTypeToIEC(type)).toMatch(/^IEC_/)
  })

  it.each(pythonTypes)('%s resolves for a C++ struct member', (type) => {
    expect(generateStructMember(scalarOf(type))).toMatch(/^ {2}strucpp::IEC_\w+ \*V;\n$/)
  })

  // A declared length has to name the template directly: `IEC_STRING` is a fixed
  // alias for `IECStringVar<254>`. The spelling must match what STruC++ emitted
  // for the same declaration, because `<POU>_VARS` holds a pointer to the very
  // member the function block declares — a disagreement here is an ABI mismatch,
  // not a compile error.
  describe('a declared string length on a native block pin', () => {
    it('names the template rather than the 254-character alias', () => {
      expect(mapBaseTypeToIEC('STRING(23)')).toBe('IECStringVar<23>')
      expect(mapBaseTypeToIEC('WSTRING(8)')).toBe('IECWStringVar<8>')
    })

    it('reaches the struct member', () => {
      expect(generateStructMember(scalarOf('STRING(23)'))).toBe('  strucpp::IECStringVar<23> *V;\n')
    })

    it('leaves an unqualified string on the alias', () => {
      expect(mapBaseTypeToIEC('string')).toBe('IEC_STRING')
      expect(generateStructMember(scalarOf('STRING'))).toBe('  strucpp::IEC_STRING *V;\n')
    })

    it('reads the bracket form too, since the parser normalises either way', () => {
      expect(mapBaseTypeToIEC('STRING[23]')).toBe('IECStringVar<23>')
    })

    it('does not invent a template for a length nothing can carry', () => {
      // Falls through to the ordinary spelling rule rather than emitting
      // `IECStringVar<0>`, which would not compile.
      expect(mapBaseTypeToIEC('STRING(0)')).not.toContain('IECStringVar<')
      expect(mapBaseTypeToIEC('INT(4)')).not.toContain('IECStringVar<')
    })

    it('carries the element length of an array of strings', () => {
      const arrayOfSized: PLCVariable = {
        name: 'v',
        class: 'input',
        type: {
          definition: 'array',
          value: 'ARRAY[0..3] OF STRING(23)',
          data: {
            baseType: { definition: 'base-type', value: 'STRING(23)' },
            dimensions: [{ dimension: '0..3' }],
          },
        },
        location: '',
        documentation: '',
        debug: false,
      }
      expect(getVariableIECType(arrayOfSized)).toBe('IECStringVar<23>')
    })
  })

  it('accepts the long spellings IEC 61131-3 allows for the calendar types', () => {
    expect(mapBaseTypeToIEC('time_of_day')).toBe('IEC_TOD')
    expect(mapBaseTypeToIEC('date_and_time')).toBe('IEC_DT')
  })
})

describe('mapUserTypeToIEC', () => {
  // strucpp declares a structure or enumeration and then aliases it
  // (`using IEC_MOTOR = MOTOR`), but a function block class gets no alias. Only
  // the project's declared data types carry the prefix; anything else — an FB
  // instance — keeps the bare class name, because `IEC_HELPER` would name a
  // type that was never declared.
  it('prefixes a name the project declares as a data type', () => {
    expect(mapUserTypeToIEC('Motor', new Set(['MOTOR']))).toBe('IEC_MOTOR')
  })

  it('leaves a name the project does not declare bare', () => {
    expect(mapUserTypeToIEC('Helper', new Set(['MOTOR']))).toBe('HELPER')
  })

  it('leaves every name bare when no data-type set is supplied', () => {
    // The set is optional so call sites that predate user types keep working;
    // with nothing to match against, no name can be a data type.
    expect(mapUserTypeToIEC('Motor')).toBe('MOTOR')
  })

  it('matches case-insensitively, since the set is uppercased by the caller', () => {
    expect(mapUserTypeToIEC('mOtOr', new Set(['MOTOR']))).toBe('IEC_MOTOR')
  })
})

describe('generic types on a native block pin', () => {
  // A native block may declare a VAR_INPUT with one of CODESYS's seven generic
  // types. Every one is the same `IEC_ANY` descriptor at the ABI: the family
  // constrains what the caller may pass, which the compiler checks at the call
  // site, not what the block receives.
  const genericPin = (typeName: string): PLCVariable => ({
    name: 'p',
    class: 'input',
    type: { definition: 'user-data-type', value: typeName },
    location: '',
    documentation: '',
    debug: false,
  })

  it.each(['ANY', 'ANY_BIT', 'ANY_DATE', 'ANY_NUM', 'ANY_REAL', 'ANY_INT', 'ANY_STRING'])(
    'spells %s as the IEC_ANY descriptor',
    (generic) => {
      expect(mapUserTypeToIEC(generic)).toBe('IEC_ANY')
      expect(generateStructMember(genericPin(generic))).toBe('  strucpp::IEC_ANY *P;\n')
    },
  )

  it('matches case-insensitively, as every other type spelling does', () => {
    expect(mapUserTypeToIEC('any_int')).toBe('IEC_ANY')
  })

  it('leaves a user type called ANYTHING alone — only the exact names are generic', () => {
    expect(mapUserTypeToIEC('ANYTHING', new Set(['ANYTHING']))).toBe('IEC_ANYTHING')
  })

  it('spells __SYSTEM.AnyType as the same descriptor', () => {
    // The concrete structure a generic parameter carries. A native block may
    // declare one to keep what it was passed.
    expect(mapUserTypeToIEC('__SYSTEM.AnyType')).toBe('IEC_ANY')
    expect(generateStructMember(genericPin('__SYSTEM.AnyType'))).toBe('  strucpp::IEC_ANY *P;\n')
  })
})

describe('variable-length arrays', () => {
  // `ARRAY [*]` is legal as a function block's in-out variable. strucpp passes
  // it as an ArrayView carrying the runtime bounds, so the struct holds a
  // pointer to the view: there is no lower bound yet to offset by, and an
  // element pointer would drop the only record of the length.
  const vlaOfRank = (
    dimensions: string[],
    baseType = 'INT',
    baseDefinition: 'base-type' | 'user-data-type' = 'base-type',
  ): PLCVariable => ({
    name: 'values',
    class: 'inOut',
    type: {
      definition: 'array',
      value: `ARRAY [${dimensions.join(', ')}] OF ${baseType}`,
      data: {
        baseType: { definition: baseDefinition, value: baseType },
        dimensions: dimensions.map((dimension) => ({ dimension })),
      },
    },
    location: '',
    documentation: '',
    debug: false,
  })

  it('passes a 1-D VLA as a pointer to the view, not to the first element', () => {
    expect(generateStructMember(vlaOfRank(['*']))).toBe('  strucpp::ArrayView1D<strucpp::IEC_INT> *VALUES;\n')
  })

  it('passes a 2-D VLA as a view of its own rank', () => {
    expect(generateStructMember(vlaOfRank(['*', '*'], 'REAL'))).toBe(
      '  strucpp::ArrayView2D<strucpp::IEC_REAL> *VALUES;\n',
    )
  })

  it('spells a user-defined element type the way strucpp declares it', () => {
    const named = new Set(['MOTOR'])
    expect(generateStructMember(vlaOfRank(['*'], 'MOTOR', 'user-data-type'), named)).toBe(
      '  strucpp::ArrayView1D<strucpp::IEC_MOTOR> *VALUES;\n',
    )
  })

  it('tolerates whitespace around the bound', () => {
    expect(isVariableLengthArray(vlaOfRank([' * ']))).toBe(true)
  })

  it('leaves a fixed array on the element-pointer path', () => {
    expect(isVariableLengthArray(vlaOfRank(['0..9']))).toBe(false)
    expect(generateStructMember(vlaOfRank(['0..9']))).toBe('  strucpp::IEC_INT *VALUES;\n')
  })

  it('does not treat a partly-variable shape as a VLA, since IEC allows no such array', () => {
    expect(isVariableLengthArray(vlaOfRank(['*', '0..3']))).toBe(false)
  })

  it('returns null past rank two, for which strucpp declares no ArrayView', () => {
    expect(isVariableLengthArray(vlaOfRank(['*', '*', '*']))).toBe(false)
  })

  it('returns false for anything that is not an array', () => {
    const scalar: PLCVariable = {
      name: 'x',
      class: 'input',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    }

    expect(isVariableLengthArray(scalar)).toBe(false)
  })
})

describe('multiDimensionalContainerType', () => {
  const arrayOfRank = (
    dimensions: string[],
    baseType = 'INT',
    baseDefinition: 'base-type' | 'user-data-type' = 'base-type',
  ): PLCVariable => ({
    name: 'grid',
    class: 'input',
    type: {
      definition: 'array',
      value: `ARRAY [${dimensions.join(', ')}] OF ${baseType}`,
      data: {
        baseType: { definition: baseDefinition, value: baseType },
        dimensions: dimensions.map((dimension) => ({ dimension })),
      },
    },
    location: '',
    documentation: '',
    debug: false,
  })

  it('names the 2-D container with the user’s own bounds', () => {
    expect(multiDimensionalContainerType(arrayOfRank(['1..2', '0..3']))).toBe('Array2D<strucpp::IEC_INT, 1, 2, 0, 3>')
  })

  it('names the 3-D container', () => {
    expect(multiDimensionalContainerType(arrayOfRank(['0..1', '0..1', '0..1']))).toBe(
      'Array3D<strucpp::IEC_INT, 0, 1, 0, 1, 0, 1>',
    )
  })

  it('returns null for rank one, which is passed as an offset element pointer', () => {
    // `arr[i]` with IEC indices is a better surface than `arr(i)`, and rank one
    // is the only rank where the offset trick works.
    expect(multiDimensionalContainerType(arrayOfRank(['0..9']))).toBeNull()
  })

  it('returns null past rank three, for which strucpp declares no alias', () => {
    expect(multiDimensionalContainerType(arrayOfRank(['0..1', '0..1', '0..1', '0..1']))).toBeNull()
  })

  it('returns null when a bound cannot be read rather than guessing one', () => {
    expect(multiDimensionalContainerType(arrayOfRank(['0..1', 'nonsense']))).toBeNull()
  })

  it('returns null for anything that is not an array', () => {
    const scalar: PLCVariable = {
      name: 'x',
      class: 'input',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    }

    expect(multiDimensionalContainerType(scalar)).toBeNull()
  })

  it('returns null for an array declaration carrying no dimension data', () => {
    const bare: PLCVariable = {
      name: 'grid',
      class: 'input',
      type: { definition: 'array', value: 'ARRAY [0..1, 0..1] OF INT' },
      location: '',
      documentation: '',
      debug: false,
    }

    expect(multiDimensionalContainerType(bare)).toBeNull()
  })

  it('applies the user-defined type spelling to the element type', () => {
    // Built with the user-defined element type rather than mutated into one
    // afterwards, so the fixture needs no non-null assertion to reach into
    // `type.data`.
    const v = arrayOfRank(['0..1', '0..1'], 'Motor', 'user-data-type')

    expect(multiDimensionalContainerType(v, new Set(['MOTOR']))).toBe('Array2D<strucpp::IEC_MOTOR, 0, 1, 0, 1>')
  })

  it('makes generateStructMember emit a pointer to the container', () => {
    expect(generateStructMember(arrayOfRank(['1..2', '0..3']))).toBe(
      '  strucpp::Array2D<strucpp::IEC_INT, 1, 2, 0, 3> *GRID;\n',
    )
  })
})

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
