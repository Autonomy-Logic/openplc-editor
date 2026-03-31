import type { PLCVariable } from '@root/types/PLC/open-plc'

import { generateCBlocksCode } from './generateCBlocksCode'
import { generateCBlocksHeader } from './generateCBlocksHeader'
import { generateSTCode } from './generateSTCode'

const inputVar: PLCVariable = {
  name: 'IN',
  class: 'input',
  type: {
    definition: 'base-type',
    value: 'int',
  },
  location: '',
  documentation: '',
}

const outputVar: PLCVariable = {
  name: 'OUT',
  class: 'output',
  type: {
    definition: 'base-type',
    value: 'int',
  },
  location: '',
  documentation: '',
}

const localVar: PLCVariable = {
  name: 'counter',
  class: 'local',
  type: {
    definition: 'base-type',
    value: 'int',
  },
  location: '',
  documentation: '',
  initialValue: '0',
}

const runtimeVar: PLCVariable = {
  name: 'hasBeenInitialized',
  class: 'local',
  type: {
    definition: 'base-type',
    value: 'bool',
  },
  location: '',
  documentation: '',
  initialValue: '0',
}

describe('C/C++ FB bridge generation', () => {
  it('includes user local variables in the generated ST wrapper', () => {
    const stCode = generateSTCode({
      pouName: 'CounterBlock',
      allVariables: [inputVar, outputVar, localVar, runtimeVar],
    })

    expect(stCode).toContain('vars.COUNTER = &data__->COUNTER.value;')
    expect(stCode).not.toContain('vars.HASBEENINITIALIZED')
  })

  it('includes user local variables in the generated header and code bridge', () => {
    const variables = [inputVar, outputVar, localVar, runtimeVar]

    const header = generateCBlocksHeader([
      {
        name: 'CounterBlock',
        variables,
      },
    ])

    const code = generateCBlocksCode([
      {
        name: 'CounterBlock',
        variables,
        code: `void setup() { counter = 1; }\nvoid loop() { counter += IN; OUT = counter; }`,
      },
    ])

    expect(header).toContain('IEC_INT *COUNTER;')
    expect(header).not.toContain('HASBEENINITIALIZED')

    expect(code).toContain('#define counter (*(vars->COUNTER))')
    expect(code).not.toContain('#define hasBeenInitialized')
  })
})
