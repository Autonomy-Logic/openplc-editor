import { describe, expect, it } from '@jest/globals'

import type { OpcUaNodeConfig, PLCInstance } from '../../../middleware/shared/ports/types'
import { planBulkAdd } from '../opcua/bulk-selection'
import { buildDefaultNodeConfig } from '../opcua/node-defaults'
import { GLOBAL_SCOPE_POU } from '../opcua/resolve-indices'
import { indexTree } from '../opcua/tree-index'
import type { VariableTreeNode } from '../opcua/types'

const entry = (
  pouName: string,
  name: string,
  over: Partial<VariableTreeNode> = {},
  children?: VariableTreeNode[],
): VariableTreeNode => ({
  id: `${pouName}-${name}`,
  name,
  type: children ? 'function_block' : 'variable',
  variableType: children ? 'MotorFB' : 'BOOL',
  pouName,
  variablePath: name,
  isSelectable: true,
  children,
  ...over,
})

const member = (pouName: string, parent: string, name: string): VariableTreeNode => ({
  id: `${pouName}-${parent}.${name}`,
  name,
  type: 'variable',
  variableType: 'BOOL',
  pouName,
  variablePath: `${parent}.${name}`,
  isSelectable: true,
})

const group = (pouName: string, name: string, children: VariableTreeNode[]): VariableTreeNode => ({
  id: `${pouName}-group`,
  name,
  type: pouName === GLOBAL_SCOPE_POU ? 'global' : 'program',
  pouName,
  variablePath: '',
  isSelectable: false,
  children,
})

/** The Tank fixture of the scenarios: 10 entries, one of them under a program with no instance. */
const tank = (): VariableTreeNode[] => [
  group(GLOBAL_SCOPE_POU, 'GVL', [entry(GLOBAL_SCOPE_POU, 'SETPOINT')]),
  group('main', 'main', [
    entry('main', 'TANK_LEVEL'),
    entry('main', 'TANK_ALARM'),
    entry('main', 'PUMP_RUN'),
    entry('main', 'Man', {}, [member('main', 'Man', 'Liga'), member('main', 'Man', 'Desliga')]),
    entry('main', 'TMR1', {}, [member('main', 'TMR1', 'PT')]),
    entry('main', 'CNT1', {}, [member('main', 'CNT1', 'PV')]),
    entry('main', 'RECIPE', { type: 'structure' }, [member('main', 'RECIPE', 'Temp')]),
    entry(GLOBAL_SCOPE_POU, 'SETPOINT'),
  ]),
  group('aux', 'aux', [entry('aux', 'FLOW'), entry(GLOBAL_SCOPE_POU, 'SETPOINT')]),
  group('orphan', 'orphan', [entry('orphan', 'ORPHAN_VAR')]),
]

const instances: PLCInstance[] = [
  { name: 'instance0', task: 'task0', program: 'main' },
  { name: 'instance1', task: 'task0', program: 'aux' },
]

let nextId = 0
const createId = () => `id-${++nextId}`

const plan = (over: Partial<Parameters<typeof planBulkAdd>[0]> = {}) => {
  nextId = 0
  const tree = tank()
  return planBulkAdd({
    tree,
    index: indexTree(tree),
    filter: '',
    existingNodes: [],
    instances,
    createId,
    ...over,
  })
}

const nodeIds = (nodes: OpcUaNodeConfig[]) => nodes.map((node) => node.nodeId).sort()

