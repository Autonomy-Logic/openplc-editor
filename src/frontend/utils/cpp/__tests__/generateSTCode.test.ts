import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { generateSTCode } from '../generateSTCode'

const makeScalarVar = (name: string, cls: 'input' | 'output', baseType: string): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: baseType },
  location: '',
  documentation: '',
  debug: false,
})

const makeArrayVar = (
  name: string,
  cls: 'input' | 'output',
  baseType: string,
  dimension: string,
): PLCVariable => ({
  name,
  class: cls,
  type: {
    definition: 'array',
    value: `ARRAY [${dimension}] OF ${baseType}`,
    data: {
      baseType: { definition: 'base-type', value: baseType },
      dimensions: [{ dimension }],
    },
  },
  location: '',
  documentation: '',
  debug: false,
})

describe('generateSTCode', () => {
  it('generates ST code with struct, setup, and loop calls for scalar variables', () => {
    const result = generateSTCode({
      pouName: 'MyBlock',
      allVariables: [
        makeScalarVar('speed', 'input', 'INT'),
        makeScalarVar('result', 'output', 'REAL'),
      ],
    })

    // Struct variable declaration
    expect(result).toContain('MYBLOCK_VARS vars;')

    // Scalar variable assignments
    expect(result).toContain('vars.SPEED = &data__->SPEED.value;')
    expect(result).toContain('vars.RESULT = &data__->RESULT.value;')

    // Conditional setup
    expect(result).toContain('if hasBeenInitialized = False then')
    expect(result).toContain('myblock_setup(&vars);')
    expect(result).toContain('hasBeenInitialized := True;')

    // Loop call
    expect(result).toContain('myblock_loop(&vars);')
  })

  it('generates flat array declarations and copy-in code for array variables', () => {
    const result = generateSTCode({
      pouName: 'ArrBlock',
      allVariables: [makeArrayVar('temps', 'input', 'REAL', '0..4')],
    })

    // Flat array declaration
    expect(result).toContain('IEC_REAL __flat_TEMPS[5];')

    // Copy-in loop
    expect(result).toContain(
      'for (int __i = 0; __i < 5; __i++) __flat_TEMPS[__i] = data__->TEMPS.value.table[__i].value;',
    )

    // Array pointer assignment with start index offset
    expect(result).toContain('vars.TEMPS = __flat_TEMPS - 0;')
  })

  it('generates output array copy-back code for output arrays', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('outArr', 'output', 'INT', '1..10')],
    })

    // Output copy-back
    expect(result).toContain(
      'for (int __i = 0; __i < 10; __i++) data__->OUTARR.value.table[__i].value = __flat_OUTARR[__i];',
    )
  })

  it('does not generate output copy-back section when no output arrays exist', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('x', 'output', 'INT')],
    })

    // No copy-back loops (scalar outputs don't need it)
    expect(result).not.toContain('for (int __i')
  })

  it('handles no variables', () => {
    const result = generateSTCode({
      pouName: 'empty',
      allVariables: [],
    })

    expect(result).toContain('EMPTY_VARS vars;')
    expect(result).toContain('empty_setup(&vars);')
    expect(result).toContain('empty_loop(&vars);')
  })

  it('handles mixed scalar and array input/output variables', () => {
    const result = generateSTCode({
      pouName: 'mixed',
      allVariables: [
        makeScalarVar('a', 'input', 'INT'),
        makeArrayVar('b', 'input', 'REAL', '0..2'),
        makeScalarVar('c', 'output', 'BOOL'),
        makeArrayVar('d', 'output', 'INT', '0..3'),
      ],
    })

    // Scalar assignments
    expect(result).toContain('vars.A = &data__->A.value;')
    expect(result).toContain('vars.C = &data__->C.value;')

    // Array assignments
    expect(result).toContain('vars.B = __flat_B - 0;')
    expect(result).toContain('vars.D = __flat_D - 0;')

    // Flat array declarations for both input and output arrays
    expect(result).toContain('IEC_REAL __flat_B[3];')
    expect(result).toContain('IEC_INT __flat_D[4];')

    // Copy-back only for output arrays
    expect(result).toContain('data__->D.value.table[__i].value = __flat_D[__i]')
    expect(result).not.toContain('data__->B.value.table[__i].value = __flat_B[__i]')
  })

  it('filters out local variables', () => {
    const localVar: PLCVariable = {
      name: 'localVal',
      class: 'local',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    }

    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('x', 'input', 'INT'), localVar],
    })

    expect(result).not.toContain('LOCALVAL')
  })

  it('generates correct start index offset for non-zero-based arrays', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('arr', 'input', 'INT', '5..10')],
    })

    expect(result).toContain('vars.ARR = __flat_ARR - 5;')
    expect(result).toContain('IEC_INT __flat_ARR[6];')
  })
})
