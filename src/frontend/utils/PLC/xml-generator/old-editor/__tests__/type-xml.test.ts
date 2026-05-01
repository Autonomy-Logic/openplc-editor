import { convertTypeToXml } from '../type-xml'

/** Recursive record type for deeply nested XML structures in test assertions. */
type XmlNode = Record<string, unknown>

describe('convertTypeToXml', () => {
  it('converts a base-type (uppercase)', () => {
    const result = convertTypeToXml({ definition: 'base-type', value: 'INT' })
    expect(result).toEqual({ INT: '' })
  })

  it('converts string base-type (kept lowercase)', () => {
    const result = convertTypeToXml({ definition: 'base-type', value: 'string' })
    expect(result).toEqual({ string: '' })
  })

  // Regression: project data canonicalizes base types to uppercase
  // (baseTypes constant emits 'STRING'). The xml emitter must still
  // produce <string> — xml2st rejects <STRING> outright.
  it('converts uppercase STRING base-type to lowercase tag', () => {
    const result = convertTypeToXml({ definition: 'base-type', value: 'STRING' })
    expect(result).toEqual({ string: '' })
  })

  it('converts WSTRING base-type to lowercase tag (any input casing)', () => {
    expect(convertTypeToXml({ definition: 'base-type', value: 'wstring' })).toEqual({ wstring: '' })
    expect(convertTypeToXml({ definition: 'base-type', value: 'WSTRING' })).toEqual({ wstring: '' })
  })

  it('keeps uppercase STRING in array baseType', () => {
    const result = convertTypeToXml({
      definition: 'array',
      value: '',
      data: {
        baseType: { definition: 'base-type', value: 'STRING' },
        dimensions: [{ dimension: '1..3' }],
      },
    })
    expect(result).toEqual({
      array: {
        dimension: [{ '@lower': '1', '@upper': '3' }],
        baseType: { string: '' },
      },
    })
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
    const dims = (result as XmlNode).array as XmlNode
    expect(dims.dimension).toEqual([
      { '@lower': '0', '@upper': '4' },
      { '@lower': '1', '@upper': '10' },
    ])
  })
})
