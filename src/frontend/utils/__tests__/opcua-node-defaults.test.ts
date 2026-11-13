import { describe, expect, it } from '@jest/globals'

import { buildDefaultNodeConfig, DEFAULT_NODE_PERMISSIONS, firstValidationFailure } from '../opcua/node-defaults'
import type { VariableTreeNode } from '../opcua/types'

const node = (over: Partial<VariableTreeNode> & { id: string; name: string }): VariableTreeNode => ({
  type: 'variable',
  pouName: 'main',
  variablePath: over.name,
  isSelectable: true,
  variableType: 'INT',
  ...over,
})

const ids = () => {
  let n = 0
  return () => `id-${++n}`
}

describe('DEFAULT_NODE_PERMISSIONS', () => {
  it('should give the viewer read, the operator read and the engineer read and write', () => {
    expect(DEFAULT_NODE_PERMISSIONS).toEqual({ viewer: 'r', operator: 'r', engineer: 'rw' })
  })
})

describe('buildDefaultNodeConfig', () => {
  it('should build the Node ID as PLC.<pou>.<path>', () => {
    const config = buildDefaultNodeConfig(node({ id: 'main-TANK_LEVEL', name: 'TANK_LEVEL' }), ids())

    expect(config.nodeId).toBe('PLC.main.TANK_LEVEL')
  })

  it('should build the Node ID of a global under the global scope', () => {
    const config = buildDefaultNodeConfig(
      node({ id: 'GVL-SETPOINT', name: 'SETPOINT', pouName: 'GVL', variablePath: 'SETPOINT' }),
      ids(),
    )

    expect(config.nodeId).toBe('PLC.GVL.SETPOINT')
  })

  it('should flatten array brackets in the Node ID', () => {
    const config = buildDefaultNodeConfig(node({ id: 'x', name: 'LEVELS', variablePath: 'LEVELS[2]' }), ids())

    expect(config.nodeId).toBe('PLC.main.LEVELS_2')
  })

  it('should take the last path segment as the browse name', () => {
    const config = buildDefaultNodeConfig(node({ id: 'x', name: 'Liga', variablePath: 'Man.Liga' }), ids())

    expect(config.browseName).toBe('Liga')
  })

  it('should title case a snake case name for the display name', () => {
    const config = buildDefaultNodeConfig(node({ id: 'x', name: 'TANK_LEVEL' }), ids())

    expect(config.displayName).toBe('Tank Level')
  })

  it('should split a camel case name for the display name', () => {
    const config = buildDefaultNodeConfig(node({ id: 'x', name: 'pumpRun', variablePath: 'pumpRun' }), ids())

    expect(config.displayName).toBe('Pump Run')
  })

  it('should apply the default permissions', () => {
    const config = buildDefaultNodeConfig(node({ id: 'x', name: 'A' }), ids())

    expect(config.permissions).toEqual(DEFAULT_NODE_PERMISSIONS)
  })

  it('should take its id from the injected generator', () => {
    const config = buildDefaultNodeConfig(node({ id: 'x', name: 'A' }), () => 'fixed-id')

    expect(config.id).toBe('fixed-id')
  })

  it('should carry an empty description', () => {
    expect(buildDefaultNodeConfig(node({ id: 'x', name: 'A' }), ids()).description).toBe('')
  })

  it('should classify a scalar as a variable node', () => {
    expect(buildDefaultNodeConfig(node({ id: 'x', name: 'A' }), ids()).nodeType).toBe('variable')
  })

  it('should classify a function block as a structure node', () => {
    const fb = node({ id: 'x', name: 'Man', type: 'function_block', variableType: 'MotorFB' })

    expect(buildDefaultNodeConfig(fb, ids()).nodeType).toBe('structure')
  })

  it('should classify an array as an array node', () => {
    const array = node({
      id: 'x',
      name: 'LEVELS',
      type: 'array',
      arrayInfo: { dimensions: ['1..8'], elementType: 'INT', totalLength: 8 },
    })

    const config = buildDefaultNodeConfig(array, ids())

    expect(config.nodeType).toBe('array')
    expect(config.arrayLength).toBe(8)
    expect(config.elementType).toBe('INT')
  })

  it('should give a function block one field per member, with the parent permissions', () => {
    const fb = node({
      id: 'x',
      name: 'Man',
      type: 'function_block',
      variableType: 'MotorFB',
      children: [
        node({ id: 'x.Liga', name: 'Liga', variableType: 'BOOL' }),
        node({ id: 'x.Desliga', name: 'Desliga', variableType: 'BOOL' }),
      ],
    })

    const config = buildDefaultNodeConfig(fb, ids())

    expect(config.fields?.map((f) => f.fieldPath)).toEqual(['Liga', 'Desliga'])
    expect(config.fields?.[0].permissions).toEqual(DEFAULT_NODE_PERMISSIONS)
  })

  it('should nest the fields of a member that is itself complex', () => {
    const outer = node({
      id: 'x',
      name: 'RECIPE',
      type: 'structure',
      variableType: 'RecipeT',
      children: [
        node({
          id: 'x.Inner',
          name: 'Inner',
          type: 'structure',
          variableType: 'InnerT',
          children: [node({ id: 'x.Inner.Temp', name: 'Temp', variableType: 'REAL' })],
        }),
      ],
    })

    const config = buildDefaultNodeConfig(outer, ids())

    expect(config.fields?.[0].fields?.map((f) => f.fieldPath)).toEqual(['Temp'])
  })

  it('should give a scalar no fields', () => {
    expect(buildDefaultNodeConfig(node({ id: 'x', name: 'A' }), ids()).fields).toBeUndefined()
  })

  it('should carry the pou name and the variable path of the entry', () => {
    const config = buildDefaultNodeConfig(node({ id: 'x', name: 'Liga', variablePath: 'Man.Liga' }), ids())

    expect(config.pouName).toBe('main')
    expect(config.variablePath).toBe('Man.Liga')
  })
})

