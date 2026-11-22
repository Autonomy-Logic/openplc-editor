import {
  blockInputVariables,
  blockOutputVariables,
  getArray,
  getBlockVariables,
  getBoolean,
  getNestedString,
  getNumber,
  getRecord,
  getString,
  inOutVariableNames,
  isRecord,
} from '../node-data'

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('returns false for null and primitives', () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord('str')).toBe(false)
    expect(isRecord(42)).toBe(false)
  })
})

describe('getRecord', () => {
  it('returns the nested object when present', () => {
    expect(getRecord({ variant: { name: 'TON' } }, 'variant')).toEqual({ name: 'TON' })
  })

  it('returns undefined when the key is absent, not an object, or data is undefined', () => {
    expect(getRecord({ variant: 'TON' }, 'variant')).toBeUndefined()
    expect(getRecord({}, 'variant')).toBeUndefined()
    expect(getRecord(undefined, 'variant')).toBeUndefined()
  })
})

describe('getString', () => {
  it('returns the string when present', () => {
    expect(getString({ variant: 'negated' }, 'variant')).toBe('negated')
  })

  it('returns undefined for wrong type, missing key, or undefined data', () => {
    expect(getString({ variant: 5 }, 'variant')).toBeUndefined()
    expect(getString({}, 'variant')).toBeUndefined()
    expect(getString(undefined, 'variant')).toBeUndefined()
  })
})

describe('getBoolean', () => {
  it('returns the boolean when present', () => {
    expect(getBoolean({ negated: true }, 'negated')).toBe(true)
    expect(getBoolean({ negated: false }, 'negated')).toBe(false)
  })

  it('returns undefined for wrong type, missing key, or undefined data', () => {
    expect(getBoolean({ negated: 'yes' }, 'negated')).toBeUndefined()
    expect(getBoolean({}, 'negated')).toBeUndefined()
    expect(getBoolean(undefined, 'negated')).toBeUndefined()
  })
})

describe('getArray', () => {
  it('returns the array when present', () => {
    expect(getArray({ variables: [1, 2] }, 'variables')).toEqual([1, 2])
  })

  it('returns undefined for wrong type, missing key, or undefined data', () => {
    expect(getArray({ variables: 'nope' }, 'variables')).toBeUndefined()
    expect(getArray({}, 'variables')).toBeUndefined()
    expect(getArray(undefined, 'variables')).toBeUndefined()
  })
})

describe('getNumber', () => {
  it('returns the number when present', () => {
    expect(getNumber({ count: 3 }, 'count')).toBe(3)
  })

  it('returns undefined for wrong type, missing key, or undefined data', () => {
    expect(getNumber({ count: '3' }, 'count')).toBeUndefined()
    expect(getNumber({}, 'count')).toBeUndefined()
    expect(getNumber(undefined, 'count')).toBeUndefined()
  })
})

describe('getNestedString', () => {
  it('reads a nested string field', () => {
    expect(getNestedString({ variable: { name: 'TON0' } }, 'variable', 'name')).toBe('TON0')
  })

  it('returns undefined when the nested object or field is missing', () => {
    expect(getNestedString({}, 'variable', 'name')).toBeUndefined()
    expect(getNestedString({ variable: {} }, 'variable', 'name')).toBeUndefined()
  })
})

describe('getBlockVariables', () => {
  it('filters variant.variables down to valid {name, class} entries', () => {
    const data = {
      variant: {
        variables: [
          { name: 'IN', class: 'input' },
          { name: 'OUT', class: 'output' },
          { notName: 'bad' },
          'not-an-object',
          42,
        ],
      },
    }
    expect(getBlockVariables(data)).toEqual([
      { name: 'IN', class: 'input' },
      { name: 'OUT', class: 'output' },
    ])
  })

  it('returns [] when variant or variables is absent', () => {
    expect(getBlockVariables({})).toEqual([])
    expect(getBlockVariables({ variant: {} })).toEqual([])
    expect(getBlockVariables(undefined)).toEqual([])
  })
})

describe('blockInputVariables / blockOutputVariables / inOutVariableNames', () => {
  const vars = [
    { name: 'IN1', class: 'input' },
    { name: 'IO1', class: 'inOut' },
    { name: 'OUT1', class: 'output' },
    { name: 'LOCAL1', class: 'local' },
    { name: 'NOCLASS' },
  ]

  it('blockInputVariables keeps input and inOut', () => {
    expect(blockInputVariables(vars)).toEqual([
      { name: 'IN1', class: 'input' },
      { name: 'IO1', class: 'inOut' },
    ])
  })

  it('blockOutputVariables keeps only output', () => {
    expect(blockOutputVariables(vars)).toEqual([{ name: 'OUT1', class: 'output' }])
  })

  it('inOutVariableNames returns a Set of inOut names', () => {
    expect(inOutVariableNames(vars)).toEqual(new Set(['IO1']))
  })
})
