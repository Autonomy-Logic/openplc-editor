import type { PLCDataType } from '@root/middleware/shared/ports/open-plc-types'

import { getBaseCodeSysXmlStructure } from '../base-xml'
import { codeSysParseDataTypesToXML } from '../data-type-xml'

/** Recursive record type for deeply nested XML structures in test assertions. */
type XmlNode = Record<string, unknown>

/** Helper to extract the first dataType entry as an XmlNode for assertions. */
function firstDataType(result: ReturnType<typeof codeSysParseDataTypesToXML>): XmlNode {
  return result.project.types.dataTypes.dataType[0] as XmlNode
}

/** Helper to navigate to baseType.struct.variable on the first data type. */
function structVars(result: ReturnType<typeof codeSysParseDataTypesToXML>): XmlNode[] {
  const dt = firstDataType(result)
  return ((dt.baseType as XmlNode).struct as XmlNode).variable as XmlNode[]
}

const makeBaseXml = () => getBaseCodeSysXmlStructure()

describe('codeSysParseDataTypesToXML', () => {
  describe('array derivation', () => {
    it('adds an array data type with base-type INT', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'MyArr',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: '0..9' }],
          initialValue: '0',
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const dt = firstDataType(result)
      expect(dt['@name']).toBe('MyArr')
      const arrayNode = (dt.baseType as XmlNode).array as XmlNode
      expect(arrayNode.baseType).toHaveProperty('INT', '')
      expect(((dt.initialValue as XmlNode).simpleValue as XmlNode)['@value']).toBe('0')
    })

    it('adds an array data type with string base type (lowercase key)', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'StrArr',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'string' },
          dimensions: [{ dimension: '1..5' }],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const dt = firstDataType(result)
      const arrayNode = (dt.baseType as XmlNode).array as XmlNode
      expect(arrayNode.baseType).toHaveProperty('string', '')
      expect(dt.initialValue).toBeUndefined()
    })

    it('adds an array data type with user-data-type base', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'UdtArr',
          derivation: 'array',
          baseType: { definition: 'user-data-type', value: 'MyStruct' },
          dimensions: [{ dimension: '0..3' }],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const dt = firstDataType(result)
      const arrayNode = (dt.baseType as XmlNode).array as XmlNode
      expect(arrayNode.baseType).toEqual({ derived: { '@name': 'MyStruct' } })
    })

    it('parses multiple dimensions', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'MultiDim',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'REAL' },
          dimensions: [{ dimension: '0..4' }, { dimension: '1..10' }],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const dt = firstDataType(result)
      const dims = ((dt.baseType as XmlNode).array as XmlNode).dimension
      expect(dims).toEqual([
        { '@lower': '0', '@upper': '4' },
        { '@lower': '1', '@upper': '10' },
      ])
    })

    it('throws on invalid dimension format (non-string)', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Bad',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: undefined as unknown as string }],
        },
      ]
      expect(() => codeSysParseDataTypesToXML(xml, dataTypes)).toThrow('Invalid dimension format')
    })

    it('throws on invalid dimension range (no ..)', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Bad',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: '5' }],
        },
      ]
      expect(() => codeSysParseDataTypesToXML(xml, dataTypes)).toThrow('Invalid dimension range')
    })
  })

  describe('enumerated derivation', () => {
    it('adds an enum data type with initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Color',
          derivation: 'enumerated',
          values: [{ description: 'Red' }, { description: 'Green' }, { description: 'Blue' }],
          initialValue: 'Red',
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const dt = firstDataType(result)
      expect(dt['@name']).toBe('Color')
      expect(((dt.baseType as XmlNode).enum as XmlNode).values).toEqual({
        value: [{ '@name': 'Red' }, { '@name': 'Green' }, { '@name': 'Blue' }],
      })
      expect(((dt.initialValue as XmlNode).simpleValue as XmlNode)['@value']).toBe('Red')
    })

    it('adds an enum data type without initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'State',
          derivation: 'enumerated',
          values: [{ description: 'On' }, { description: 'Off' }],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const dt = firstDataType(result)
      expect(dt.initialValue).toBeUndefined()
    })
  })

  describe('structure derivation', () => {
    it('adds a struct with base-type variables', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Point',
          derivation: 'structure',
          variable: [
            {
              name: 'x',
              type: { definition: 'base-type', value: 'REAL' },
              initialValue: { simpleValue: { value: '0.0' } },
            },
            {
              name: 'y',
              type: { definition: 'base-type', value: 'INT' },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const dt = firstDataType(result)
      expect(dt['@name']).toBe('Point')
      const vars = structVars(result)
      expect(vars[0]).toEqual({
        '@name': 'x',
        type: { REAL: '' },
        initialValue: { simpleValue: { '@value': '0.0' } },
      })
      expect(vars[1]).toEqual({
        '@name': 'y',
        type: { INT: '' },
        initialValue: undefined,
      })
    })

    it('handles string base-type (lowercase key)', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Msg',
          derivation: 'structure',
          variable: [
            {
              name: 'text',
              type: { definition: 'base-type', value: 'string' },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      expect(vars[0].type).toEqual({ string: '' })
    })

    it('handles user-data-type variables', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Container',
          derivation: 'structure',
          variable: [
            {
              name: 'inner',
              type: { definition: 'user-data-type', value: 'InnerStruct' },
              initialValue: { simpleValue: { value: 'test' } },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      expect(vars[0].type).toEqual({ derived: { '@name': 'InnerStruct' } })
      expect(((vars[0].initialValue as XmlNode).simpleValue as XmlNode)['@value']).toBe('test')
    })

    it('handles user-data-type variables without initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Container',
          derivation: 'structure',
          variable: [
            {
              name: 'inner',
              type: { definition: 'user-data-type', value: 'InnerStruct' },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      expect(vars[0].initialValue).toBeUndefined()
    })

    it('handles array variables inside a struct', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'WithArr',
          derivation: 'structure',
          variable: [
            {
              name: 'data',
              type: {
                definition: 'array',
                value: '',
                data: {
                  baseType: { definition: 'base-type', value: 'DINT' },
                  dimensions: [{ dimension: '0..7' }],
                },
              },
              initialValue: { simpleValue: { value: '{0,0,0,0,0,0,0,0}' } },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      const arrType = (vars[0].type as XmlNode).array as XmlNode
      expect(arrType.baseType).toEqual({ DINT: '' })
      expect(arrType.dimension).toEqual([{ '@lower': '0', '@upper': '7' }])
    })

    it('handles array variables with user-data-type base inside a struct', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'ArrUdt',
          derivation: 'structure',
          variable: [
            {
              name: 'items',
              type: {
                definition: 'array',
                value: '',
                data: {
                  baseType: { definition: 'user-data-type', value: 'Item' },
                  dimensions: [{ dimension: '0..2' }],
                },
              },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      const arrType = (vars[0].type as XmlNode).array as XmlNode
      expect(arrType.baseType).toEqual({ derived: { '@name': 'Item' } })
      expect(vars[0].initialValue).toBeUndefined()
    })

    it('handles array variables with string base inside a struct', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'StrArrStruct',
          derivation: 'structure',
          variable: [
            {
              name: 'names',
              type: {
                definition: 'array',
                value: '',
                data: {
                  baseType: { definition: 'base-type', value: 'string' },
                  dimensions: [{ dimension: '0..2' }],
                },
              },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      const arrType = (vars[0].type as XmlNode).array as XmlNode
      expect(arrType.baseType).toEqual({ string: '' })
    })

    it('handles derived variables inside a struct', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'WithDerived',
          derivation: 'structure',
          variable: [
            {
              name: 'ref',
              type: { definition: 'derived', value: 'OtherType' },
              initialValue: { simpleValue: { value: 'init' } },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      expect(vars[0].type).toEqual({ derived: { '@name': 'OtherType' } })
      expect(((vars[0].initialValue as XmlNode).simpleValue as XmlNode)['@value']).toBe('init')
    })

    it('handles derived variables without initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'WithDerived2',
          derivation: 'structure',
          variable: [
            {
              name: 'ref',
              type: { definition: 'derived', value: 'Other' },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      expect(vars[0].initialValue).toBeUndefined()
    })

    // Regression: struct creation seeds new variables with an
    // `initialValue: { simpleValue: { value: '' } }` wrapper instead
    // of `undefined`.  The XML emitter must treat the empty inner
    // value the same as absence — otherwise it emits
    // `<simpleValue value=""/>` which xml2st turns into a stray `:= `
    // in the ST output, breaking compilation.
    it('omits initialValue for an array struct variable whose inner value is empty', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'StructWithEmptyArrInit',
          derivation: 'structure',
          variable: [
            {
              name: 'data',
              type: {
                definition: 'array',
                value: '',
                data: {
                  baseType: { definition: 'base-type', value: 'REAL' },
                  dimensions: [{ dimension: '0..7' }],
                },
              },
              initialValue: { simpleValue: { value: '' } },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      expect(vars[0].initialValue).toBeUndefined()
    })

    it('omits initialValue for a derived struct variable whose inner value is empty', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'StructWithEmptyDerivedInit',
          derivation: 'structure',
          variable: [
            {
              name: 'ref',
              type: { definition: 'derived', value: 'Other' },
              initialValue: { simpleValue: { value: '' } },
            },
          ],
        },
      ]
      const result = codeSysParseDataTypesToXML(xml, dataTypes)
      const vars = structVars(result)
      expect(vars[0].initialValue).toBeUndefined()
    })
  })

  it('returns the xml object', () => {
    const xml = makeBaseXml()
    const result = codeSysParseDataTypesToXML(xml, [])
    expect(result).toBe(xml)
  })
})
