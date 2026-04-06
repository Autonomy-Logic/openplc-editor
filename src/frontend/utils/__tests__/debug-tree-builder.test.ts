import type { PLCDataType, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { DebugVariableEntry } from '../debug-parser'
import { buildDebugTree, buildVariableBasePath } from '../debug-tree-builder'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseVariable(name: string, baseType: string, cls: PLCVariable['class'] = 'local'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'base-type', value: baseType },
    location: '',
    documentation: '',
  }
}

function makeDerivedVariable(name: string, typeName: string, cls: PLCVariable['class'] = 'local'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'derived', value: typeName },
    location: '',
    documentation: '',
  }
}

function makeArrayVariable(
  name: string,
  baseType: string,
  dimension: string,
  cls: PLCVariable['class'] = 'local',
): PLCVariable {
  return {
    name,
    class: cls,
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
  }
}

function makeUdtVariable(name: string, typeName: string, cls: PLCVariable['class'] = 'local'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'user-data-type', value: typeName },
    location: '',
    documentation: '',
  }
}

function makeDebugVar(name: string, type: string, index: number): DebugVariableEntry {
  return { name, type, index }
}

function makePou(
  name: string,
  pouType: PLCPou['pouType'],
  vars: PLCVariable[] = [],
  language = 'st',
): PLCPou {
  return {
    name,
    pouType,
    interface: { variables: vars },
    body: { language: language as PLCPou['body']['language'], value: '' },
  }
}

