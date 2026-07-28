import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import {
  parseArrayAccess,
  parseDimensionRange,
  resolveArrayElement,
  resolveArrayVariableByName,
  validateArrayIndices,
} from '../array-variable-utils'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function makeScalarVar(name: string, baseType = 'INT'): PLCVariable {
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

// ---------------------------------------------------------------------------
// parseDimensionRange re-export
// ---------------------------------------------------------------------------
describe('parseDimensionRange (re-exported from array-variable-utils)', () => {
  it('parses a valid range via the re-export', () => {
    const result = parseDimensionRange('0..5')
    expect(result).toEqual({ lower: 0, upper: 5 })
  })
})

// ---------------------------------------------------------------------------
// parseArrayAccess
// ---------------------------------------------------------------------------
describe('parseArrayAccess', () => {
  it('parses a simple 1D access', () => {
    const result = parseArrayAccess('Sensor[0]')
    expect(result).toEqual({ baseName: 'Sensor', indices: [0] })
  })

  it('parses a multi-dimensional access', () => {
    const result = parseArrayAccess('Matrix[1,2]')
    expect(result).toEqual({ baseName: 'Matrix', indices: [1, 2] })
  })

  it('parses negative indices', () => {
    const result = parseArrayAccess('arr[-3]')
    expect(result).toEqual({ baseName: 'arr', indices: [-3] })
  })

  it('handles spaces around indices', () => {
    const result = parseArrayAccess('arr[ 1 , 2 ]')
    expect(result).toEqual({ baseName: 'arr', indices: [1, 2] })
  })

  it('parses names with underscores and digits', () => {
    const result = parseArrayAccess('my_var2[5]')
    expect(result).toEqual({ baseName: 'my_var2', indices: [5] })
  })

  it('returns null for non-array names', () => {
    expect(parseArrayAccess('simple_var')).toBeNull()
  })

  it('returns null for empty brackets', () => {
    // Empty brackets won't match because "".split(",") gives [""] which is not a valid integer
    expect(parseArrayAccess('arr[]')).toBeNull()
  })

  it('returns null for non-numeric indices', () => {
    expect(parseArrayAccess('arr[abc]')).toBeNull()
  })

  it('returns null for float indices', () => {
    expect(parseArrayAccess('arr[1.5]')).toBeNull()
  })

  it('returns null when name starts with a digit', () => {
    expect(parseArrayAccess('1arr[0]')).toBeNull()
  })

  it('returns null for malformed bracket expressions', () => {
    expect(parseArrayAccess('arr[0')).toBeNull()
    expect(parseArrayAccess('arr0]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// validateArrayIndices
// ---------------------------------------------------------------------------
describe('validateArrayIndices', () => {
  it('validates indices within range', () => {
    const dims = [{ dimension: '0..5' }]
    expect(validateArrayIndices([3], dims)).toBe(true)
  })

  it('validates lower bound is inclusive', () => {
    const dims = [{ dimension: '0..5' }]
    expect(validateArrayIndices([0], dims)).toBe(true)
  })

  it('validates upper bound is inclusive', () => {
    const dims = [{ dimension: '0..5' }]
    expect(validateArrayIndices([5], dims)).toBe(true)
  })

  it('rejects index below lower bound', () => {
    const dims = [{ dimension: '0..5' }]
    expect(validateArrayIndices([-1], dims)).toBe(false)
  })

  it('rejects index above upper bound', () => {
    const dims = [{ dimension: '0..5' }]
    expect(validateArrayIndices([6], dims)).toBe(false)
  })

  it('rejects when index count does not match dimension count', () => {
    const dims = [{ dimension: '0..5' }, { dimension: '0..3' }]
    expect(validateArrayIndices([1], dims)).toBe(false)
  })

  it('validates multi-dimensional indices', () => {
    const dims = [{ dimension: '0..2' }, { dimension: '0..3' }]
    expect(validateArrayIndices([1, 2], dims)).toBe(true)
  })

  it('rejects if any dimension has an invalid range format', () => {
    const dims = [{ dimension: 'bad' }]
    expect(validateArrayIndices([0], dims)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveArrayElement
// ---------------------------------------------------------------------------
describe('resolveArrayElement', () => {
  it('resolves a valid element', () => {
    const base = makeArrayVar('Sensor', 'base-type', 'INT', ['0..5'])
    const access = { baseName: 'Sensor', indices: [3] }
    const result = resolveArrayElement(base, access)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Sensor[3]')
    expect(result!.type.definition).toBe('base-type')
    expect(result!.type.value).toBe('INT')
  })

  it('resolves a multi-dimensional element', () => {
    const base = makeArrayVar('Matrix', 'base-type', 'REAL', ['0..2', '0..3'])
    const access = { baseName: 'Matrix', indices: [1, 2] }
    const result = resolveArrayElement(base, access)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Matrix[1,2]')
    expect(result!.type.value).toBe('REAL')
  })

  it('returns null for non-array variable', () => {
    const base = makeScalarVar('x')
    const access = { baseName: 'x', indices: [0] }
    expect(resolveArrayElement(base, access)).toBeNull()
  })

  it('returns null when data is missing', () => {
    const base: PLCVariable = {
      name: 'arr',
      class: 'local',
      type: { definition: 'array', value: 'ARRAY[0..5] OF INT' },
      location: '',
      documentation: '',
    }
    const access = { baseName: 'arr', indices: [0] }
    expect(resolveArrayElement(base, access)).toBeNull()
  })

  it('returns null when indices are out of range', () => {
    const base = makeArrayVar('Sensor', 'base-type', 'INT', ['0..5'])
    const access = { baseName: 'Sensor', indices: [10] }
    expect(resolveArrayElement(base, access)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveArrayVariableByName
// ---------------------------------------------------------------------------
describe('resolveArrayVariableByName', () => {
  it('resolves a valid array element reference', () => {
    const vars = [makeArrayVar('Sensor', 'base-type', 'INT', ['0..5'])]
    const result = resolveArrayVariableByName(vars, 'Sensor[3]')
    expect(result).toBeDefined()
    expect(result!.name).toBe('Sensor[3]')
    expect(result!.type.value).toBe('INT')
  })

  it('resolves case-insensitively', () => {
    const vars = [makeArrayVar('sensor', 'base-type', 'INT', ['0..5'])]
    const result = resolveArrayVariableByName(vars, 'Sensor[0]')
    expect(result).toBeDefined()
  })

  it('returns undefined for non-array access names', () => {
    const vars = [makeScalarVar('x')]
    expect(resolveArrayVariableByName(vars, 'x')).toBeUndefined()
  })

  it('returns undefined when base variable is not found', () => {
    const vars = [makeScalarVar('x')]
    expect(resolveArrayVariableByName(vars, 'arr[0]')).toBeUndefined()
  })

  it('returns undefined when base variable is not an array', () => {
    const vars = [makeScalarVar('arr')]
    expect(resolveArrayVariableByName(vars, 'arr[0]')).toBeUndefined()
  })

  it('returns undefined when indices are out of range', () => {
    const vars = [makeArrayVar('arr', 'base-type', 'INT', ['0..5'])]
    expect(resolveArrayVariableByName(vars, 'arr[10]')).toBeUndefined()
  })
})
