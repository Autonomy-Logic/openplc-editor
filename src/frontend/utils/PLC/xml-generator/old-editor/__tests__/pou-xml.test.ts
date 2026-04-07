import type { PLCPou, PLCVariable } from '@root/middleware/shared/ports/open-plc-types'

import { getBaseOldEditorXmlStructure } from '../base-xml'
import { oldEditorParseInterface, oldEditorParsePousToXML } from '../pou-xml'

/** Recursive record type for deeply nested XML structures in test assertions. */
type XmlNode = Record<string, unknown>

const makeBaseXml = () => getBaseOldEditorXmlStructure()

const makeStPou = (overrides: Record<string, unknown> = {}): PLCPou =>
  ({
    type: 'program',
    data: {
      name: 'main',
      language: 'st',
      variables: [],
      body: { language: 'st', value: '' },
      documentation: '',
    },
    ...overrides,
  }) as PLCPou

describe('oldEditorParseInterface', () => {
  it('returns empty interface for POU with no variables', () => {
    const pou = makeStPou()
    const result = oldEditorParseInterface(pou)
    expect(result).toEqual({})
  })

  it('categorizes variables by class', () => {
    const pou = makeStPou({
      data: {
        name: 'test',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
        variables: [
          {
            name: 'a',
            class: 'input',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
          {
            name: 'b',
            class: 'output',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
          },
          {
            name: 'c',
            class: 'inOut',
            type: { definition: 'base-type', value: 'REAL' },
            location: '',
            documentation: '',
          },
          {
            name: 'd',
            class: 'external',
            type: { definition: 'base-type', value: 'DINT' },
            location: '',
            documentation: '',
          },
          {
            name: 'e',
            class: 'local',
            type: { definition: 'base-type', value: 'LINT' },
            location: '',
            documentation: '',
          },
          {
            name: 'f',
            class: 'temp',
            type: { definition: 'base-type', value: 'BYTE' },
            location: '',
            documentation: '',
          },
        ],
      },
    })
    const result = oldEditorParseInterface(pou)
    expect(result.inputVars!.variable).toHaveLength(1)
    expect(result.outputVars!.variable).toHaveLength(1)
    expect(result.inOutVars!.variable).toHaveLength(1)
    expect(result.externalVars!.variable).toHaveLength(1)
    expect(result.localVars!.variable).toHaveLength(1)
    expect(result.tempVars!.variable).toHaveLength(1)
  })

  it('handles unknown variable class via default case', () => {
    const pou = makeStPou({
      data: {
        name: 'test',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
        variables: [
          {
            name: 'x',
            class: 'unknown' as unknown as PLCVariable['class'],
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
        ],
      },
    })
    const result = oldEditorParseInterface(pou)
    expect(result.inputVars).toBeUndefined()
  })

  it('sets address when variable has location', () => {
    const pou = makeStPou({
      data: {
        name: 'test',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
        variables: [
          {
            name: 'x',
            class: 'local',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '%IX0.0',
            documentation: '',
          },
        ],
      },
    })
    const result = oldEditorParseInterface(pou)
    expect(result.localVars!.variable![0]['@address']).toBe('%IX0.0')
  })

  it('sets initialValue when present', () => {
    const pou = makeStPou({
      data: {
        name: 'test',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
        variables: [
          {
            name: 'x',
            class: 'local',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            initialValue: '10',
            documentation: '',
          },
        ],
      },
    })
    const result = oldEditorParseInterface(pou)
    expect(result.localVars!.variable![0].initialValue).toEqual({ simpleValue: { '@value': '10' } })
  })

  it('sets documentation when present', () => {
    const pou = makeStPou({
      data: {
        name: 'test',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
        variables: [
          {
            name: 'x',
            class: 'local',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: 'A var',
          },
        ],
      },
    })
    const result = oldEditorParseInterface(pou)
    expect(result.localVars!.variable![0].documentation).toEqual({ 'xhtml:p': { $: 'A var' } })
  })

  it('sets documentation $ to space when empty string', () => {
    const pou = makeStPou({
      data: {
        name: 'test',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
        variables: [
          {
            name: 'x',
            class: 'local',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
          },
        ],
      },
    })
    const result = oldEditorParseInterface(pou)
    // Empty string is falsy so documentation should not be set
    expect(result.localVars!.variable![0].documentation).toBeUndefined()
  })

  describe('returnType for functions', () => {
    it('sets base return type (uppercase)', () => {
      const pou: PLCPou = {
        type: 'function',
        data: {
          name: 'myFunc',
          language: 'st',
          returnType: 'INT',
          variables: [
            {
              name: 'x',
              class: 'input',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      }
      const result = oldEditorParseInterface(pou)
      expect(result.returnType).toEqual({ INT: '' })
    })

    it('sets STRING return type (lowercase)', () => {
      const pou: PLCPou = {
        type: 'function',
        data: {
          name: 'myFunc',
          language: 'st',
          returnType: 'STRING',
          variables: [
            {
              name: 'x',
              class: 'input',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      }
      const result = oldEditorParseInterface(pou)
      expect(result.returnType).toEqual({ string: '' })
    })

    it('sets derived return type for non-base types', () => {
      const pou: PLCPou = {
        type: 'function',
        data: {
          name: 'myFunc',
          language: 'st',
          returnType: 'CustomType',
          variables: [
            {
              name: 'x',
              class: 'input',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      }
      const result = oldEditorParseInterface(pou)
      expect(result.returnType).toEqual({ derived: { '@name': 'CustomType' } })
    })

    it('does not set returnType for programs', () => {
      const pou = makeStPou({
        data: {
          name: 'main',
          language: 'st',
          variables: [
            {
              name: 'x',
              class: 'local',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      })
      const result = oldEditorParseInterface(pou)
      expect(result.returnType).toBeUndefined()
    })
  })

  it('uses convertTypeToXml for variable types', () => {
    const pou = makeStPou({
      data: {
        name: 'test',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
        variables: [
          {
            name: 'arr',
            class: 'local',
            type: {
              definition: 'array',
              value: '',
              data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..9' }] },
            },
            location: '',
            documentation: '',
          },
          {
            name: 'der',
            class: 'local',
            type: { definition: 'derived', value: 'MyType' },
            location: '',
            documentation: '',
          },
        ],
      },
    })
    const result = oldEditorParseInterface(pou)
    expect((result.localVars!.variable![0].type as XmlNode).array).toBeDefined()
    expect(result.localVars!.variable![1].type).toEqual({ derived: { '@name': 'MyType' } })
  })
})

describe('oldEditorParsePousToXML', () => {
  it('adds an ST POU with documentation', () => {
    const xml = makeBaseXml()
    const pou = makeStPou({
      data: {
        name: 'main',
        language: 'st',
        variables: [],
        body: { language: 'st', value: 'x := 1;' },
        documentation: 'My doc',
      },
    })
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou).toHaveLength(1)
    expect(result.project.types.pous.pou[0]['@name']).toBe('main')
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('program')
    expect(result.project.types.pous.pou[0].body).toHaveProperty('ST')
    expect(((result.project.types.pous.pou[0] as XmlNode).documentation as XmlNode)['xhtml:p']).toEqual({ $: 'My doc' })
  })

  it('documentation uses space when empty string', () => {
    const xml = makeBaseXml()
    const pou = makeStPou()
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(((result.project.types.pous.pou[0] as XmlNode).documentation as XmlNode)['xhtml:p']).toEqual({ $: ' ' })
  })

  it('adds an IL POU', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'program',
      data: {
        name: 'ilProg',
        language: 'il',
        variables: [],
        body: { language: 'il', value: 'LD 1' },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0].body).toHaveProperty('IL')
  })

  it('adds an LD POU', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'program',
      data: {
        name: 'ldProg',
        language: 'ld',
        variables: [],
        body: { language: 'ld', value: { name: 'ldProg', rungs: [] } },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0].body).toHaveProperty('LD')
  })

  it('adds an FBD POU', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'program',
      data: {
        name: 'fbdProg',
        language: 'fbd',
        variables: [],
        body: {
          language: 'fbd',
          value: { name: 'fbdProg', rung: { comment: '', selectedNodes: [], nodes: [], edges: [] } },
        },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0].body).toHaveProperty('FBD')
  })

  it('adds a Python POU (uses ST body)', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function-block',
      data: {
        name: 'pyFb',
        language: 'python',
        variables: [],
        body: { language: 'python', value: 'print("hi")' },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0].body).toHaveProperty('ST')
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('functionBlock')
  })

  it('adds a C++ POU (uses ST body)', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function-block',
      data: {
        name: 'cppFb',
        language: 'cpp',
        variables: [],
        body: { language: 'cpp', value: 'int x = 0;' },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0].body).toHaveProperty('ST')
  })

  it('maps function-block to functionBlock', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function-block',
      data: { name: 'fb', language: 'st', variables: [], body: { language: 'st', value: '' }, documentation: '' },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('functionBlock')
  })

  it('keeps function as function', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function',
      data: {
        name: 'f',
        language: 'st',
        returnType: 'INT',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('function')
  })

  it('skips unknown languages', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'program',
      data: {
        name: 'unknown',
        language: 'sfc',
        variables: [],
        body: { language: 'sfc', value: '' },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou).toHaveLength(0)
  })

  it('returns the xml object', () => {
    const xml = makeBaseXml()
    const result = oldEditorParsePousToXML(xml, [])
    expect(result).toBe(xml)
  })

  it('maps function-block pouType to functionBlock for IL language', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function-block',
      data: {
        name: 'ilFb',
        language: 'il',
        variables: [],
        body: { language: 'il', value: 'LD 0' },
        documentation: 'il doc',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('functionBlock')
    expect(result.project.types.pous.pou[0].body).toHaveProperty('IL')
  })

  it('maps function-block pouType to functionBlock for LD language', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function-block',
      data: {
        name: 'ldFb',
        language: 'ld',
        variables: [],
        body: { language: 'ld', value: { name: 'ldFb', rungs: [] } },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('functionBlock')
    expect(result.project.types.pous.pou[0].body).toHaveProperty('LD')
  })

  it('maps function-block pouType to functionBlock for FBD language', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function-block',
      data: {
        name: 'fbdFb',
        language: 'fbd',
        variables: [],
        body: {
          language: 'fbd',
          value: { name: 'fbdFb', rung: { comment: '', selectedNodes: [], nodes: [], edges: [] } },
        },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('functionBlock')
    expect(result.project.types.pous.pou[0].body).toHaveProperty('FBD')
  })

  it('maps function pouType to function for LD language', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function',
      data: {
        name: 'ldFunc',
        language: 'ld',
        returnType: 'BOOL',
        variables: [],
        body: { language: 'ld', value: { name: 'ldFunc', rungs: [] } },
        documentation: 'ld doc',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('function')
  })

  it('maps function pouType to function for FBD language', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function',
      data: {
        name: 'fbdFunc',
        language: 'fbd',
        returnType: 'INT',
        variables: [],
        body: {
          language: 'fbd',
          value: { name: 'fbdFunc', rung: { comment: '', selectedNodes: [], nodes: [], edges: [] } },
        },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('function')
  })

  it('maps function pouType to function for python language', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function',
      data: {
        name: 'pyFunc',
        language: 'python',
        returnType: 'REAL',
        variables: [],
        body: { language: 'python', value: 'x = 1' },
        documentation: 'py doc',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('function')
    expect(result.project.types.pous.pou[0].body).toHaveProperty('ST')
  })

  it('maps function pouType to function for cpp language', () => {
    const xml = makeBaseXml()
    const pou: PLCPou = {
      type: 'function',
      data: {
        name: 'cppFunc',
        language: 'cpp',
        returnType: 'DINT',
        variables: [],
        body: { language: 'cpp', value: 'int x;' },
        documentation: '',
      },
    }
    const result = oldEditorParsePousToXML(xml, [pou])
    expect(result.project.types.pous.pou[0]['@pouType']).toBe('function')
    expect(result.project.types.pous.pou[0].body).toHaveProperty('ST')
  })
})
