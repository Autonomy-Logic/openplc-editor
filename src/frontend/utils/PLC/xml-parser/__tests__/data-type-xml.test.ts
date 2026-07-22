import { parseDataTypesXml } from '../data-type-xml'

describe('parseDataTypesXml', () => {
  it('parses a structure derivation', () => {
    const result = parseDataTypesXml([
      {
        '@name': 'MyStruct',
        baseType: {
          struct: {
            variable: [
              { '@name': 'a', type: { BOOL: '' } },
              { '@name': 'b', type: { INT: '' }, initialValue: { simpleValue: { '@value': '5' } } },
            ],
          },
        },
      },
    ])
    expect(result).toEqual([
      {
        name: 'MyStruct',
        derivation: 'structure',
        variable: [
          { name: 'a', type: { definition: 'base-type', value: 'BOOL' }, initialValue: undefined },
          { name: 'b', type: { definition: 'base-type', value: 'INT' }, initialValue: { simpleValue: { value: '5' } } },
        ],
      },
    ])
  })

  it('parses an enumerated derivation with an initial value', () => {
    const result = parseDataTypesXml({
      '@name': 'MyEnum',
      baseType: { enum: { values: { value: [{ '@name': 'RED' }, { '@name': 'GREEN' }] } } },
      initialValue: { simpleValue: { '@value': 'RED' } },
    })
    expect(result).toEqual([
      {
        name: 'MyEnum',
        derivation: 'enumerated',
        initialValue: 'RED',
        values: [{ description: 'RED' }, { description: 'GREEN' }],
      },
    ])
  })

  it('parses an enumerated derivation without an initial value', () => {
    const result = parseDataTypesXml({
      '@name': 'MyEnum2',
      baseType: { enum: { values: { value: [{ '@name': 'A' }] } } },
    })
    expect(result[0].derivation).toBe('enumerated')
    expect((result[0] as { initialValue?: string }).initialValue).toBeUndefined()
  })

  it('parses an array derivation', () => {
    const result = parseDataTypesXml({
      '@name': 'MyArray',
      baseType: {
        array: {
          dimension: [{ '@lower': '0', '@upper': '9' }],
          baseType: { INT: '' },
        },
      },
      initialValue: { simpleValue: { '@value': '0' } },
    })
    expect(result).toEqual([
      {
        name: 'MyArray',
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'INT' },
        initialValue: '0',
        dimensions: [{ dimension: '0..9' }],
      },
    ])
  })

  it('throws for an unrecognized derivation', () => {
    expect(() => parseDataTypesXml({ '@name': 'Bad', baseType: {} })).toThrow(
      'Unrecognized dataType derivation for "Bad"',
    )
  })
})
