import type { OpcUaFieldConfig, OpcUaNodeConfig, OpcUaPermissions } from '@root/middleware/shared/ports/open-plc-types'

import type { DebugLeafInfo } from '../../debug-parser'
import {
  OpcUaConfigError,
  resolveArrayAddress,
  resolveStructureAddresses,
  resolveVariableAddress,
} from '../resolve-indices'
import type { PLCInstanceInfo } from '../types'

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
  permissions: perm,
  nodeType: 'variable',
  ...overrides,
})

const makeField = (overrides: Partial<OpcUaFieldConfig> = {}): OpcUaFieldConfig => ({
  fieldPath: 'FIELD1',
  displayName: 'Field 1',
  permissions: perm,
  ...overrides,
})

// Build the uppercase-path → DebugLeafInfo Map the resolver consumes.
// Same shape buildLeafInfoMap produces from a real debug-map.json, so
// tests exercise the production lookup path verbatim. type/size default
// to INT/2; pass them explicitly to exercise canonical-type emission or
// the empty-type fallback.
const pmap = (
  ...entries: Array<[path: string, arr: number, elem: number, type?: string, size?: number]>
): Map<string, DebugLeafInfo> => {
  const out = new Map<string, DebugLeafInfo>()
  for (const [path, arr, elem, type = 'INT', size = 2] of entries) {
    out.set(path.toUpperCase(), { arr, elem, type, size })
  }
  return out
}

const inst = (name: string, program: string): PLCInstanceInfo => ({ name, task: 'T0', program })

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

describe('resolveVariableAddress', () => {
  it('resolves a global variable (GVL)', () => {
    const node = makeNode({ pouName: 'GVL', variablePath: 'SPEED' })
    expect(resolveVariableAddress(node, pmap(['SPEED', 0, 5]), [])).toMatchObject({ arr: 0, elem: 5 })
  })

  it('returns the canonical type and size from the debug map (not the stored type)', () => {
    // node.variableType is INT, but the compiler says LREAL/8 — the
    // canonical map wins so the runtime encodes the right width.
    const node = makeNode({ pouName: 'GVL', variablePath: 'TEMP', variableType: 'INT' })
    expect(resolveVariableAddress(node, pmap(['TEMP', 2, 9, 'LREAL', 8]), [])).toEqual({
      arr: 2,
      elem: 9,
      type: 'LREAL',
      size: 8,
    })
  })

  it('resolves a global variable (CONFIG)', () => {
    const node = makeNode({ pouName: 'CONFIG', variablePath: 'TEMP' })
    expect(resolveVariableAddress(node, pmap(['TEMP', 1, 12]), [])).toMatchObject({ arr: 1, elem: 12 })
  })

  it('matches case-insensitively', () => {
    const node = makeNode({ pouName: 'gvl', variablePath: 'b' })
    expect(resolveVariableAddress(node, pmap(['B', 0, 7]), [])).toMatchObject({ arr: 0, elem: 7 })
  })

  it('throws when global variable not found', () => {
    const node = makeNode({ pouName: 'GVL', variablePath: 'MISSING' })
    expect(() => resolveVariableAddress(node, pmap(), [])).toThrow(OpcUaConfigError)
  })

  it('resolves an instance variable', () => {
    const node = makeNode({ pouName: 'MAIN', variablePath: 'MOTOR_SPEED' })
    expect(
      resolveVariableAddress(node, pmap(['INSTANCE0.MOTOR_SPEED', 0, 11]), [inst('INSTANCE0', 'MAIN')]),
    ).toMatchObject({
      arr: 0,
      elem: 11,
    })
  })

  it('resolves a nested-path instance variable (struct/FB field)', () => {
    const node = makeNode({ pouName: 'MAIN', variablePath: 'SENSOR.VALUE' })
    expect(
      resolveVariableAddress(node, pmap(['INSTANCE0.SENSOR.VALUE', 0, 25]), [inst('INSTANCE0', 'MAIN')]),
    ).toMatchObject({
      arr: 0,
      elem: 25,
    })
  })

  it('preserves array brackets in path segments', () => {
    const node = makeNode({ pouName: 'MAIN', variablePath: 'PROFILES[3]' })
    expect(
      resolveVariableAddress(node, pmap(['INSTANCE0.PROFILES[3]', 0, 30]), [inst('INSTANCE0', 'MAIN')]),
    ).toMatchObject({
      arr: 0,
      elem: 30,
    })
  })

  it('throws when instance not found in resources', () => {
    const node = makeNode({ pouName: 'UNKNOWN' })
    expect(() => resolveVariableAddress(node, pmap(), [])).toThrow('Cannot find instance for program')
  })

  it('throws when instance variable path does not match a leaf', () => {
    const node = makeNode({ pouName: 'MAIN', variablePath: 'GHOST' })
    expect(() => resolveVariableAddress(node, pmap(), [inst('INSTANCE0', 'MAIN')])).toThrow(
      'Cannot resolve OPC-UA variable address',
    )
  })
})

