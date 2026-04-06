import type { PLCDataType } from '@root/middleware/shared/ports/open-plc-types'

import { getBaseOldEditorXmlStructure } from '../base-xml'
import { oldEditorParseDataTypesToXML } from '../data-type-xml'

const makeBaseXml = () => getBaseOldEditorXmlStructure()

describe('oldEditorParseDataTypesToXML', () => {
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
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const dt = result.project.types.dataTypes.dataType[0] as any
      expect(dt['@name']).toBe('MyArr')
      expect(dt.baseType.array.baseType).toEqual({ INT: '' })
      expect(dt.initialValue.simpleValue['@value']).toBe('0')
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
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const dt = result.project.types.dataTypes.dataType[0] as any
      expect(dt.baseType.array.baseType).toEqual({ string: '' })
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
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
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
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const dims = (result.project.types.dataTypes.dataType[0] as any).baseType.array.dimension
      expect(dims).toEqual([
        { '@lower': '0', '@upper': '4' },
        { '@lower': '1', '@upper': '10' },
      ])
    })

    it('throws on invalid dimension format', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Bad',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: undefined as unknown as string }],
        },
      ]
      expect(() => oldEditorParseDataTypesToXML(xml, dataTypes)).toThrow('Invalid dimension format')
    })

    it('throws on invalid dimension range', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Bad',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: '5' }],
        },
      ]
      expect(() => oldEditorParseDataTypesToXML(xml, dataTypes)).toThrow('Invalid dimension range')
    })
  })

  describe('enumerated derivation', () => {
    it('adds an enum data type with initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Color',
          derivation: 'enumerated',
          values: [{ description: 'Red' }, { description: 'Green' }],
          initialValue: 'Red',
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const dt = result.project.types.dataTypes.dataType[0] as any
      expect(dt.baseType.enum.values.value).toEqual([{ '@name': 'Red' }, { '@name': 'Green' }])
      expect(dt.initialValue.simpleValue['@value']).toBe('Red')
    })

    it('adds an enum without initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'State',
          derivation: 'enumerated',
          values: [{ description: 'On' }],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
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
            { name: 'x', type: { definition: 'base-type', value: 'REAL' }, initialValue: { simpleValue: { value: '0.0' } } },
            { name: 'y', type: { definition: 'base-type', value: 'INT' } },
          ],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const vars = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable
      expect(vars[0]).toEqual({ '@name': 'x', type: { REAL: '' }, initialValue: { simpleValue: { '@value': '0.0' } } })
      expect(vars[1]).toEqual({ '@name': 'y', type: { INT: '' }, initialValue: undefined })
    })

    it('handles string base-type (lowercase key)', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'Msg',
          derivation: 'structure',
          variable: [{ name: 'text', type: { definition: 'base-type', value: 'string' } }],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
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
            { name: 'inner', type: { definition: 'user-data-type', value: 'Inner' }, initialValue: { simpleValue: { value: 'val' } } },
          ],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const v = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable[0]
      expect(v.type).toEqual({ derived: { '@name': 'Inner' } })
      expect(v.initialValue.simpleValue['@value']).toBe('val')
    })

    it('handles user-data-type variables without initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'C',
          derivation: 'structure',
          variable: [{ name: 'x', type: { definition: 'user-data-type', value: 'T' } }],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      expect((result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable[0].initialValue).toBeUndefined()
    })

    it('handles array variables inside a struct', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'ArrStruct',
          derivation: 'structure',
          variable: [
            {
              name: 'data',
              type: {
                definition: 'array',
                value: '',
                data: { baseType: { definition: 'base-type', value: 'DINT' }, dimensions: [{ dimension: '0..7' }] },
              },
              initialValue: { simpleValue: { value: '{0}' } },
            },
          ],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const v = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable[0]
      expect(v.type.array.baseType).toEqual({ DINT: '' })
      expect(v.initialValue.simpleValue['@value']).toBe('{0}')
    })

    it('handles array with user-data-type base inside a struct', () => {
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
                data: { baseType: { definition: 'user-data-type', value: 'Item' }, dimensions: [{ dimension: '0..2' }] },
              },
            },
          ],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const v = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable[0]
      expect(v.type.array.baseType).toEqual({ derived: { '@name': 'Item' } })
      expect(v.initialValue).toBeUndefined()
    })

    it('handles array with string base inside a struct', () => {
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
                data: { baseType: { definition: 'base-type', value: 'string' }, dimensions: [{ dimension: '0..2' }] },
              },
            },
          ],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const v = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable[0]
      expect(v.type.array.baseType).toEqual({ string: '' })
    })

    it('handles derived variables', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'WithDerived',
          derivation: 'structure',
          variable: [
            { name: 'ref', type: { definition: 'derived', value: 'Other' }, initialValue: { simpleValue: { value: 'init' } } },
          ],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      const v = (result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable[0]
      expect(v.type).toEqual({ derived: { '@name': 'Other' } })
      expect(v.initialValue.simpleValue['@value']).toBe('init')
    })

    it('handles derived variables without initial value', () => {
      const xml = makeBaseXml()
      const dataTypes: PLCDataType[] = [
        {
          name: 'D',
          derivation: 'structure',
          variable: [{ name: 'r', type: { definition: 'derived', value: 'X' } }],
        },
      ]
      const result = oldEditorParseDataTypesToXML(xml, dataTypes)
      expect((result.project.types.dataTypes.dataType[0] as any).baseType.struct.variable[0].initialValue).toBeUndefined()
    })
  })

  it('returns the xml object', () => {
    const xml = makeBaseXml()
    const result = oldEditorParseDataTypesToXML(xml, [])
    expect(result).toBe(xml)
  })
})