function makeStructDataType(name: string, fields: PLCVariable[]): PLCDataType {
  return {
    name,
    derivation: 'structure',
    variable: fields.map((f) => ({
      name: f.name,
      type: f.type,
    })),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDebugTree', () => {
  const INSTANCE_NAME = 'INSTANCE0'

  describe('base-type variables', () => {
    it('builds a leaf node for a base-type variable', () => {
      const variable = makeBaseVariable('SPEED', 'INT')
      const debugVars = [makeDebugVar('RES0__INSTANCE0.SPEED', 'INT_ENUM', 0)]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.name).toBe('SPEED')
      expect(node.fullPath).toBe('RES0__INSTANCE0.SPEED')
      expect(node.compositeKey).toBe('Main:SPEED')
      expect(node.type).toBe('INT')
      expect(node.isComplex).toBe(false)
      expect(node.debugIndex).toBe(0)
    })

    it('sets debugIndex to undefined when variable is not found in debug.c', () => {
      const variable = makeBaseVariable('MISSING', 'BOOL')
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, [], projectData)

      expect(node.debugIndex).toBeUndefined()
    })
  })

  describe('external variables', () => {
    it('builds a leaf node for an external base-type variable using CONFIG0__ prefix', () => {
      const variable = makeBaseVariable('GLOBAL_FLAG', 'BOOL', 'external')
      const debugVars = [makeDebugVar('CONFIG0__GLOBAL_FLAG', 'BOOL_ENUM', 5)]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.fullPath).toBe('CONFIG0__GLOBAL_FLAG')
      expect(node.compositeKey).toBe('Main:GLOBAL_FLAG')
      expect(node.debugIndex).toBe(5)
      expect(node.isComplex).toBe(false)
    })

    it('sets debugIndex to undefined for external variable not in debug.c', () => {
      const variable = makeBaseVariable('MISSING_GLOBAL', 'INT', 'external')
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, [], projectData)

      expect(node.fullPath).toBe('CONFIG0__MISSING_GLOBAL')
      expect(node.debugIndex).toBeUndefined()
    })

    it('traverses complex external variables using shared traversal', () => {
      const variable = makeDerivedVariable('EXT_FB', 'SR', 'external')
      const debugVars = [
        makeDebugVar('CONFIG0__EXT_FB.S1', 'BOOL_ENUM', 10),
        makeDebugVar('CONFIG0__EXT_FB.R', 'BOOL_ENUM', 11),
        makeDebugVar('CONFIG0__EXT_FB.Q1', 'BOOL_ENUM', 12),
      ]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      // SR is a standard library FB, so it should be expanded
      expect(node.isComplex).toBe(true)
      expect(node.children).toBeDefined()
      expect(node.children!.length).toBe(3)
    })
  })

  describe('derived-type (function block) variables', () => {
    it('builds a complex node for a standard library FB (SR)', () => {
      const variable = makeDerivedVariable('MySR', 'SR')
      const debugVars = [
        makeDebugVar('RES0__INSTANCE0.MYSR.S1', 'BOOL_ENUM', 0),
        makeDebugVar('RES0__INSTANCE0.MYSR.R', 'BOOL_ENUM', 1),
        makeDebugVar('RES0__INSTANCE0.MYSR.Q1', 'BOOL_ENUM', 2),
      ]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.name).toBe('MySR')
      expect(node.isComplex).toBe(true)
      expect(node.type).toBe('SR')
      expect(node.children).toHaveLength(3)
      expect(node.children![0].name).toBe('S1')
      expect(node.children![0].debugIndex).toBe(0)
    })

    it('builds a complex node for a custom FB', () => {
      const customFbPou = makePou('CustomFB', 'function-block', [
        makeBaseVariable('IN1', 'INT', 'input'),
        makeBaseVariable('OUT1', 'BOOL', 'output'),
      ])
      const variable = makeDerivedVariable('myFb', 'CustomFB')
      const debugVars = [
        makeDebugVar('RES0__INSTANCE0.MYFB.IN1', 'INT_ENUM', 3),
        makeDebugVar('RES0__INSTANCE0.MYFB.OUT1', 'BOOL_ENUM', 4),
      ]
      const projectData = { dataTypes: [], pous: [customFbPou] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.isComplex).toBe(true)
      expect(node.children).toHaveLength(2)
      expect(node.children![0].name).toBe('IN1')
      expect(node.children![1].name).toBe('OUT1')
    })

    it('treats unresolvable derived type as leaf', () => {
      const variable = makeDerivedVariable('unknown_fb', 'NonExistentFB')
      const debugVars = [makeDebugVar('RES0__INSTANCE0.UNKNOWN_FB', 'INT_ENUM', 99)]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      // FB not found -> fallback to leaf
      expect(node.isComplex).toBe(false)
      expect(node.debugIndex).toBe(99)
    })
  })

  describe('user-data-type (structure) variables', () => {
    it('builds a complex node for a structure', () => {
      const structType = makeStructDataType('MyStruct', [
        makeBaseVariable('field1', 'INT'),
        makeBaseVariable('field2', 'BOOL'),
      ])
      const variable = makeUdtVariable('myVar', 'MyStruct')
      const debugVars = [
        makeDebugVar('RES0__INSTANCE0.MYVAR.value.FIELD1', 'INT_ENUM', 10),
        makeDebugVar('RES0__INSTANCE0.MYVAR.value.FIELD2', 'BOOL_ENUM', 11),
      ]
      const projectData = { dataTypes: [structType], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.isComplex).toBe(true)
      expect(node.type).toBe('MyStruct')
      expect(node.children).toHaveLength(2)
      expect(node.children![0].name).toBe('field1')
      expect(node.children![0].fullPath).toContain('.value.FIELD1')
      expect(node.children![0].debugIndex).toBe(10)
    })

    it('treats unresolvable UDT as leaf when it is not an FB', () => {
      const variable = makeUdtVariable('myVar', 'UnknownType')
      const debugVars = [makeDebugVar('RES0__INSTANCE0.MYVAR', 'INT_ENUM', 50)]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.isComplex).toBe(false)
      expect(node.debugIndex).toBe(50)
    })

    it('resolves UDT that is actually an FB (user-data-type matching FB name)', () => {
      const customFb = makePou('MyFBType', 'function-block', [
        makeBaseVariable('Q', 'BOOL', 'output'),
      ])
      const variable = makeUdtVariable('myInst', 'MyFBType')
      const debugVars = [makeDebugVar('RES0__INSTANCE0.MYINST.Q', 'BOOL_ENUM', 60)]
      const projectData = { dataTypes: [], pous: [customFb] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.isComplex).toBe(true)
      expect(node.children).toHaveLength(1)
      expect(node.children![0].name).toBe('Q')
    })
  })

  describe('array variables', () => {
    it('builds an array node with indexed children', () => {
      const variable = makeArrayVariable('myArr', 'INT', '0..2')
      const debugVars = [
        makeDebugVar('RES0__INSTANCE0.MYARR.value.table[0]', 'INT_ENUM', 20),
        makeDebugVar('RES0__INSTANCE0.MYARR.value.table[1]', 'INT_ENUM', 21),
        makeDebugVar('RES0__INSTANCE0.MYARR.value.table[2]', 'INT_ENUM', 22),
      ]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.isComplex).toBe(true)
      expect(node.type).toBe('ARRAY')
      expect(node.arrayIndices).toEqual([0, 2])
      expect(node.children).toHaveLength(3)
      expect(node.children![0].name).toBe('[0]')
      expect(node.children![0].debugIndex).toBe(20)
      expect(node.children![2].name).toBe('[2]')
    })

    it('handles arrays with negative start index', () => {
      const variable = makeArrayVariable('negArr', 'BOOL', '-1..1')
      const debugVars = [
        makeDebugVar('RES0__INSTANCE0.NEGARR.value.table[0]', 'BOOL_ENUM', 30),
        makeDebugVar('RES0__INSTANCE0.NEGARR.value.table[1]', 'BOOL_ENUM', 31),
        makeDebugVar('RES0__INSTANCE0.NEGARR.value.table[2]', 'BOOL_ENUM', 32),
      ]
      const projectData = { dataTypes: [], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.arrayIndices).toEqual([-1, 1])
      expect(node.children).toHaveLength(3)
      expect(node.children![0].name).toBe('[-1]')
      expect(node.children![2].name).toBe('[1]')
    })

    it('handles arrays of user-data-type elements', () => {
      const structType = makeStructDataType('Point', [makeBaseVariable('x', 'INT'), makeBaseVariable('y', 'INT')])
      const variable: PLCVariable = {
        name: 'points',
        class: 'local',
        type: {
          definition: 'array',
          value: 'ARRAY [0..1] OF Point',
          data: {
            baseType: { definition: 'user-data-type', value: 'Point' },
            dimensions: [{ dimension: '0..1' }],
          },
        },
        location: '',
        documentation: '',
      }
      const debugVars = [
        makeDebugVar('RES0__INSTANCE0.POINTS.value.table[0].value.X', 'INT_ENUM', 40),
        makeDebugVar('RES0__INSTANCE0.POINTS.value.table[0].value.Y', 'INT_ENUM', 41),
        makeDebugVar('RES0__INSTANCE0.POINTS.value.table[1].value.X', 'INT_ENUM', 42),
        makeDebugVar('RES0__INSTANCE0.POINTS.value.table[1].value.Y', 'INT_ENUM', 43),
      ]
      const projectData = { dataTypes: [structType], pous: [] }

      const node = buildDebugTree(variable, 'Main', INSTANCE_NAME, debugVars, projectData)

      expect(node.isComplex).toBe(true)
      expect(node.children).toHaveLength(2)
      expect(node.children![0].isComplex).toBe(true)
      expect(node.children![0].children).toHaveLength(2)
    })
  })
})

describe('buildVariableBasePath', () => {
  it('returns CONFIG0__ path for external variables', () => {
    const result = buildVariableBasePath('GLOBAL_VAR', 'INSTANCE0', 'external')
    expect(result).toBe('CONFIG0__GLOBAL_VAR')
  })

  it('returns RES0__INSTANCE path for local variables', () => {
    const result = buildVariableBasePath('SPEED', 'INSTANCE0', 'local')
    expect(result).toBe('RES0__INSTANCE0.SPEED')
  })

  it('returns RES0__INSTANCE path when variableClass is undefined', () => {
    const result = buildVariableBasePath('MY_VAR', 'INSTANCE0')
    expect(result).toBe('RES0__INSTANCE0.MY_VAR')
  })
})
