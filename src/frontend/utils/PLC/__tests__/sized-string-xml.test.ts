import { parseTypeXml } from '../xml-parser/type-xml'
import { convertTypeToXml } from '../xml-generator/old-editor/type-xml'

/**
 * A declared string length across the PLCopen XML boundary.
 *
 * TC6 carries the length on the element as an attribute —
 * `<string length="23"/>`.
 *
 * The round trip is what these tests are for: a dropped length goes unnoticed,
 * since the project still opens and still compiles as the 254-character
 * default, at 518 bytes per variable instead of 54.
 */
describe('a declared string length over PLCopen XML', () => {
  it('writes the length as a TC6 attribute', () => {
    expect(convertTypeToXml({ definition: 'base-type', value: 'STRING(23)' })).toEqual({
      string: { '@length': '23' },
    })
  })

  it('writes WSTRING the same way', () => {
    expect(convertTypeToXml({ definition: 'base-type', value: 'WSTRING(8)' })).toEqual({
      wstring: { '@length': '8' },
    })
  })

  it('leaves an unqualified string as a bare element', () => {
    expect(convertTypeToXml({ definition: 'base-type', value: 'STRING' })).toEqual({ string: '' })
  })

  it('reads the attribute back into the declaration', () => {
    expect(parseTypeXml({ string: { '@length': '23' } })).toEqual({
      definition: 'base-type',
      value: 'STRING(23)',
    })
  })

  it.each([
    ['STRING(1)'],
    ['STRING(23)'],
    ['STRING(254)'],
    ['WSTRING(8)'],
    ['STRING'],
    ['INT'],
  ])('round-trips %s unchanged', (declared) => {
    const xml = convertTypeToXml({ definition: 'base-type', value: declared })
    expect(parseTypeXml(xml)).toEqual({ definition: 'base-type', value: declared })
  })

  it('round-trips an ARRAY of sized strings, element length included', () => {
    const type = {
      definition: 'array' as const,
      value: 'ARRAY[0..3] OF STRING(23)',
      data: {
        baseType: { definition: 'base-type' as const, value: 'STRING(23)' },
        dimensions: [{ dimension: '0..3' }],
      },
    }
    const xml = convertTypeToXml(type)
    expect(parseTypeXml(xml).data?.baseType).toEqual({ definition: 'base-type', value: 'STRING(23)' })
  })

  // An importer meeting a foreign file must not turn it into a type nothing
  // downstream recognises, so an unusable attribute degrades to the plain type
  // rather than failing the load.
  it.each([
    ['zero', '0'],
    ['past the implementation maximum', '999'],
    ['not a number', 'lots'],
  ])('ignores a length that is %s', (_label, raw) => {
    expect(parseTypeXml({ string: { '@length': raw } })).toEqual({
      definition: 'base-type',
      value: 'STRING',
    })
  })

  it('ignores a length on an element that cannot carry one', () => {
    expect(parseTypeXml({ INT: { '@length': '4' } })).toEqual({
      definition: 'base-type',
      value: 'INT',
    })
  })
})
