import type { PLCVariable } from '../../../ports/types'
import { filterHmiVariableTree, HMI_GLOBALS_NODE, hmiPlcVariables, hmiVariableTree } from '../plc-variables'

const v = (name: string, value: string, extra: Partial<PLCVariable> = {}): PLCVariable => ({
  name,
  type: { definition: 'base-type', value },
  location: '',
  documentation: '',
  ...extra,
})

describe('hmiPlcVariables', () => {
  it("lists each program instance's variables, the globals and list members with elementary types", () => {
    const variables = hmiPlcVariables({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          body: { language: 'st', value: '' },
          interface: {
            variables: [
              v('Level', 'real', { initialValue: ' 12.5 ' }),
              v('Scratch', 'int', { class: 'temp' }),
              v('Motor', 'TON', { type: { definition: 'derived', value: 'TON' } }),
              v('Name', 'string', { class: 'local', initialValue: '' }),
            ],
          },
        },
        {
          name: 'Helper',
          pouType: 'function-block',
          body: { language: 'st', value: '' },
          interface: { variables: [v('X', 'int')] },
        },
      ],
      configurations: {
        resource: {
          tasks: [],
          instances: [
            { name: 'instance0', task: 'task0', program: 'main' },
            { name: 'spare', task: 'task0', program: 'Main' },
            { name: 'ghost', task: 'task0', program: 'Missing' },
          ],
          globalVariables: [v('Alarm', 'bool', { initialValue: 'TRUE' })],
        },
      },
      globalVariableLists: [
        {
          name: 'GVL',
          variables: [v('Output1', 'bool'), v('Axis', 'AXIS', { type: { definition: 'derived', value: 'AXIS' } })],
        },
      ],
    })
    expect(variables).toEqual([
      { path: 'instance0.Main.Level', type: 'REAL', initialValue: '12.5' },
      { path: 'instance0.Main.Name', type: 'STRING' },
      { path: 'spare.Main.Level', type: 'REAL', initialValue: '12.5' },
      { path: 'spare.Main.Name', type: 'STRING' },
      { path: 'Alarm', type: 'BOOL', initialValue: 'TRUE', scope: 'global' },
      { path: 'GVL.Output1', type: 'BOOL' },
    ])
  })

  it('marks a CONSTANT, so screens read it and never write it', () => {
    const variables = hmiPlcVariables({
      pous: [],
      configurations: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [
            v('MaxL', 'int', { class: 'global', flag: 'constant', initialValue: '10' }),
            v('Run', 'bool'),
          ],
        },
      },
    })
    expect(variables).toEqual([
      { path: 'MaxL', type: 'INT', initialValue: '10', constant: true, scope: 'global' },
      { path: 'Run', type: 'BOOL', scope: 'global' },
    ])
  })
})

describe('hmiVariableTree', () => {
  const VARS = [
    { path: 'instance0.Main.Level', type: 'REAL' },
    { path: 'instance0.Main.Run', type: 'BOOL' },
    { path: 'AlarmOn', type: 'BOOL' },
    { path: 'Plant.Pressure', type: 'REAL' },
    { path: 'instance1.Aux.Count', type: 'INT' },
  ]
  const shape = (nodes: ReturnType<typeof hmiVariableTree>): unknown =>
    nodes.map((n) => (n.variable ? n.label : [n.label, shape(n.children)]))

  it('nests the variables by their dotted paths, with the configuration globals under one branch', () => {
    const tree = hmiVariableTree(VARS)
    expect(shape(tree)).toEqual([
      ['instance0', [['Main', ['Level', 'Run']]]],
      ['Globals', ['AlarmOn']],
      ['Plant', ['Pressure']],
      ['instance1', [['Aux', ['Count']]]],
    ])
    expect(tree[1].key).toBe(HMI_GLOBALS_NODE)
    expect(tree[0].children[0].key).toBe('instance0.Main')
    expect(tree[0].children[0].children[0]).toMatchObject({ key: 'instance0.Main.Level', variable: VARS[0] })
  })

  it('nests block pins, struct fields and array elements under their variable', () => {
    const tree = hmiVariableTree([
      { path: 'instance0.Main.T1.Q', type: 'BOOL' },
      { path: 'instance0.Main.Arr[0]', type: 'INT' },
      { path: 'instance0.Main.Ps[1].X', type: 'REAL' },
      { path: 'G.X', type: 'REAL' },
    ])
    expect(shape(tree)).toEqual([
      [
        'instance0',
        [
          [
            'Main',
            [
              ['T1', ['Q']],
              ['Arr', ['[0]']],
              ['Ps', [['[1]', ['X']]]],
            ],
          ],
        ],
      ],
      ['G', ['X']],
    ])
    const ps = tree[0].children[0].children[2]
    expect(ps.key).toBe('instance0.Main.Ps')
    expect(ps.children[0].key).toBe('instance0.Main.Ps[1]')
    expect(ps.children[0].children[0].variable?.path).toBe('instance0.Main.Ps[1].X')
  })

  it('puts configuration globals and what is below them under Globals', () => {
    const tree = hmiVariableTree([
      { path: 'G.Inner.Z', type: 'BOOL', scope: 'global' },
      { path: 'AlarmOn', type: 'BOOL', scope: 'global' },
      { path: 'Plant.Pressure', type: 'REAL' },
    ])
    expect(shape(tree)).toEqual([
      ['Globals', [['G', [['Inner', ['Z']]]], 'AlarmOn']],
      ['Plant', ['Pressure']],
    ])
  })

  it('keeps only the matching variables and the branches leading to them', () => {
    expect(shape(filterHmiVariableTree(hmiVariableTree(VARS), 'lev'))).toEqual([['instance0', [['Main', ['Level']]]]])
    expect(shape(filterHmiVariableTree(hmiVariableTree(VARS), 'alarm'))).toEqual([['Globals', ['AlarmOn']]])
    expect(filterHmiVariableTree(hmiVariableTree(VARS), 'nothing')).toEqual([])
  })
})
