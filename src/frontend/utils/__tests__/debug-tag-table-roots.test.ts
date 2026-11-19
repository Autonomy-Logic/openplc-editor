import type { PLCInstance, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { createTestStore } from '../../store/testing'
import type { DebugVariableEntry } from '../debug-parser'
import { buildTagRows, rootDebugNodes } from '../debug-tag-table'
import { buildDebugVariableTreeMap } from '../debugger-session'

const SYSTEM_LIBS = createTestStore().getState().libraries.system

const baseVariable = (name: string, baseType: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: baseType },
  location: '',
  documentation: '',
})

const derivedVariable = (name: string, typeName: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'derived', value: typeName },
  location: '',
  documentation: '',
})

const pou = (name: string, variables: PLCVariable[]): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables },
  body: { language: 'st', value: '' },
})

const instance = (name: string, program: string): PLCInstance => ({ name, task: 'Task0', program })

const debugVariable = (name: string, type: string, index: number): DebugVariableEntry => ({ name, type, index })

/** The real enumeration walk: its map holds every node, nested members included, plus the compiler temporaries. */
function realTreeMap() {
  const main = pou('Main', [derivedVariable('mySR', 'SR'), baseVariable('X', 'INT')])
  const entries: DebugVariableEntry[] = [
    debugVariable('INSTANCE0.MYSR.Q1', 'BOOL', 0),
    debugVariable('INSTANCE0.MYSR.S1', 'BOOL', 1),
    debugVariable('INSTANCE0.MYSR.R', 'BOOL', 2),
    debugVariable('INSTANCE0.X', 'INT', 3),
    debugVariable('INSTANCE0._TMP_ADD1_OUT', 'INT', 4),
  ]
  return buildDebugVariableTreeMap(
    [main],
    [instance('instance0', 'Main')],
    entries,
    { dataTypes: [], pous: [main] },
    SYSTEM_LIBS,
  )
}

describe('rootDebugNodes', () => {
  it('keeps only the nodes no other node holds as a child', () => {
    const { treeMap } = realTreeMap()

    const roots = rootDebugNodes(treeMap)

    expect(treeMap.size).toBeGreaterThan(roots.length)
    expect(roots.map((node) => node.name).sort()).toEqual(['X', 'mySR'].sort())
  })

  it('leaves the compiler temporaries out', () => {
    const { treeMap } = realTreeMap()

    expect(Array.from(treeMap.values()).some((node) => node.name.startsWith('_TMP_'))).toBe(true)
    expect(rootDebugNodes(treeMap).some((node) => node.name.startsWith('_TMP_'))).toBe(false)
  })

  it('lists each member once, and only under its parent', () => {
    const { treeMap } = realTreeMap()
    const roots = rootDebugNodes(treeMap)

    const collapsed = buildTagRows({ trees: roots, pous: [], globalVariables: [], views: [] })
    expect(collapsed.map((row) => row.name).sort()).toEqual(['X', 'mySR'].sort())

    const parentKey = roots.find((node) => node.name === 'mySR')?.compositeKey
    if (!parentKey) throw new Error('mySR is not a root of the tree')
    const expanded = buildTagRows({
      trees: roots,
      pous: [],
      globalVariables: [],
      views: [],
      expandedKeys: new Set([parentKey]),
    })

    const keys = expanded.map((row) => row.compositeKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(expanded.filter((row) => row.name === 'Q1')).toHaveLength(1)
    expect(expanded.find((row) => row.name === 'Q1')?.depth).toBe(1)
  })
})
