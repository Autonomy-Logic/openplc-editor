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
  it("lists programs' variables and the globals with elementary types, and their initial values", () => {
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
        resource: { tasks: [], instances: [], globalVariables: [v('Alarm', 'bool', { initialValue: 'TRUE' })] },
      },
    })
    expect(variables).toEqual([
      { path: 'Main.Level', type: 'REAL', initialValue: '12.5' },
      { path: 'Main.Name', type: 'STRING' },
      { path: 'GVL.Alarm', type: 'BOOL', initialValue: 'TRUE' },
    ])
  })
})
