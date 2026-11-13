/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import type { PLCPou, PLCProjectData, PLCVariable } from '../../../../middleware/shared/ports/types'
import { countPythonBlockInstances } from '../count-python-block-instances'

const variable = (name: string, type: PLCVariable['type']): PLCVariable => ({
  name,
  class: 'local',
  type,
  location: '',
  documentation: '',
  debug: false,
})

const instance = (name: string, block: string): PLCVariable => variable(name, { definition: 'derived', value: block })

const pou = (name: string, pouType: PLCPou['pouType'], language: string, variables: PLCVariable[] = []): PLCPou =>
  ({
    name,
    pouType,
    interface: { variables },
    body: { language, value: '' },
    documentation: '',
  }) as PLCPou

const project = (
  pous: PLCPou[],
  instances: Array<{ name: string; program: string }>,
  globals: PLCVariable[] = [],
): PLCProjectData => ({
  dataTypes: [],
  pous,
  configurations: {
    resource: {
      tasks: [],
      instances: instances.map((entry) => ({ ...entry, task: 'task0' })),
      globalVariables: globals,
    },
  },
})

describe('countPythonBlockInstances', () => {
  it('counts the Python blocks each program instance holds, through the blocks that hold them', () => {
    const data = project(
      [
        pou('PyStats', 'function-block', 'python'),
        pou('Wrapper', 'function-block', 'st', [instance('inner', 'PyStats'), instance('timer', 'TON')]),
        pou('main', 'program', 'st', [instance('direct', 'pystats'), instance('wrapped', 'Wrapper')]),
      ],
      [
        { name: 'instance0', program: 'main' },
        { name: 'instance1', program: 'MAIN' },
      ],
    )
    expect(countPythonBlockInstances(data)).toBe(4)
  })

  it('counts arrays of blocks and globals', () => {
    const array = variable('many', {
      definition: 'array',
      value: 'ARRAY [1..3] OF PyStats',
      data: { baseType: { definition: 'user-data-type', value: 'PyStats' }, dimensions: [{ dimension: '1..3' }] },
    })
    const data = project(
      [pou('PyStats', 'function-block', 'python'), pou('main', 'program', 'st', [array])],
      [{ name: 'instance0', program: 'main' }],
      [instance('shared', 'PyStats')],
    )
    data.globalVariableLists = [{ name: 'GVL', variables: [instance('other', 'PyStats')] }]
    expect(countPythonBlockInstances(data)).toBe(5)
  })

  it('counts nothing for programs that are not instantiated, unknown types, or a block that holds itself', () => {
    const data = project(
      [
        pou('PyStats', 'function-block', 'python'),
        pou('Loop', 'function-block', 'st', [instance('self', 'Loop'), instance('py', 'PyStats')]),
        pou('unused', 'program', 'st', [instance('py', 'PyStats')]),
        pou('main', 'program', 'st', [
          instance('missing', 'NotAType'),
          instance('loop', 'Loop'),
          variable('n', { definition: 'base-type', value: 'int' }),
        ]),
      ],
      [
        { name: 'instance0', program: 'main' },
        { name: 'ghost', program: 'nowhere' },
      ],
    )
    expect(countPythonBlockInstances(data)).toBe(1)
  })
})
