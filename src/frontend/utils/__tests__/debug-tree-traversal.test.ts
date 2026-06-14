import type { PLCDataType, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import type { DebugVariableEntry } from '../debug-parser'
import type { DebugNodeVisitor, TraversalContext } from '../debug-tree-traversal'
import { lookupEnumValues, resolveLeafType, traverseNestedType, traverseVariable } from '../debug-tree-traversal'

/** System libraries pre-loaded into the store by `jest-vi-shim.ts`. */
const SYSTEM_LIBS = openPLCStoreBase.getState().libraries.system

// ---------------------------------------------------------------------------
// Simple visitor that collects node info into a plain object
// ---------------------------------------------------------------------------

interface SimpleNode {
  kind: 'leaf' | 'complex' | 'array'
  name: string
  fullPath: string
  compositeKey: string
  typeName: string
  debugIndex?: number
  arrayIndices?: [number, number]
  children?: SimpleNode[]
}

const simpleVisitor: DebugNodeVisitor<SimpleNode> = {
  visitLeaf(name, fullPath, compositeKey, typeName, debugIndex) {
    return { kind: 'leaf', name, fullPath, compositeKey, typeName, debugIndex }
  },
  visitComplex(name, fullPath, compositeKey, typeName, children) {
    return { kind: 'complex', name, fullPath, compositeKey, typeName, children }
  },
  visitArray(name, fullPath, compositeKey, elementTypeName, arrayIndices, children) {
    return { kind: 'array', name, fullPath, compositeKey, typeName: elementTypeName, arrayIndices, children }
  },
}

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
  baseTypeDef: 'base-type' | 'user-data-type',
  baseTypeValue: string,
  dimension: string,
  cls: PLCVariable['class'] = 'local',
): PLCVariable {
  return {
    name,
    class: cls,
    type: {
      definition: 'array',
      value: `ARRAY [${dimension}] OF ${baseTypeValue}`,
      data: {
        baseType: { definition: baseTypeDef, value: baseTypeValue },
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

function makePou(name: string, pouType: PLCPou['pouType'], vars: PLCVariable[] = []): PLCPou {
  return {
    name,
    pouType,
    interface: { variables: vars },
    body: { language: 'st', value: '' },
  }
}

function makeStructDataType(name: string, fields: { name: string; type: PLCVariable['type'] }[]): PLCDataType {
  return {
    name,
    derivation: 'structure',
    variable: fields.map((f) => ({ name: f.name, type: f.type })),
  }
}

function makeContext(overrides: Partial<TraversalContext> = {}): TraversalContext {
  return {
    debugVariables: [],
    projectPous: [],
    dataTypes: [],
    systemLibraries: SYSTEM_LIBS,
    instanceName: 'INSTANCE0',
    pouName: 'Main',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('traverseVariable', () => {
  describe('base-type variables', () => {
    it('returns a leaf node for a base-type variable', () => {
      const variable = makeBaseVariable('SPEED', 'INT')
      const debugVars = [makeDebugVar('INSTANCE0.SPEED', 'INT_ENUM', 0)]
      const ctx = makeContext({ debugVariables: debugVars })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('leaf')
      expect(result.name).toBe('SPEED')
      expect(result.fullPath).toBe('INSTANCE0.SPEED')
      expect(result.compositeKey).toBe('Main:SPEED')
      expect(result.typeName).toBe('INT')
      expect(result.debugIndex).toBe(0)
    })

    it('returns undefined debugIndex when variable not found in debug.c', () => {
      const variable = makeBaseVariable('MISSING', 'BOOL')
      const ctx = makeContext()

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.debugIndex).toBeUndefined()
    })
  })

  describe('external variables', () => {
    it('uses  prefix for external base-type variables', () => {
      const variable = makeBaseVariable('GLOBAL_FLAG', 'BOOL', 'external')
      const debugVars = [makeDebugVar('GLOBAL_FLAG', 'BOOL_ENUM', 5)]
      const ctx = makeContext({ debugVariables: debugVars })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.fullPath).toBe('GLOBAL_FLAG')
      expect(result.debugIndex).toBe(5)
    })
  })

  describe('derived-type (function block) variables', () => {
    it('expands a standard library FB (SR) into complex node', () => {
      const variable = makeDerivedVariable('mySR', 'SR')
      const debugVars = [
        makeDebugVar('INSTANCE0.MYSR.S1', 'BOOL_ENUM', 0),
        makeDebugVar('INSTANCE0.MYSR.R', 'BOOL_ENUM', 1),
        makeDebugVar('INSTANCE0.MYSR.Q1', 'BOOL_ENUM', 2),
      ]
      const ctx = makeContext({ debugVariables: debugVars })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children).toHaveLength(3)
      expect(result.children![0].name).toBe('S1')
      expect(result.children![0].debugIndex).toBe(0)
    })

    it('expands a custom FB into complex node', () => {
      const customFb = makePou('MyCustomFB', 'function-block', [
        makeBaseVariable('X', 'INT', 'input'),
        makeBaseVariable('Y', 'BOOL', 'output'),
      ])
      const variable = makeDerivedVariable('inst', 'MyCustomFB')
      const debugVars = [
        makeDebugVar('INSTANCE0.INST.X', 'INT_ENUM', 10),
        makeDebugVar('INSTANCE0.INST.Y', 'BOOL_ENUM', 11),
      ]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [customFb] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children).toHaveLength(2)
    })

    it('treats unresolvable derived type as leaf', () => {
      const variable = makeDerivedVariable('inst', 'NonExistent')
      const debugVars = [makeDebugVar('INSTANCE0.INST', 'INT_ENUM', 99)]
      const ctx = makeContext({ debugVariables: debugVars })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('leaf')
      expect(result.debugIndex).toBe(99)
    })

    it('handles nested FB with derived-type child', () => {
      const innerFb = makePou('InnerFB', 'function-block', [makeBaseVariable('Q', 'BOOL', 'output')])
      const outerFb = makePou('OuterFB', 'function-block', [makeDerivedVariable('inner', 'InnerFB', 'local')])
      const variable = makeDerivedVariable('outer', 'OuterFB')
      const debugVars = [makeDebugVar('INSTANCE0.OUTER.INNER.Q', 'BOOL_ENUM', 20)]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [innerFb, outerFb] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].kind).toBe('complex')
      expect(result.children![0].children![0].name).toBe('Q')
      expect(result.children![0].children![0].debugIndex).toBe(20)
    })

    it('handles FB with user-data-type child that is an FB', () => {
      const innerFb = makePou('SubFB', 'function-block', [makeBaseVariable('Z', 'INT', 'output')])
      const outerFb = makePou('WrapperFB', 'function-block', [makeUdtVariable('sub', 'SubFB', 'local')])
      const variable = makeDerivedVariable('wrapper', 'WrapperFB')
      const debugVars = [makeDebugVar('INSTANCE0.WRAPPER.SUB.Z', 'INT_ENUM', 30)]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [innerFb, outerFb] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].kind).toBe('complex')
    })

    it('handles FB with user-data-type child that is a struct', () => {
      const structType = makeStructDataType('MyStruct', [
        { name: 'field1', type: { definition: 'base-type', value: 'INT' } },
      ])
      const outerFb = makePou('FBWithStruct', 'function-block', [makeUdtVariable('data', 'MyStruct', 'local')])
      const variable = makeDerivedVariable('inst', 'FBWithStruct')
      const debugVars = [makeDebugVar('INSTANCE0.INST.DATAFIELD1', 'INT_ENUM', 40)]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [outerFb], dataTypes: [structType] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].kind).toBe('complex')
      expect(result.children![0].children![0].name).toBe('field1')
    })

    it('handles FB with array child', () => {
      const outerFb = makePou('FBWithArray', 'function-block', [
        makeArrayVariable('arr', 'base-type', 'INT', '0..1', 'local'),
      ])
      const variable = makeDerivedVariable('inst', 'FBWithArray')
      const debugVars = [
        makeDebugVar('INSTANCE0.INST.ARR[0]', 'INT_ENUM', 50),
        makeDebugVar('INSTANCE0.INST.ARR[1]', 'INT_ENUM', 51),
      ]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [outerFb] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].kind).toBe('array')
      expect(result.children![0].children).toHaveLength(2)
    })

    it('skips FB child with array definition but no data', () => {
      const outerFb = makePou('FBWithBadArray', 'function-block', [
        {
          name: 'badArr',
          class: 'local' as PLCVariable['class'],
          type: { definition: 'array' as const, value: 'ARRAY' },
          location: '',
          documentation: '',
        },
      ])
      const variable = makeDerivedVariable('inst', 'FBWithBadArray')
      const ctx = makeContext({ projectPous: [outerFb] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      // badArr has array definition but no data, so it is skipped by the FB child loop
      expect(result.kind).toBe('complex')
      expect(result.children).toHaveLength(0)
    })
  })

  describe('user-data-type variables', () => {
    it('expands a structure into a complex node', () => {
      const structType = makeStructDataType('Point', [
        { name: 'x', type: { definition: 'base-type', value: 'INT' } },
        { name: 'y', type: { definition: 'base-type', value: 'INT' } },
      ])
      const variable = makeUdtVariable('pos', 'Point')
      const debugVars = [makeDebugVar('INSTANCE0.POSX', 'INT_ENUM', 10), makeDebugVar('INSTANCE0.POSY', 'INT_ENUM', 11)]
      const ctx = makeContext({ debugVariables: debugVars, dataTypes: [structType] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children).toHaveLength(2)
      expect(result.children![0].name).toBe('x')
      expect(result.children![0].fullPath).toContain('X')
    })

    it('treats unresolvable UDT as leaf', () => {
      const variable = makeUdtVariable('unknown', 'NoSuchType')
      const debugVars = [makeDebugVar('INSTANCE0.UNKNOWN', 'INT_ENUM', 99)]
      const ctx = makeContext({ debugVariables: debugVars })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('leaf')
    })

    it('resolves UDT to FB when name matches a function-block POU', () => {
      const customFb = makePou('SomeFB', 'function-block', [makeBaseVariable('Q', 'BOOL', 'output')])
      const variable = makeUdtVariable('inst', 'SomeFB')
      const debugVars = [makeDebugVar('INSTANCE0.INST.Q', 'BOOL_ENUM', 55)]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [customFb] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].name).toBe('Q')
    })

    it('handles struct with nested UDT field that is a struct', () => {
      const innerStruct = makeStructDataType('Inner', [
        { name: 'val', type: { definition: 'base-type', value: 'INT' } },
      ])
      const outerStruct = makeStructDataType('Outer', [
        { name: 'nested', type: { definition: 'user-data-type', value: 'Inner' } },
      ])
      const variable = makeUdtVariable('obj', 'Outer')
      const debugVars = [makeDebugVar('INSTANCE0.OBJNESTEDVAL', 'INT_ENUM', 70)]
      const ctx = makeContext({ debugVariables: debugVars, dataTypes: [innerStruct, outerStruct] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].kind).toBe('complex')
      expect(result.children![0].children![0].name).toBe('val')
    })

    it('handles struct with nested UDT field that is an FB', () => {
      const fbPou = makePou('NestedFB', 'function-block', [makeBaseVariable('OUT', 'BOOL', 'output')])
      const outerStruct = makeStructDataType('StructWithFB', [
        { name: 'fb', type: { definition: 'user-data-type', value: 'NestedFB' } },
      ])
      const variable = makeUdtVariable('data', 'StructWithFB')
      const debugVars = [makeDebugVar('INSTANCE0.DATAFB.OUT', 'BOOL_ENUM', 80)]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [fbPou], dataTypes: [outerStruct] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].kind).toBe('complex')
    })

    it('handles struct with array field', () => {
      const outerStruct = makeStructDataType('StructWithArray', [
        {
          name: 'arr',
          type: {
            definition: 'array',
            value: 'ARRAY [0..1] OF INT',
            data: {
              baseType: { definition: 'base-type', value: 'INT' },
              dimensions: [{ dimension: '0..1' }],
            },
          },
        },
      ])
      const variable = makeUdtVariable('s', 'StructWithArray')
      const debugVars = [
        makeDebugVar('INSTANCE0.SARR[0]', 'INT_ENUM', 90),
        makeDebugVar('INSTANCE0.SARR[1]', 'INT_ENUM', 91),
      ]
      const ctx = makeContext({ debugVariables: debugVars, dataTypes: [outerStruct] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('complex')
      expect(result.children![0].kind).toBe('array')
    })

    it('skips struct field with array definition but no data', () => {
      const outerStruct = makeStructDataType('StructWithBadArray', [
        {
          name: 'badArr',
          type: { definition: 'array' as const, value: 'ARRAY' },
        },
      ])
      const variable = makeUdtVariable('s', 'StructWithBadArray')
      const ctx = makeContext({ dataTypes: [outerStruct] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      // badArr has array definition but no data, so it is skipped in struct traversal
      expect(result.kind).toBe('complex')
      expect(result.children).toHaveLength(0)
    })
  })

  describe('array variables', () => {
    it('builds an array node with base-type elements', () => {
      const variable = makeArrayVariable('myArr', 'base-type', 'INT', '1..3')
      const debugVars = [
        makeDebugVar('INSTANCE0.MYARR[0]', 'INT_ENUM', 0),
        makeDebugVar('INSTANCE0.MYARR[1]', 'INT_ENUM', 1),
        makeDebugVar('INSTANCE0.MYARR[2]', 'INT_ENUM', 2),
      ]
      const ctx = makeContext({ debugVariables: debugVars })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('array')
      expect(result.arrayIndices).toEqual([1, 3])
      expect(result.children).toHaveLength(3)
      expect(result.children![0].name).toBe('[1]')
      expect(result.children![2].name).toBe('[3]')
    })

    it('builds an array node with UDT elements', () => {
      const structType = makeStructDataType('Item', [{ name: 'val', type: { definition: 'base-type', value: 'INT' } }])
      const variable = makeArrayVariable('items', 'user-data-type', 'Item', '0..0')
      const debugVars = [makeDebugVar('INSTANCE0.ITEMS[0]VAL', 'INT_ENUM', 100)]
      const ctx = makeContext({ debugVariables: debugVars, dataTypes: [structType] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('array')
      expect(result.children).toHaveLength(1)
      expect(result.children![0].kind).toBe('complex')
    })

    it('skips array elements when base type is neither base-type nor user-data-type', () => {
      // An array with a derived base type falls through both if branches in the loop
      const variable: PLCVariable = {
        name: 'oddArr',
        class: 'local',
        type: {
          definition: 'array',
          value: 'ARRAY [0..0] OF SomeFB',
          data: {
            baseType: { definition: 'derived' as 'base-type' | 'user-data-type', value: 'SomeFB' },
            dimensions: [{ dimension: '0..0' }],
          },
        },
        location: '',
        documentation: '',
      }
      const ctx = makeContext()

      const result = traverseVariable(variable, ctx, simpleVisitor)

      // Array is created, but element is skipped (no children because neither branch matched)
      expect(result.kind).toBe('array')
      expect(result.children).toHaveLength(0)
    })

    it('returns leaf for array with no dimensions', () => {
      const variable: PLCVariable = {
        name: 'emptyArr',
        class: 'local',
        type: {
          definition: 'array',
          value: 'ARRAY',
          data: {
            baseType: { definition: 'base-type', value: 'INT' },
            dimensions: [],
          },
        },
        location: '',
        documentation: '',
      }
      const ctx = makeContext()

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('leaf')
      expect(result.typeName).toBe('ARRAY')
    })

    it('builds an array node with UDT elements that resolve to FB', () => {
      const customFb = makePou('InnerFB', 'function-block', [makeBaseVariable('Q', 'BOOL', 'output')])
      const variable = makeArrayVariable('fbArr', 'user-data-type', 'InnerFB', '0..0')
      const debugVars = [makeDebugVar('INSTANCE0.FBARR[0].Q', 'BOOL_ENUM', 110)]
      const ctx = makeContext({ debugVariables: debugVars, projectPous: [customFb] })

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('array')
      expect(result.children).toHaveLength(1)
      // UDT element resolved as FB -> complex node
      expect(result.children![0].kind).toBe('complex')
      expect(result.children![0].children![0].name).toBe('Q')
    })

    it('returns leaf for array with invalid dimension format', () => {
      const variable: PLCVariable = {
        name: 'badArr',
        class: 'local',
        type: {
          definition: 'array',
          value: 'ARRAY [bad] OF INT',
          data: {
            baseType: { definition: 'base-type', value: 'INT' },
            dimensions: [{ dimension: 'bad' }],
          },
        },
        location: '',
        documentation: '',
      }
      const ctx = makeContext()

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('leaf')
      expect(result.typeName).toBe('ARRAY')
    })
  })

  describe('unknown type definition', () => {
    it('returns leaf for completely unknown type definition', () => {
      const variable: PLCVariable = {
        name: 'weird',
        class: 'local',
        type: { definition: 'something-else' as PLCVariable['type']['definition'], value: 'WHAT' },
        location: '',
        documentation: '',
      }
      const ctx = makeContext()

      const result = traverseVariable(variable, ctx, simpleVisitor)

      expect(result.kind).toBe('leaf')
      expect(result.typeName).toBe('UNKNOWN')
    })
  })
})

describe('traverseNestedType', () => {
  it('delegates to the internal traverseNestedNode for derived types', () => {
    const customFb = makePou('MyFB', 'function-block', [makeBaseVariable('X', 'INT', 'output')])
    const debugVars = [makeDebugVar('INSTANCE0.INST.X', 'INT_ENUM', 0)]
    const ctx = makeContext({ debugVariables: debugVars, projectPous: [customFb] })

    const result = traverseNestedType('inst', 'INSTANCE0.INST', 'Main:inst', 'MyFB', 'derived', ctx, simpleVisitor)

    expect(result.kind).toBe('complex')
    expect(result.children![0].name).toBe('X')
  })

  it('delegates for user-data-type (structure)', () => {
    const structType = makeStructDataType('S', [{ name: 'f', type: { definition: 'base-type', value: 'BOOL' } }])
    const debugVars = [makeDebugVar('INSTANCE0.VARF', 'BOOL_ENUM', 5)]
    const ctx = makeContext({ debugVariables: debugVars, dataTypes: [structType] })

    const result = traverseNestedType('var', 'INSTANCE0.VAR', 'Main:var', 'S', 'user-data-type', ctx, simpleVisitor)

    expect(result.kind).toBe('complex')
    expect(result.children![0].name).toBe('f')
  })

  it('delegates for array type', () => {
    const debugVars = [makeDebugVar('INSTANCE0.ARR[0]', 'INT_ENUM', 10)]
    const ctx = makeContext({ debugVariables: debugVars })
    const arrayData = {
      baseType: { definition: 'base-type' as const, value: 'INT' },
      dimensions: [{ dimension: '0..0' }],
    }

    const result = traverseNestedType(
      'arr',
      'INSTANCE0.ARR',
      'Main:arr',
      'ARRAY',
      'array',
      ctx,
      simpleVisitor,
      arrayData,
    )

    expect(result.kind).toBe('array')
    expect(result.children).toHaveLength(1)
  })

  it('falls through to leaf for unknown nested typeDefinition', () => {
    const ctx = makeContext()

    const result = traverseNestedType('x', 'INSTANCE0.X', 'Main:x', 'SomeType', 'derived', ctx, simpleVisitor)

    // 'derived' with no matching FB definition -> leaf
    expect(result.kind).toBe('leaf')
  })

  it('falls through to leaf for array typeDefinition without arrayData', () => {
    const debugVars = [makeDebugVar('INSTANCE0.ARR', 'INT_ENUM', 42)]
    const ctx = makeContext({ debugVariables: debugVars })

    const result = traverseNestedType(
      'arr',
      'INSTANCE0.ARR',
      'Main:arr',
      'ARRAY',
      'array',
      ctx,
      simpleVisitor,
      // No arrayData passed -> falls through to unknown-type leaf
    )

    expect(result.kind).toBe('leaf')
    expect(result.debugIndex).toBe(42)
  })

  it('resolves standard library FB through isFunctionBlock for UDT child inside struct', () => {
    // Create a struct that has a field of type 'SR' (standard library FB)
    // but declared as user-data-type. isFunctionBlock should detect SR as standard FB.
    const outerStruct = makeStructDataType('StructWithStdFB', [
      { name: 'sr_inst', type: { definition: 'user-data-type', value: 'SR' } },
    ])
    const variable = makeUdtVariable('s', 'StructWithStdFB')
    const debugVars = [
      makeDebugVar('INSTANCE0.SSR_INST.S1', 'BOOL_ENUM', 100),
      makeDebugVar('INSTANCE0.SSR_INST.R', 'BOOL_ENUM', 101),
      makeDebugVar('INSTANCE0.SSR_INST.Q1', 'BOOL_ENUM', 102),
    ]
    const ctx = makeContext({ debugVariables: debugVars, dataTypes: [outerStruct] })

    const result = traverseVariable(variable, ctx, simpleVisitor)

    expect(result.kind).toBe('complex')
    // SR resolved as FB through isFunctionBlock -> the child is a complex node
    expect(result.children![0].kind).toBe('complex')
    expect(result.children![0].children).toHaveLength(3)
  })

  it('resolves standard library FB in array element user-data-type', () => {
    // Array of SR (standard library FB)
    const variable = makeArrayVariable('arr', 'user-data-type', 'SR', '0..0')
    const debugVars = [
      makeDebugVar('INSTANCE0.ARR[0].S1', 'BOOL_ENUM', 200),
      makeDebugVar('INSTANCE0.ARR[0].R', 'BOOL_ENUM', 201),
      makeDebugVar('INSTANCE0.ARR[0].Q1', 'BOOL_ENUM', 202),
    ]
    const ctx = makeContext({ debugVariables: debugVars })

    const result = traverseVariable(variable, ctx, simpleVisitor)

    expect(result.kind).toBe('array')
    expect(result.children).toHaveLength(1)
    expect(result.children![0].kind).toBe('complex')
  })
})

describe('resolveLeafType', () => {
  it('returns the project type unchanged when no debug variable is provided', () => {
    expect(resolveLeafType('INT', null)).toBe('INT')
    expect(resolveLeafType('Irrigation_State', null)).toBe('Irrigation_State')
  })

  it('returns the project type when debug variable has no type', () => {
    const debugVar: DebugVariableEntry = { name: 'x', type: '', index: 0 }
    expect(resolveLeafType('REAL', debugVar)).toBe('REAL')
  })

  it('strips _ENUM suffix from MatIEC-shaped debug type', () => {
    const debugVar: DebugVariableEntry = { name: 'x', type: 'INT_ENUM', index: 0 }
    expect(resolveLeafType('Irrigation_State', debugVar)).toBe('INT')
  })

  it('strips _O_ENUM suffix (output enum)', () => {
    const debugVar: DebugVariableEntry = { name: 'q', type: 'BOOL_O_ENUM', index: 0 }
    expect(resolveLeafType('SomeEnum', debugVar)).toBe('BOOL')
  })

  it('strips _P_ENUM suffix (param enum)', () => {
    const debugVar: DebugVariableEntry = { name: 'p', type: 'DINT_P_ENUM', index: 0 }
    expect(resolveLeafType('OtherEnum', debugVar)).toBe('DINT')
  })

  it('only strips the _O_ENUM/_P_ENUM at the end, not in the middle', () => {
    // Underscore-rich names like FOO_O_ENUM_BAR are not enum-suffixed and
    // should pass through unchanged (the regex anchors with $).
    const debugVar: DebugVariableEntry = { name: 'x', type: 'FOO_O_ENUM_BAR', index: 0 }
    expect(resolveLeafType('whatever', debugVar)).toBe('FOO_O_ENUM_BAR')
  })

  it('returns the debug type as-is when it has no _ENUM suffix', () => {
    const debugVar: DebugVariableEntry = { name: 'x', type: 'WORD', index: 0 }
    expect(resolveLeafType('WORD', debugVar)).toBe('WORD')
  })
})

describe('lookupEnumValues', () => {
  const enumDataType: PLCDataType = {
    name: 'TrafficLight',
    derivation: 'enumerated',
    values: [{ description: 'RED' }, { description: 'YELLOW' }, { description: 'GREEN' }],
  }

  const structDataType: PLCDataType = {
    name: 'PointStruct',
    derivation: 'structure',
    variable: [],
  }

  it('returns the member descriptions in declaration order for an enum match', () => {
    expect(lookupEnumValues('TrafficLight', [enumDataType])).toEqual(['RED', 'YELLOW', 'GREEN'])
  })

  it('matches case-insensitively', () => {
    expect(lookupEnumValues('trafficlight', [enumDataType])).toEqual(['RED', 'YELLOW', 'GREEN'])
    expect(lookupEnumValues('TRAFFICLIGHT', [enumDataType])).toEqual(['RED', 'YELLOW', 'GREEN'])
  })

  it('returns undefined when the named type is not enumerated', () => {
    expect(lookupEnumValues('PointStruct', [structDataType])).toBeUndefined()
  })

  it('returns undefined when no data type matches the name', () => {
    expect(lookupEnumValues('Unknown', [enumDataType])).toBeUndefined()
  })

  it('returns undefined for an empty data-types array', () => {
    expect(lookupEnumValues('TrafficLight', [])).toBeUndefined()
  })

  it('finds the right enum among many data types', () => {
    const otherEnum: PLCDataType = {
      name: 'AnotherEnum',
      derivation: 'enumerated',
      values: [{ description: 'A' }, { description: 'B' }],
    }
    expect(lookupEnumValues('TrafficLight', [otherEnum, structDataType, enumDataType])).toEqual([
      'RED',
      'YELLOW',
      'GREEN',
    ])
  })

  it('returns an empty array when an enum has no members (degenerate but valid)', () => {
    const empty: PLCDataType = { name: 'Empty', derivation: 'enumerated', values: [] }
    expect(lookupEnumValues('Empty', [empty])).toEqual([])
  })
})