describe('planning a bulk add (TC41, TC43 to TC47)', () => {
  it('should expose every top-level entry the filter leaves visible (TC41)', () => {
    const result = plan()

    expect(nodeIds(result.nodes)).toEqual(
      [
        'PLC.GVL.SETPOINT',
        'PLC.main.TANK_LEVEL',
        'PLC.main.TANK_ALARM',
        'PLC.main.PUMP_RUN',
        'PLC.main.Man',
        'PLC.main.TMR1',
        'PLC.main.CNT1',
        'PLC.main.RECIPE',
        'PLC.aux.FLOW',
      ].sort(),
    )
  })

  it('should give every node the default permissions (TC41)', () => {
    const result = plan()

    for (const node of result.nodes) {
      expect(node.permissions).toEqual({ viewer: 'r', operator: 'r', engineer: 'rw' })
    }
  })

  it('should skip and report an entry whose program has no instance (TC41)', () => {
    const result = plan()

    expect(result.nodes.some((node) => node.variablePath === 'ORPHAN_VAR')).toBe(false)
    expect(result.skipped['no-instance']).toBe(1)
  })

  it('should report nothing else on the plain Select all (TC41)', () => {
    const result = plan()

    expect(result.skipped).toEqual({ 'no-instance': 1 })
  })

  it('should expose only what the filter shows, and report nothing (TC43)', () => {
    const result = plan({ filter: 'TANK' })

    expect(nodeIds(result.nodes)).toEqual(['PLC.main.TANK_ALARM', 'PLC.main.TANK_LEVEL'])
    expect(result.skipped).toEqual({})
  })

  it('should leave an entry that is already exposed alone, without reporting it (TC44)', () => {
    const existing: OpcUaNodeConfig[] = [
      {
        ...buildDefaultNodeConfig(entry('main', 'TANK_LEVEL'), () => 'kept'),
        nodeId: 'PLC.main.TankLevelCustom',
        displayName: 'Level',
        permissions: { viewer: 'r', operator: 'r', engineer: 'r' },
      },
    ]

    const result = plan({ existingNodes: existing })

    expect(result.nodes.some((node) => node.variablePath === 'TANK_LEVEL')).toBe(false)
    expect(result.skipped).toEqual({ 'no-instance': 1 })
  })

  it('should skip an instance one of whose members has its own node (TC45)', () => {
    const existing: OpcUaNodeConfig[] = [buildDefaultNodeConfig(member('main', 'Man', 'Liga'), () => 'own-member')]

    const result = plan({ existingNodes: existing })

    expect(result.nodes.some((node) => node.variablePath === 'Man')).toBe(false)
    expect(result.skipped['member-has-node']).toBe(1)
    expect(result.nodes).toHaveLength(8)
  })

  it('should give a global reached through several paths a single node (TC46)', () => {
    const result = plan()

    expect(result.nodes.filter((node) => node.variablePath === 'SETPOINT')).toHaveLength(1)
    expect(result.nodes.find((node) => node.variablePath === 'SETPOINT')?.nodeId).toBe('PLC.GVL.SETPOINT')
  })

  it('should skip and report an instance the filter only partly matches (BR10)', () => {
    const result = plan({ filter: 'Desliga' })

    expect(result.nodes).toHaveLength(0)
    expect(result.skipped).toEqual({ 'filter-hides-part': 1 })
  })

  it('should expose an instance the filter hides nothing of (BR10)', () => {
    const result = plan({ filter: 'Man' })

    expect(nodeIds(result.nodes)).toEqual(['PLC.main.Man'])
    expect(result.skipped).toEqual({})
  })

  it('should skip and report an entry whose default Node ID is too long (TC47)', () => {
    const tree = tank()
    const longName = 'X'.repeat(140)
    tree[1].children?.push(entry('main', longName))

    const result = planBulkAdd({
      tree,
      index: indexTree(tree),
      filter: '',
      existingNodes: [],
      instances,
      createId,
    })

    expect(result.nodes.some((node) => node.variablePath === longName)).toBe(false)
    expect(result.skipped['node-id-too-long']).toBe(1)
  })

  it('should never shorten a Node ID or a Browse Name (TC47)', () => {
    const result = plan()

    for (const node of result.nodes) {
      expect(node.nodeId.endsWith('...')).toBe(false)
      expect(node.browseName.endsWith('...')).toBe(false)
    }
  })

  it('should count an entry failing several checks once, under the first (TC47)', () => {
    const tree = tank()
    const longName = 'Y'.repeat(140)
    tree[1].children?.push(entry('main', longName))
    const existing: OpcUaNodeConfig[] = [
      { ...buildDefaultNodeConfig(entry('main', 'spare'), () => 'taken'), nodeId: `PLC.main.${longName}` },
    ]

    const result = planBulkAdd({
      tree,
      index: indexTree(tree),
      filter: '',
      existingNodes: existing,
      instances,
      createId,
    })

    expect(result.skipped['node-id-too-long']).toBe(1)
    expect(result.skipped['node-id-exists']).toBeUndefined()
  })

  it('should plan nothing when every entry is already exposed', () => {
    const first = plan()

    const second = plan({ existingNodes: first.nodes })

    expect(second.nodes).toHaveLength(0)
    expect(second.skipped).toEqual({ 'no-instance': 1 })
  })

  it('should plan nothing for an empty tree', () => {
    const result = planBulkAdd({
      tree: [],
      index: indexTree([]),
      filter: '',
      existingNodes: [],
      instances,
      createId,
    })

    expect(result.nodes).toHaveLength(0)
    expect(result.skipped).toEqual({})
  })
})

describe('planning a group tick (TC50, TC51)', () => {
  it('should expose only the entries of the group it is given', () => {
    const tree = tank()
    const mainGroup = tree[1]

    const result = planBulkAdd({
      tree: [mainGroup],
      index: indexTree(tree),
      filter: '',
      existingNodes: [],
      instances,
      createId,
    })

    expect(result.nodes).toHaveLength(8)
    expect(result.nodes.some((node) => node.variablePath === 'FLOW')).toBe(false)
  })

  it('should expose only the visible children of the group while a filter is typed (TC51)', () => {
    const tree = tank()
    const mainGroup = tree[1]

    const result = planBulkAdd({
      tree: [mainGroup],
      index: indexTree(tree),
      filter: 'TANK',
      existingNodes: [],
      instances,
      createId,
    })

    expect(nodeIds(result.nodes)).toEqual(['PLC.main.TANK_ALARM', 'PLC.main.TANK_LEVEL'])
  })
})
