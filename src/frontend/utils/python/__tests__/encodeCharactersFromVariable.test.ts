import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { encodeCharactersFromVariable } from '../encodeCharactersFromVariable'

const makeScalarVar = (name: string, baseType: string): PLCVariable => ({
  name,
  class: 'input',
  type: { definition: 'base-type', value: baseType },
  location: '',
  documentation: '',
  debug: false,
})

const makeArrayVar = (name: string, baseType: string, dimension: string): PLCVariable => ({
  name,
  class: 'input',
  type: {
    definition: 'array',
    value: `ARRAY [${dimension}] OF ${baseType}`,
    data: {
      baseType: { definition: 'base-type', value: baseType },
      dimensions: [{ dimension }],
    },
  },
  location: '',
  documentation: '',
  debug: false,
})

describe('encodeCharactersFromVariable', () => {
  it('returns = for empty array', () => {
    expect(encodeCharactersFromVariable([])).toBe('=')
  })

  it('returns = for undefined input', () => {
    expect(encodeCharactersFromVariable(undefined as unknown as PLCVariable[])).toBe('=')
  })

  it('returns = for null input', () => {
    expect(encodeCharactersFromVariable(null as unknown as PLCVariable[])).toBe('=')
  })

  it('encodes BOOL as B', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'BOOL')])).toBe('=B')
  })

  it('encodes SINT as b', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'SINT')])).toBe('=b')
  })

  it('encodes INT as h', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'INT')])).toBe('=h')
  })

  it('encodes DINT as i', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'DINT')])).toBe('=i')
  })

  it('encodes LINT as q', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'LINT')])).toBe('=q')
  })

  it('encodes USINT as B', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'USINT')])).toBe('=B')
  })

  it('encodes UINT as H', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'UINT')])).toBe('=H')
  })

  it('encodes UDINT as I', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'UDINT')])).toBe('=I')
  })

  it('encodes ULINT as Q', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'ULINT')])).toBe('=Q')
  })

  it('encodes REAL as f', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'REAL')])).toBe('=f')
  })

  it('encodes LREAL as d', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'LREAL')])).toBe('=d')
  })

  it('encodes BYTE as B', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'BYTE')])).toBe('=B')
  })

  it('encodes WORD as H', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'WORD')])).toBe('=H')
  })

  it('encodes DWORD as I', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'DWORD')])).toBe('=I')
  })

  it('encodes LWORD as Q', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'LWORD')])).toBe('=Q')
  })

  it('encodes STRING as b126s', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'STRING')])).toBe('=b126s')
  })

  it('encodes multiple variables in order', () => {
    const vars = [makeScalarVar('a', 'INT'), makeScalarVar('b', 'REAL'), makeScalarVar('c', 'BOOL')]
    expect(encodeCharactersFromVariable(vars)).toBe('=hfB')
  })

  it('skips unknown scalar types and warns', () => {
    const vars = [makeScalarVar('x', 'UNKNOWN_TYPE'), makeScalarVar('y', 'INT')]
    const result = encodeCharactersFromVariable(vars)
    expect(result).toBe('=h')
  })

  it('encodes array variables with repeated format chars', () => {
    const vars = [makeArrayVar('arr', 'INT', '0..4')]
    expect(encodeCharactersFromVariable(vars)).toBe('=5h')
  })

  it('encodes array of strings by repeating the full encoding string', () => {
    const vars = [makeArrayVar('arr', 'STRING', '0..2')]
    expect(encodeCharactersFromVariable(vars)).toBe('=b126sb126sb126s')
  })

  it('skips array with unknown base type and warns', () => {
    const vars = [makeArrayVar('arr', 'UNKNOWN', '0..2')]
    const result = encodeCharactersFromVariable(vars)
    expect(result).toBe('=')
  })

  it('encodes mixed scalar and array variables', () => {
    const vars = [makeScalarVar('a', 'INT'), makeArrayVar('b', 'REAL', '0..2'), makeScalarVar('c', 'BOOL')]
    expect(encodeCharactersFromVariable(vars)).toBe('=h3fB')
  })
})