describe('resolveStructureAddresses', () => {
  it('falls back to single-variable resolve when no fields are configured', () => {
    const node = makeNode({ nodeType: 'structure', variablePath: 'STRUCT' })
    const result = resolveStructureAddresses(node, pmap(['INSTANCE0.STRUCT', 0, 9]), [inst('INSTANCE0', 'MAIN')])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'STRUCT', datatype: 'INT', arr: 0, elem: 9, permissions: perm })
  })

  it('throws when instance not found and fields are present', () => {
    const node = makeNode({ nodeType: 'structure', pouName: 'UNK', variablePath: 'S', fields: [makeField()] })
    expect(() => resolveStructureAddresses(node, pmap(), [])).toThrow('Cannot find instance for program')
  })

  it('resolves leaf fields for a structure', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'X', datatype: 'INT' }), makeField({ fieldPath: 'Y', datatype: 'REAL' })],
    })
    const result = resolveStructureAddresses(
      node,
      pmap(['INSTANCE0.S.X', 0, 3, 'INT', 2], ['INSTANCE0.S.Y', 0, 4, 'REAL', 4]),
      [inst('INSTANCE0', 'MAIN')],
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'X', arr: 0, elem: 3, datatype: 'INT' })
    expect(result[1]).toMatchObject({ name: 'Y', arr: 0, elem: 4, datatype: 'REAL' })
  })

  it('emits canonical type and size on leaf fields (debug map wins over stored datatype)', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'X', datatype: 'INT' })],
    })
    const result = resolveStructureAddresses(node, pmap(['INSTANCE0.S.X', 0, 3, 'REAL', 4]), [
      inst('INSTANCE0', 'MAIN'),
    ])
    expect(result[0]).toMatchObject({ name: 'X', datatype: 'REAL', size: 4, arr: 0, elem: 3 })
  })

  it('resolves nested fields recursively (FB inside FB)', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'MY_FB',
      fields: [
        makeField({
          fieldPath: 'TON0',
          datatype: 'TON',
          fields: [makeField({ fieldPath: 'IN', datatype: 'BOOL' }), makeField({ fieldPath: 'ET', datatype: 'TIME' })],
        }),
      ],
    })
    const result = resolveStructureAddresses(
      node,
      pmap(['INSTANCE0.MY_FB.TON0.IN', 0, 10, 'BOOL', 1], ['INSTANCE0.MY_FB.TON0.ET', 0, 11, 'TIME', 8]),
      [inst('INSTANCE0', 'MAIN')],
    )
    expect(result).toHaveLength(1)
    expect(result[0].arr).toBeNull()
    expect(result[0].elem).toBeNull()
    expect(result[0].fields).toHaveLength(2)
    expect(result[0].fields![0]).toMatchObject({ name: 'IN', arr: 0, elem: 10, datatype: 'BOOL' })
    expect(result[0].fields![1]).toMatchObject({ name: 'ET', arr: 0, elem: 11, datatype: 'TIME' })
  })

  it('drops fields that cannot be resolved and reports them via droppedPaths', () => {
    // Mirrors how the build silently drops library-FB internals
    // (TON.STATE etc.) saved before the pou-helpers filter.
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'GHOST', datatype: 'INT' }), makeField({ fieldPath: 'OK', datatype: 'INT' })],
    })
    const dropped: string[] = []
    const result = resolveStructureAddresses(node, pmap(['INSTANCE0.S.OK', 0, 5]), [inst('INSTANCE0', 'MAIN')], dropped)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('OK')
    expect(dropped).toEqual(['MAIN:S.GHOST'])
  })

  it('drops a complex field whose every leaf is unresolvable', () => {
    // TON.STATE / PREV_IN / etc. case — parent FB has no resolvable
    // children left, so it gets dropped too rather than emitting an
    // empty struct.
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [
        makeField({
          fieldPath: 'TON0',
          datatype: 'TON',
          fields: [
            makeField({ fieldPath: 'STATE', datatype: 'SINT' }),
            makeField({ fieldPath: 'PREV_IN', datatype: 'BOOL' }),
          ],
        }),
      ],
    })
    const dropped: string[] = []
    const result = resolveStructureAddresses(node, pmap(), [inst('INSTANCE0', 'MAIN')], dropped)
    expect(result).toEqual([])
    expect(dropped).toEqual(['MAIN:S.TON0.STATE', 'MAIN:S.TON0.PREV_IN'])
  })

  it('uses field datatype when debug entry has empty type string', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'B', datatype: 'REAL' })],
    })
    const result = resolveStructureAddresses(node, pmap(['INSTANCE0.S.B', 0, 60, '']), [inst('INSTANCE0', 'MAIN')])
    expect(result[0].datatype).toBe('REAL')
  })

  it('defaults datatype to UNKNOWN when no field datatype and no debug type', () => {
    const node = makeNode({
      nodeType: 'structure',
      variablePath: 'S',
      fields: [makeField({ fieldPath: 'C' })],
    })
    const result = resolveStructureAddresses(node, pmap(['INSTANCE0.S.C', 0, 61, '']), [inst('INSTANCE0', 'MAIN')])
    expect(result[0].datatype).toBe('UNKNOWN')
  })

  it('resolves global structure fields via plain path', () => {
    const node = makeNode({
      nodeType: 'structure',
      pouName: 'GVL',
      variablePath: 'GLOBAL_STRUCT',
      fields: [makeField({ fieldPath: 'F', datatype: 'INT' })],
    })
    const result = resolveStructureAddresses(node, pmap(['GLOBAL_STRUCT.F', 0, 80]), [])
    expect(result[0]).toMatchObject({ name: 'F', arr: 0, elem: 80 })
  })
})

