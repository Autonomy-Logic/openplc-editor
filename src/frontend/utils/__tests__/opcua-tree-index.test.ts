import { describe, expect, it } from '@jest/globals'

import { GLOBAL_SCOPE_POU } from '../opcua/resolve-indices'
import { countTopLevelEntries, indexTree, isHiddenByFilter, treeIdForNode, visibleChildren } from '../opcua/tree-index'
import type { VariableTreeNode } from '../opcua/types'

const node = (over: Partial<VariableTreeNode> & { id: string; name: string }): VariableTreeNode => ({
  type: 'variable',
  pouName: 'main',
  variablePath: over.name,
  isSelectable: true,
  ...over,
})

const tree: VariableTreeNode[] = [
  node({
    id: 'main',
    name: 'main',
    type: 'program',
    isSelectable: false,
    children: [
      node({ id: 'main-TANK_LEVEL', name: 'TANK_LEVEL' }),
      node({ id: 'main-TANK_ALARM', name: 'TANK_ALARM' }),
      node({
        id: 'main-Man',
        name: 'Man',
        type: 'function_block',
        children: [node({ id: 'main-Man.Liga', name: 'Liga' }), node({ id: 'main-Man.Desliga', name: 'Desliga' })],
      }),
    ],
  }),
  node({
    id: 'GVL',
    name: 'Global Variables',
    type: 'global',
    isSelectable: false,
    children: [node({ id: 'GVL-SETPOINT', name: 'SETPOINT', pouName: 'GVL' })],
  }),
]

describe('indexTree', () => {
  it('should hold every node of the tree', () => {
    expect(indexTree(tree).size).toBe(8)
  })

  it('should find a node by its id', () => {
    expect(indexTree(tree).get('main-Man.Liga')?.name).toBe('Liga')
  })

  it('should answer undefined for an id the tree does not hold', () => {
    expect(indexTree(tree).get('main-NOPE')).toBeUndefined()
  })

  it('should hold an empty tree', () => {
    expect(indexTree([]).size).toBe(0)
  })
})

describe('treeIdForNode', () => {
  const index = indexTree(tree)

  it('should keep the id a stored node already carries', () => {
    expect(treeIdForNode({ pouName: 'main', variablePath: 'TANK_LEVEL' }, index)).toBe('main-TANK_LEVEL')
  })

  it('should widen a VAR_EXTERNAL saved under its program to the global scope', () => {
    expect(treeIdForNode({ pouName: 'main', variablePath: 'SETPOINT' }, index)).toBe('GVL-SETPOINT')
  })

  it('should not widen a program variable that merely shares a name with a global', () => {
    const withOwn = indexTree([
      ...tree,
      node({ id: 'aux-SETPOINT', name: 'SETPOINT', pouName: 'aux', variablePath: 'SETPOINT' }),
    ])

    expect(treeIdForNode({ pouName: 'aux', variablePath: 'SETPOINT' }, withOwn)).toBe('aux-SETPOINT')
  })

  it('should answer the own id when neither spelling is in the tree', () => {
    expect(treeIdForNode({ pouName: 'gone', variablePath: 'X' }, index)).toBe('gone-X')
  })
})

describe('isHiddenByFilter', () => {
  it('should hide nothing when no filter is typed', () => {
    expect(isHiddenByFilter(tree[0].children![0], '')).toBe(false)
  })

  it('should show an entry whose own name matches, ignoring case', () => {
    expect(isHiddenByFilter(tree[0].children![0], 'tank')).toBe(false)
  })

  it('should match any part of the name', () => {
    expect(isHiddenByFilter(tree[0].children![2].children![1], 'liga')).toBe(false)
  })

  it('should hide an entry that matches nowhere', () => {
    expect(isHiddenByFilter(tree[0].children![0], 'zzz')).toBe(true)
  })

  it('should show a parent whose own name does not match but whose child does', () => {
    expect(isHiddenByFilter(tree[0].children![2], 'Desliga')).toBe(false)
  })

  it('should show a group row whose own name matches even with no child shown', () => {
    expect(isHiddenByFilter(tree[0], 'main')).toBe(false)
  })
})

describe('visibleChildren', () => {
  it('should answer every child when no filter is typed', () => {
    expect(visibleChildren(tree[0], '').map((c) => c.name)).toEqual(['TANK_LEVEL', 'TANK_ALARM', 'Man'])
  })

  it('should answer only the children the filter shows', () => {
    expect(visibleChildren(tree[0], 'TANK').map((c) => c.name)).toEqual(['TANK_LEVEL', 'TANK_ALARM'])
  })

  it('should answer a parent kept by a matching member', () => {
    expect(visibleChildren(tree[0], 'Desliga').map((c) => c.name)).toEqual(['Man'])
  })

  it('should answer nothing when a group row matches but no child does', () => {
    expect(visibleChildren(tree[0], 'main')).toEqual([])
  })

  it('should answer nothing for a node with no children', () => {
    expect(visibleChildren(tree[0].children![0], '')).toEqual([])
  })
})

describe('top-level entry counts (BR09)', () => {
  const entry = (pouName: string, name: string, children?: VariableTreeNode[]): VariableTreeNode => ({
    id: `${pouName}-${name}`,
    name,
    type: children ? 'function_block' : 'variable',
    pouName,
    variablePath: name,
    isSelectable: true,
    children,
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

  /** The Tank fixture: 7 own entries of main, SETPOINT once, FLOW and ORPHAN_VAR. */
  const tank = (): VariableTreeNode[] => [
    group(GLOBAL_SCOPE_POU, 'GVL', [entry(GLOBAL_SCOPE_POU, 'SETPOINT')]),
    group('main', 'main', [
      entry('main', 'TANK_LEVEL'),
      entry('main', 'TANK_ALARM'),
      entry('main', 'PUMP_RUN'),
      entry('main', 'Man', [entry('main', 'Liga'), entry('main', 'Desliga')]),
      entry('main', 'TMR1'),
      entry('main', 'CNT1'),
      entry('main', 'RECIPE'),
      entry('main', 'SETPOINT'),
    ]),
    group('aux', 'aux', [entry('aux', 'FLOW'), entry('aux', 'SETPOINT')]),
    group('orphan', 'orphan', [entry('orphan', 'ORPHAN_VAR')]),
  ]

  const counts = (filter: string) => {
    const tree = tank()
    return countTopLevelEntries(tree, indexTree(tree), filter)
  }

  it('should count every distinct top-level entry with no filter', () => {
    expect(counts('')).toEqual({ total: 10, shown: 10 })
  })

  it('should count a VAR_EXTERNAL once, under the global scope', () => {
    const tree = tank()
    const index = indexTree(tree)

    expect(countTopLevelEntries(tree, index, '').total).toBe(10)
    expect(countTopLevelEntries([tree[0]], index, '').total).toBe(1)
  })

  it('should not count a group row as an entry', () => {
    expect(counts('main').shown).toBe(0)
  })

  it.each([
    ['TANK', 2],
    ['Desliga', 1],
    ['Man', 1],
    ['Liga', 1],
  ])('should show %s entries for the filter %s', (filter, shown) => {
    expect(counts(filter)).toEqual({ total: 10, shown })
  })

  it('should keep the total while a filter narrows what is shown', () => {
    expect(counts('TANK').total).toBe(10)
  })

  it('should count nothing in an empty tree', () => {
    expect(countTopLevelEntries([], indexTree([]), '')).toEqual({ total: 0, shown: 0 })
  })
})
