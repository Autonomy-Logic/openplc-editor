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

const localArrayVar: PLCVariable = {
  name: 'history',
  class: 'local',
  type: {
    definition: 'array',
    value: 'ARRAY [0..2] OF INT',
    data: {
      baseType: {
        definition: 'base-type',
        value: 'int',
      },
      dimensions: [{ dimension: '0..2' }],
    },
  },
  location: '',
  documentation: '',
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

  it('preserves local arrays through the generated bridge staging path', () => {
    const variables = [inputVar, outputVar, localVar, localArrayVar, runtimeVar]

    const stCode = generateSTCode({
      pouName: 'CounterBlock',
      allVariables: variables,
    })

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
        code: `void setup() { history[0] = counter; }\nvoid loop() { history[1] = IN; history[2] = history[0] + history[1]; OUT = history[2]; }`,
      },
    ])

    expect(stCode).toContain('IEC_INT __flat_HISTORY[3];')
    expect(stCode).toContain('__flat_HISTORY[__i] = data__->HISTORY.value.table[__i].value;')
    expect(stCode).toContain('vars.HISTORY = __flat_HISTORY - 0;')
    expect(stCode).toContain('data__->HISTORY.value.table[__i].value = __flat_HISTORY[__i];')
    expect(stCode).not.toContain('vars.HASBEENINITIALIZED')

    expect(header).toContain('IEC_INT *HISTORY;')
    expect(header).not.toContain('HASBEENINITIALIZED')

    expect(code).toContain('#define history (vars->HISTORY)')
    expect(code).not.toContain('#define hasBeenInitialized')
  })
})