describe('resolveArrayAddress', () => {
  it('resolves the first element of an instance array', () => {
    const node = makeNode({ nodeType: 'array', variablePath: 'PROFILE', arrayLength: 5 })
    expect(
      resolveArrayAddress(node, pmap(['INSTANCE0.PROFILE[0]', 0, 100]), [inst('INSTANCE0', 'MAIN')]),
    ).toMatchObject({
      arr: 0,
      elem: 100,
    })
  })

  it('returns the canonical element type and size from the debug map', () => {
    const node = makeNode({ nodeType: 'array', pouName: 'GVL', variablePath: 'TBL', arrayLength: 3 })
    expect(resolveArrayAddress(node, pmap(['TBL[0]', 0, 5, 'DINT', 4]), [])).toEqual({
      arr: 0,
      elem: 5,
      type: 'DINT',
      size: 4,
    })
  })

  it('resolves the first element of a global array', () => {
    const node = makeNode({ nodeType: 'array', pouName: 'GVL', variablePath: 'TABLE', arrayLength: 4 })
    expect(resolveArrayAddress(node, pmap(['TABLE[0]', 1, 7]), [])).toMatchObject({ arr: 1, elem: 7 })
  })

  it('throws when instance not found', () => {
    const node = makeNode({ nodeType: 'array', pouName: 'NOPE', variablePath: 'A' })
    expect(() => resolveArrayAddress(node, pmap(), [])).toThrow('Cannot find instance for program')
  })

  it('throws when array first element not in debug map', () => {
    const node = makeNode({ nodeType: 'array', variablePath: 'GHOST_ARR' })
    expect(() => resolveArrayAddress(node, pmap(), [inst('INSTANCE0', 'MAIN')])).toThrow(
      'Cannot resolve OPC-UA array address',
    )
  })

  // IEC arrays use arbitrary lower bounds (`ARRAY[1..N]`, `ARRAY[-5..5]`).
  // STruC++ emits debug-map paths using the IEC index, not zero-based —
  // so the resolver finds the lowest-indexed element among the leaves
  // sharing the array's prefix, not a hardcoded `[0]`.
  it('resolves an array starting at IEC index 1 (ARRAY[1..N])', () => {
    const node = makeNode({ nodeType: 'array', variablePath: 'MY_ARRAY', arrayLength: 50 })
    const leaves = pmap(
      ['INSTANCE0.MY_ARRAY[1]', 0, 30],
      ['INSTANCE0.MY_ARRAY[2]', 0, 31],
      ['INSTANCE0.MY_ARRAY[3]', 0, 32],
    )
    expect(resolveArrayAddress(node, leaves, [inst('INSTANCE0', 'MAIN')])).toMatchObject({ arr: 0, elem: 30 })
  })

  it('resolves an array with negative lower bound (ARRAY[-2..2])', () => {
    const node = makeNode({ nodeType: 'array', variablePath: 'SIGNED_ARR', arrayLength: 5 })
    // Note the order is intentionally not sorted — resolver must pick min.
    const leaves = pmap(
      ['INSTANCE0.SIGNED_ARR[1]', 0, 13],
      ['INSTANCE0.SIGNED_ARR[-2]', 0, 10],
      ['INSTANCE0.SIGNED_ARR[2]', 0, 14],
      ['INSTANCE0.SIGNED_ARR[-1]', 0, 11],
      ['INSTANCE0.SIGNED_ARR[0]', 0, 12],
    )
    expect(resolveArrayAddress(node, leaves, [inst('INSTANCE0', 'MAIN')])).toMatchObject({ arr: 0, elem: 10 })
  })

  it('does not match sub-elements of an array of structs as the array base', () => {
    // For an ARRAY[1..3] OF SOME_STRUCT, leaves look like
    // FOO[1].FIELD — those are NOT the array's own leaf base.
    const node = makeNode({ nodeType: 'array', variablePath: 'STRUCT_ARR', arrayLength: 3 })
    const leaves = pmap(['INSTANCE0.STRUCT_ARR[1].A', 0, 50], ['INSTANCE0.STRUCT_ARR[1].B', 0, 51])
    expect(() => resolveArrayAddress(node, leaves, [inst('INSTANCE0', 'MAIN')])).toThrow(
      'Cannot resolve OPC-UA array address',
    )
  })
})
