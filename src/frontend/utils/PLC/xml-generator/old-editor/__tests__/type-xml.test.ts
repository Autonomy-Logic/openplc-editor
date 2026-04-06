import { convertTypeToXml } from '../type-xml'

describe('convertTypeToXml', () => {
  it('converts a base-type (uppercase)', () => {
    const result = convertTypeToXml({ definition: 'base-type', value: 'INT' })
    expect(result).toEqual({ INT: '' })
  })

  it('converts string base-type (kept lowercase)', () => {
    const result = convertTypeToXml({ definition: 'base-type', value: 'string' })
    expect(result).toEqual({ string: '' })
  })

  it('converts a derived type', () => {
    const result = convertTypeToXml({ definition: 'derived', value: 'MyType' })
    expect(result).toEqual({ derived: { '@name': 'MyType' } })
  })

  it('converts a user-data-type', () => {
    const result = convertTypeToXml({ definition: 'user-data-type', value: 'UDT1' })
    expect(result).toEqual({ derived: { '@name': 'UDT1' } })
  })

  it('converts an array type with base-type INT', () => {
    const result = convertTypeToXml({
      definition: 'array',
      value: '',
      data: {
        baseType: { definition: 'base-type', value: 'INT' },
        dimensions: [{ dimension: '0..9' }],
      },
    })
    expect(result).toEqual({
      array: {
        dimension: [{ '@lower': '0', '@upper': '9' }],
        baseType: { INT: '' },
      },
    })
  })

  it('converts an array type with string base', () => {
    const result = convertTypeToXml({
      definition: 'array',
      value: '',
      data: {
        baseType: { definition: 'base-type', value: 'string' },
        dimensions: [{ dimension: '1..5' }],
      },
    })
    expect(result).toEqual({
      array: {
        dimension: [{ '@lower': '1', '@upper': '5' }],
        baseType: { string: '' },
      },
    })
  })

  it('converts an array type with user-data-type base', () => {
    const result = convertTypeToXml({
      definition: 'array',
      value: '',
      data: {
        baseType: { definition: 'user-data-type', value: 'MyStruct' },
        dimensions: [{ dimension: '0..3' }],
      },
    })
    expect(result).toEqual({
      array: {
        dimension: [{ '@lower': '0', '@upper': '3' }],
        baseType: { derived: { '@name': 'MyStruct' } },
      },
    })
  })

  it('converts an array with multiple dimensions', () => {
    const result = convertTypeToXml({
      definition: 'array',
      value: '',
      data: {
        baseType: { definition: 'base-type', value: 'REAL' },
        dimensions: [{ dimension: '0..4' }, { dimension: '1..10' }],
      },
    })
    const dims = (result as any).array.dimension
    expect(dims).toEqual([
      { '@lower': '0', '@upper': '4' },
      { '@lower': '1', '@upper': '10' },
    ])
  })
})
