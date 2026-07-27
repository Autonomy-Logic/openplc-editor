import { parseBaseTypeLeaf, parseDimensionsXml, parseTypeXml } from '../type-xml'

describe('parseTypeXml', () => {
  it('parses a base-type element (uppercase tag)', () => {
    expect(parseTypeXml({ INT: '' })).toEqual({ definition: 'base-type', value: 'INT' })
  })

  it('parses a base-type element (lowercase string/wstring tag)', () => {
    expect(parseTypeXml({ string: '' })).toEqual({ definition: 'base-type', value: 'STRING' })
  })

  it('falls back to the raw tag when it is not a recognized IEC element', () => {
    expect(parseTypeXml({ CustomTag: '' })).toEqual({ definition: 'base-type', value: 'CustomTag' })
  })

  it('parses a derived element', () => {
    expect(parseTypeXml({ derived: { '@name': 'MyType' } })).toEqual({ definition: 'derived', value: 'MyType' })
  })

  it('parses an array element with a base-type element type', () => {
    const result = parseTypeXml({
      array: {
        dimension: [{ '@lower': '0', '@upper': '9' }],
        baseType: { INT: '' },
      },
    })
    expect(result).toEqual({
      definition: 'array',
      value: 'ARRAY[0..9] OF INT',
      data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..9' }] },
    })
  })

  it('parses an array element with a derived element type', () => {
    const result = parseTypeXml({
      array: {
        dimension: [{ '@lower': '0', '@upper': '3' }],
        baseType: { derived: { '@name': 'MyStruct' } },
      },
    })
    expect(result.data?.baseType).toEqual({ definition: 'user-data-type', value: 'MyStruct' })
  })

  it('throws when the type element is empty', () => {
    expect(() => parseTypeXml({})).toThrow('Variable type element is empty')
  })
})

describe('parseBaseTypeLeaf', () => {
  it('parses a derived leaf', () => {
    expect(parseBaseTypeLeaf({ derived: { '@name': 'Foo' } })).toEqual({ definition: 'user-data-type', value: 'Foo' })
  })

  it('parses a base-type leaf', () => {
    expect(parseBaseTypeLeaf({ BOOL: '' })).toEqual({ definition: 'base-type', value: 'BOOL' })
  })

  it('throws when the leaf has no recognizable base type', () => {
    expect(() => parseBaseTypeLeaf({})).toThrow('Type element has no recognizable base type')
  })
})

describe('parseDimensionsXml', () => {
  it('parses a single dimension object (not yet an array)', () => {
    expect(parseDimensionsXml({ '@lower': '1', '@upper': '5' })).toEqual([{ dimension: '1..5' }])
  })

  it('parses multiple dimensions', () => {
    expect(
      parseDimensionsXml([
        { '@lower': '0', '@upper': '1' },
        { '@lower': '2', '@upper': '3' },
      ]),
    ).toEqual([{ dimension: '0..1' }, { dimension: '2..3' }])
  })
})
