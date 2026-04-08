import type { OpcUaFieldConfig, OpcUaNodeConfig, OpcUaPermissions } from '@root/middleware/shared/ports/open-plc-types'

import { OpcUaConfigError, resolveArrayIndex, resolveStructureIndices, resolveVariableIndex } from '../resolve-indices'
import type { DebugVariable, PLCInstanceInfo } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const perm: OpcUaPermissions = { viewer: 'r', operator: 'rw', engineer: 'rw' }

const makeNode = (overrides: Partial<OpcUaNodeConfig> = {}): OpcUaNodeConfig => ({
  id: 'n1',
  pouName: 'MAIN',
  variablePath: 'MY_VAR',
  variableType: 'INT',
  nodeId: 'ns=1;s=MY_VAR',
  browseName: 'MY_VAR',
  displayName: 'My Variable',
  description: '',
  initialValue: 0,
  permissions: perm,
  nodeType: 'variable',
  ...overrides,
})

const makeField = (overrides: Partial<OpcUaFieldConfig> = {}): OpcUaFieldConfig => ({
  fieldPath: 'FIELD1',
  displayName: 'Field 1',
  initialValue: 0,
  permissions: perm,
  ...overrides,
})

const dv = (name: string, type: string, index: number): DebugVariable => ({ name, type, index })
const inst = (name: string, program: string): PLCInstanceInfo => ({ name, task: 'T0', program })

// ---------------------------------------------------------------------------
// OpcUaConfigError
// ---------------------------------------------------------------------------

