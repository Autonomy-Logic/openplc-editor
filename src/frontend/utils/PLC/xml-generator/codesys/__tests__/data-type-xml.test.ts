import type { PLCDataType } from '@root/middleware/shared/ports/open-plc-types'

import { getBaseCodeSysXmlStructure } from '../base-xml'
import { codeSysParseDataTypesToXML } from '../data-type-xml'

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
      const dt = result.project.types.dataTypes.dataType[0] as Record<string, unknown>
      expect(dt['@name']).toBe('MyArr')
      const baseType = (dt as any).baseType.array.baseType
      expect(baseType).toHaveProperty('INT', '')
      expect((dt as any).initialValue.simpleValue['@value']).toBe('0')
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
      const dt = result.project.types.dataTypes.dataType[0] as any
      expect(dt.baseType.array.baseType).toHaveProperty('string', '')
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
      const dt = result.project.types.dataTypes.dataType[0] as any
      expect(dt.baseType.array.baseType).toEqual({ derived: { '@name': 'MyStruct' } })
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
      const dims = (result.project.types.dataTypes.dataType[0] as any).baseType.array.dimension
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
      const dt = result.project.types.dataTypes.dataType[0] as any
      expect(dt['@name']).toBe('Color')
      expect(dt.baseType.enum.values.value).toEqual([
        { '@name': 'Red' },
        { '@name': 'Green' },
        { '@name': 'Blue' },
      ])
      expect(dt.initialValue.simpleValue['@value']).toBe('Red')
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
      const dt = result.project.types.dataTypes.dataType[0] as any
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
      const dt = result.project.types.dataTypes.dataType[0] as any
      expect(dt['@name']).toBe('Point')
      const vars = dt.baseType.struct.variable
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
      expect(vars[0].type).toEqual({ derived: { '@name': 'InnerStruct' } })
      expect(vars[0].initialValue.simpleValue['@value']).toBe('test')
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
      expect(vars[0].type.array.baseType).toEqual({ DINT: '' })
      expect(vars[0].type.array.dimension).toEqual([{ '@lower': '0', '@upper': '7' }])
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
      expect(vars[0].type.array.baseType).toEqual({ derived: { '@name': 'Item' } })
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
      expect(vars[0].type.array.baseType).toEqual({ string: '' })
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
      expect(vars[0].type).toEqual({ derived: { '@name': 'OtherType' } })
      expect(vars[0].initialValue.simpleValue['@value']).toBe('init')
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
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
      expect(vars[0].initialValue).toBeUndefined()
    })
  })

  it('returns the xml object', () => {
    const xml = makeBaseXml()
    const result = codeSysParseDataTypesToXML(xml, [])
    expect(result).toBe(xml)
  })
})
