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

const makeStringVar = (name: string, cls: 'input' | 'output'): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'string' },
  location: '',
  documentation: '',
  debug: false,
})

const makeArrayVar = (name: string, cls: 'input' | 'output', baseType: string, dimension: string): PLCVariable => ({
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
  it('generates type definitions and shared memory boilerplate', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [],
      processedPythonCode: 'print("hello")',
    })

    expect(result).toContain('(* Type definitions *)')
    expect(result).toContain('typedef uint8_t  IEC_BOOL;')
    expect(result).toContain('typedef int16_t   IEC_INT;')
    expect(result).toContain('typedef float    IEC_REAL;')
    expect(result).toContain('#define STR_MAX_LEN 126')
    expect(result).toContain('IEC_STRING')
  })

  it('generates shm_data_in_t struct with input variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('speed', 'input', 'INT')],
      processedPythonCode: '',
    })

    expect(result).toContain('shm_data_in_t')
    expect(result).toContain('IEC_INT speed;')
  })

  it('generates shm_data_out_t struct with output variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('result', 'output', 'REAL')],
      processedPythonCode: '',
    })

    expect(result).toContain('shm_data_out_t')
    expect(result).toContain('IEC_REAL result;')
  })

  it('adds padding field when no input variables exist', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('result', 'output', 'INT')],
      processedPythonCode: '',
    })

    // The input struct should have a padding field
    expect(result).toContain('uint8_t _padding;')
  })

  it('adds padding field when no output variables exist', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('speed', 'input', 'INT')],
      processedPythonCode: '',
    })

    // One _padding for the output struct
    expect(result).toContain('uint8_t _padding;')
  })

  it('generates padding for both structs when no variables exist', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [],
      processedPythonCode: '',
    })

    // Both structs get padding
    const paddingCount = (result.match(/uint8_t _padding;/g) || []).length
    expect(paddingCount).toBe(2)
  })

  it('generates input copy code for scalar variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('speed', 'input', 'INT')],
      processedPythonCode: '',
    })

    expect(result).toContain('data_in.speed = data__->SPEED.value;')
    expect(result).toContain('memcpy(shm_in_ptr, &data_in, sizeof(data_in));')
  })

  it('generates output copy code for scalar variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('result', 'output', 'REAL')],
      processedPythonCode: '',
    })

    expect(result).toContain('memcpy(&data_out, shm_out_ptr, sizeof(data_out));')
    expect(result).toContain('data__->RESULT.value = data_out.result;')
  })

  it('generates input copy code for array variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('data', 'input', 'INT', '0..4')],
      processedPythonCode: '',
    })

    expect(result).toContain(
      'for (int __i = 0; __i < 5; __i++) data_in.data[__i] = data__->DATA.value.table[__i].value;',
    )
  })

  it('generates output copy code for array variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('out', 'output', 'REAL', '0..2')],
      processedPythonCode: '',
    })

    expect(result).toContain(
      'for (int __i = 0; __i < 3; __i++) data__->OUT.value.table[__i].value = data_out.out[__i];',
    )
  })

  it('generates input copy code for string variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeStringVar('msg', 'input')],
      processedPythonCode: '',
    })

    expect(result).toContain('data_in.msg.len = data__->MSG.value.len;')
    expect(result).toContain('memcpy(data_in.msg.body, data__->MSG.value.body, STR_MAX_LEN);')
  })

  it('generates output copy code for string variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeStringVar('msg', 'output')],
      processedPythonCode: '',
    })

    expect(result).toContain('data__->MSG.value.len = data_out.msg.len;')
    expect(result).toContain('memcpy(data__->MSG.value.body, data_out.msg.body, STR_MAX_LEN);')
  })

  it('generates struct fields for array variables', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('arr', 'input', 'INT', '0..9')],
      processedPythonCode: '',
    })

    expect(result).toContain('IEC_INT arr[10];')
  })

  it('embeds escaped python code in the template', () => {
    const pythonCode = 'print("hello\\nworld")\nx = 1'
    const result = generateSTCode({
      pouName: 'myBlock',
      allVariables: [],
      processedPythonCode: pythonCode,
    })

    expect(result).toContain('const char *script_name = "myBlock.py";')
    // The python code should be escaped for embedding as a C string
    expect(result).toContain('const char script_template[] =')
  })

  it('generates python_block_loader call with correct pou name', () => {
    const result = generateSTCode({
      pouName: 'controller',
      allVariables: [],
      processedPythonCode: 'pass',
    })

    expect(result).toContain('"controller.py"')
    expect(result).toContain('python_block_loader')
  })

  it('generates shared memory pointer storage in first_run branch', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [],
      processedPythonCode: '',
    })

    expect(result).toContain('if first_run = false then')
    expect(result).toContain('data__->SHM_IN_PTR.value = (uint64_t)shm_in_ptr;')
    expect(result).toContain('data__->SHM_OUT_PTR.value = (uint64_t)shm_out_ptr;')
    expect(result).toContain('first_run := true;')
  })

  it('generates null checks in the else branch', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [],
      processedPythonCode: '',
    })

    expect(result).toContain('void *shm_in_ptr = (void *)data__->SHM_IN_PTR.value;')
    expect(result).toContain('void *shm_out_ptr = (void *)data__->SHM_OUT_PTR.value;')
    expect(result).toContain('if (shm_in_ptr == NULL)')
    expect(result).toContain('if (shm_out_ptr == NULL)')
  })

  it('filters variables by class correctly', () => {
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
      allVariables: [makeScalarVar('x', 'input', 'INT'), localVar, makeScalarVar('y', 'output', 'INT')],
      processedPythonCode: '',
    })

    expect(result).toContain('IEC_INT x;')
    expect(result).toContain('IEC_INT y;')
    expect(result).not.toContain('localVal')
  })
})