describe('firstValidationFailure', () => {
  const valid = buildDefaultNodeConfig(node({ id: 'x', name: 'A' }), ids())

  it('should pass a configuration nothing is wrong with', () => {
    expect(firstValidationFailure(valid, new Set())).toBeNull()
  })

  it('should pass a Node ID of exactly 128 characters', () => {
    const config = { ...valid, nodeId: 'a'.repeat(128) }

    expect(firstValidationFailure(config, new Set())).toBeNull()
  })

  it('should refuse a Node ID of 129 characters', () => {
    const config = { ...valid, nodeId: 'a'.repeat(129) }

    expect(firstValidationFailure(config, new Set())).toBe('node-id-too-long')
  })

  it('should refuse a Node ID already taken', () => {
    expect(firstValidationFailure(valid, new Set([valid.nodeId.toLowerCase()]))).toBe('node-id-exists')
  })

  it('should compare a taken Node ID ignoring case', () => {
    expect(firstValidationFailure(valid, new Set(['plc.main.a']))).toBe('node-id-exists')
  })

  it('should pass a browse name of exactly 64 characters', () => {
    const config = { ...valid, browseName: 'b'.repeat(64) }

    expect(firstValidationFailure(config, new Set())).toBeNull()
  })

  it('should refuse a browse name of 65 characters', () => {
    const config = { ...valid, browseName: 'b'.repeat(65) }

    expect(firstValidationFailure(config, new Set())).toBe('browse-name-too-long')
  })

  it('should report a too long Node ID before a taken one', () => {
    const nodeId = 'a'.repeat(129)
    const config = { ...valid, nodeId }

    expect(firstValidationFailure(config, new Set([nodeId.toLowerCase()]))).toBe('node-id-too-long')
  })

  it('should report a taken Node ID before a too long browse name', () => {
    const config = { ...valid, browseName: 'b'.repeat(65) }

    expect(firstValidationFailure(config, new Set([config.nodeId.toLowerCase()]))).toBe('node-id-exists')
  })
})
