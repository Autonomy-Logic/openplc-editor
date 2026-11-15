import type { PLCVariable } from '../../../ports/types'
import { hmiPlcVariables } from '../plc-variables'

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
      { path: 'Alarm', type: 'BOOL', initialValue: 'TRUE' },
      { path: 'GVL.Output1', type: 'BOOL' },
    ])
  })
})