describe('OpcUaConfigError', () => {
  it('stores variableRef, expectedPath and is instanceof Error', () => {
    const e = new OpcUaConfigError('ref', 'path', 'msg')
    expect(e.name).toBe('OpcUaConfigError')
    expect(e.variableRef).toBe('ref')
    expect(e.expectedPath).toBe('path')
    expect(e.message).toBe('msg')
    expect(e).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// resolveVariableIndex
// ---------------------------------------------------------------------------

describe('resolveVariableIndex', () => {
  it('resolves a global variable (GVL)', () => {
    const node = makeNode({ pouName: 'GVL', variablePath: 'SPEED' })
    expect(resolveVariableIndex(node, [dv('CONFIG0__SPEED', 'INT_ENUM', 5)], [])).toBe(5)
  })

  it('resolves a global variable (CONFIG)', () => {
    const node = makeNode({ pouName: 'CONFIG', variablePath: 'TEMP' })
    expect(resolveVariableIndex(node, [dv('CONFIG0__TEMP', 'REAL_ENUM', 2)], [])).toBe(2)
  })

  it('resolves lowercase gvl via toUpperCase check', () => {
    const node = makeNode({ pouName: 'gvl', variablePath: 'B' })
    expect(resolveVariableIndex(node, [dv('CONFIG0__B', 'BOOL_ENUM', 0)], [])).toBe(0)
  })

  it('throws OpcUaConfigError when global variable not found (line 83)', () => {
    const node = makeNode({ pouName: 'GVL', variablePath: 'MISSING' })
    expect(() => resolveVariableIndex(node, [], [])).toThrow(OpcUaConfigError)
    expect(() => resolveVariableIndex(node, [], [])).toThrow('Cannot resolve OPC-UA global variable index')
  })

  it('resolves program variable via instance (FB-style match)', () => {
    const node = makeNode({ pouName: 'MAIN', variablePath: 'COUNTER' })
    expect(
      resolveVariableIndex(node, [dv('RES0__INSTANCE0.COUNTER', 'INT_ENUM', 10)], [inst('INSTANCE0', 'MAIN')]),
    ).toBe(10)
  })

  it('resolves program variable via struct-style fallback', () => {
    const node = makeNode({ pouName: 'MAIN', variablePath: 'S.F' })
    expect(
      resolveVariableIndex(node, [dv('RES0__INSTANCE0.S.value.F', 'INT_ENUM', 42)], [inst('INSTANCE0', 'MAIN')]),
    ).toBe(42)
  })

  it('throws when instance not found for program', () => {
    const node = makeNode({ pouName: 'NO_PROG', variablePath: 'X' })
    expect(() => resolveVariableIndex(node, [], [])).toThrow(OpcUaConfigError)
    expect(() => resolveVariableIndex(node, [], [])).toThrow('Cannot find instance for program')
  })

  it('throws when variable path not found after fallback', () => {
    const node = makeNode({ pouName: 'MAIN', variablePath: 'MISSING' })
    expect(() =>
      resolveVariableIndex(node, [dv('RES0__INSTANCE0.OTHER', 'INT_ENUM', 0)], [inst('INSTANCE0', 'MAIN')]),
    ).toThrow('Cannot resolve OPC-UA variable index')
  })
})

// ---------------------------------------------------------------------------
// resolveStructureIndices
// ---------------------------------------------------------------------------

describe('resolveStructureIndices', () => {
  it('falls back to resolveVariableIndex when no fields (lines 225-226)', () => {
    const node = makeNode({ nodeType: 'structure', variablePath: 'MY_FB', variableType: 'FB_T' })
    const result = resolveStructureIndices(
      node,
      [dv('RES0__INSTANCE0.MY_FB', 'INT_ENUM', 7)],
      [inst('INSTANCE0', 'MAIN')],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'MY_FB', datatype: 'FB_T', index: 7 })
  })

  it('throws when instance not found for program with fields (line 242)', () => {
    const node = makeNode({ nodeType: 'structure', pouName: 'UNK', variablePath: 'S', fields: [makeField()] })
    expect(() => resolveStructureIndices(node, [], [])).toThrow('Cannot find instance for program')
  })

  it('resolves leaf fields for a structure', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'MY_STRUCT',
      fields: [
        makeField({ fieldPath: 'X', datatype: 'INT', initialValue: 0 }),
        makeField({ fieldPath: 'Y', datatype: 'REAL', initialValue: 0 }),
      ],
    })
    const result = resolveStructureIndices(
      node,
      [dv('RES0__INSTANCE0.MY_STRUCT.X', 'INT_ENUM', 3), dv('RES0__INSTANCE0.MY_STRUCT.Y', 'REAL_ENUM', 4)],
      [inst('INSTANCE0', 'MAIN')],
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'X', index: 3, datatype: 'INT' })
    expect(result[1]).toMatchObject({ name: 'Y', index: 4, datatype: 'REAL' })
  })

  it('resolves nested fields recursively (lines 153-159)', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'MY_FB',
      fields: [
        makeField({
          fieldPath: 'TON0',
          datatype: 'TON',
          initialValue: '',
          fields: [
            makeField({ fieldPath: 'IN', datatype: 'BOOL', initialValue: false }),
            makeField({ fieldPath: 'ET', datatype: 'TIME', initialValue: 0 }),
          ],
        }),
      ],
    })
    const result = resolveStructureIndices(
      node,
      [dv('RES0__INSTANCE0.MY_FB.TON0.IN', 'BOOL_ENUM', 10), dv('RES0__INSTANCE0.MY_FB.TON0.ET', 'TIME_ENUM', 11)],
      [inst('INSTANCE0', 'MAIN')],
    )
    expect(result).toHaveLength(1)
    expect(result[0].index).toBeNull()
    expect(result[0].fields).toHaveLength(2)
    expect(result[0].fields![0]).toMatchObject({ name: 'IN', index: 10, datatype: 'BOOL' })
    expect(result[0].fields![1]).toMatchObject({ name: 'ET', index: 11, datatype: 'TIME' })
  })

  it('defaults complex type datatype to UNKNOWN when no datatype set', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'FB',
      fields: [
        makeField({
          fieldPath: 'INNER',
          initialValue: '',
          // datatype intentionally missing
          fields: [makeField({ fieldPath: 'L', datatype: 'BOOL', initialValue: false })],
        }),
      ],
    })
    const result = resolveStructureIndices(
      node,
      [dv('RES0__INSTANCE0.FB.INNER.L', 'BOOL_ENUM', 99)],
      [inst('INSTANCE0', 'MAIN')],
    )
    expect(result[0].datatype).toBe('UNKNOWN')
    expect(result[0].index).toBeNull()
  })

  it('resolves global structure fields (pouName = GVL) (lines 175-176)', () => {
    const node = makeNode({
      nodeType: 'structure',
      pouName: 'GVL',
      variablePath: 'GS',
      fields: [makeField({ fieldPath: 'V', datatype: 'BOOL', initialValue: false })],
    })
    const result = resolveStructureIndices(node, [dv('CONFIG0__GS.V', 'BOOL_ENUM', 20)], [])
    expect(result[0]).toMatchObject({ name: 'V', index: 20, datatype: 'BOOL' })
  })

  it('resolves CONFIG pouName structure fields (skips instance lookup)', () => {
    const node = makeNode({
      nodeType: 'structure',
      pouName: 'CONFIG',
      variablePath: 'CS',
      fields: [makeField({ fieldPath: 'W', datatype: 'INT', initialValue: 0 })],
    })
    const result = resolveStructureIndices(node, [dv('CONFIG0__CS.W', 'INT_ENUM', 30)], [])
    expect(result[0]).toMatchObject({ name: 'W', index: 30, datatype: 'INT' })
  })

  it('throws when a leaf field cannot be resolved (line 185)', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'MISSING' })],
    })
    expect(() => resolveStructureIndices(node, [], [inst('INSTANCE0', 'MAIN')])).toThrow(
      'Cannot resolve OPC-UA structure/FB field index',
    )
  })

  it('uses struct-style fallback for leaf field resolution', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'A', datatype: 'DINT', initialValue: 0 })],
    })
    const result = resolveStructureIndices(
      node,
      [dv('RES0__INSTANCE0.S.value.A', 'DINT_ENUM', 55)],
      [inst('INSTANCE0', 'MAIN')],
    )
    expect(result[0]).toMatchObject({ name: 'A', index: 55, datatype: 'DINT' })
  })

  it('uses field datatype when debug entry has empty type string', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'B', datatype: 'REAL', initialValue: 0 })],
    })
    const result = resolveStructureIndices(node, [dv('RES0__INSTANCE0.S.B', '', 60)], [inst('INSTANCE0', 'MAIN')])
    expect(result[0].datatype).toBe('REAL')
  })

  it('defaults datatype to UNKNOWN when no field datatype and no debug type', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'C', initialValue: 0 })],
    })
    const result = resolveStructureIndices(node, [dv('RES0__INSTANCE0.S.C', '', 61)], [inst('INSTANCE0', 'MAIN')])
    expect(result[0].datatype).toBe('UNKNOWN')
  })
})

// ---------------------------------------------------------------------------
// debugTypeToIecType (tested indirectly through field resolution)
// ---------------------------------------------------------------------------

describe('debugTypeToIecType (indirect)', () => {
  const resolveLeaf = (debugType: string) => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'F', initialValue: 0 })],
    })
    return resolveStructureIndices(node, [dv('RES0__INSTANCE0.S.F', debugType, 0)], [inst('INSTANCE0', 'MAIN')])[0]
      .datatype
  }

  it('strips _ENUM suffix', () => {
    expect(resolveLeaf('DINT_ENUM')).toBe('DINT')
  })

  it('strips _P_ENUM suffix (pointer type)', () => {
    expect(resolveLeaf('INT_P_ENUM')).toBe('INT')
  })

  it('strips _O_ENUM suffix (output type)', () => {
    expect(resolveLeaf('BOOL_O_ENUM')).toBe('BOOL')
  })

  it('returns original type when no known suffix', () => {
    expect(resolveLeaf('CUSTOM')).toBe('CUSTOM')
  })
})

// ---------------------------------------------------------------------------
// resolveArrayIndex
// ---------------------------------------------------------------------------

describe('resolveArrayIndex', () => {
  it('resolves a global array (GVL)', () => {
    const node = makeNode({ nodeType: 'array', pouName: 'GVL', variablePath: 'ARR', arrayLength: 10 })
    expect(resolveArrayIndex(node, [dv('CONFIG0__ARR.value.table[0]', 'INT_ENUM', 100)], [])).toBe(100)
  })

  it('resolves a CONFIG array', () => {
    const node = makeNode({ nodeType: 'array', pouName: 'CONFIG', variablePath: 'CA', arrayLength: 5 })
    expect(resolveArrayIndex(node, [dv('CONFIG0__CA.value.table[0]', 'BOOL_ENUM', 50)], [])).toBe(50)
  })

  it('resolves a program array (line 281)', () => {
    const node = makeNode({ nodeType: 'array', variablePath: 'SPEEDS', arrayLength: 3 })
    expect(
      resolveArrayIndex(
        node,
        [dv('RES0__INSTANCE0.SPEEDS.value.table[0]', 'INT_ENUM', 200)],
        [inst('INSTANCE0', 'MAIN')],
      ),
    ).toBe(200)
  })

  it('throws when instance not found for program array (line 287)', () => {
    const node = makeNode({ nodeType: 'array', pouName: 'MISSING', variablePath: 'A', arrayLength: 5 })
    expect(() => resolveArrayIndex(node, [], [])).toThrow('Cannot find instance for program')
  })

  it('throws when array first element not found (line 307)', () => {
    const node = makeNode({ nodeType: 'array', variablePath: 'MISSING_ARR', arrayLength: 5 })
    expect(() => resolveArrayIndex(node, [], [inst('INSTANCE0', 'MAIN')])).toThrow('Cannot resolve OPC-UA array index')
  })
})
