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

describe('generateSTCode (python)', () => {
  it('emits the SHM type preamble without redefining strucpp IEC types', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [],
      processedPythonCode: 'print("hello")',
    })

    expect(result).toContain('(* Type definitions *)')
    expect(result).toContain('#define STR_MAX_LEN 126')
    // Stub-local SHM string layout — distinct name avoids colliding with
    // strucpp::IEC_STRING (= IECStringVar<254>) which is in scope inside
    // the {external} block.
    expect(result).toContain('shm_iec_string_t')

    // The old preamble's typedef block (IEC_BOOL/INT/.../IEC_STRING) is
    // gone — strucpp's runtime headers already provide them.
    expect(result).not.toContain('typedef uint8_t  IEC_BOOL')
    expect(result).not.toContain('typedef int16_t   IEC_INT')
    expect(result).not.toMatch(/typedef\s+struct\s+\{\s*__strlen_t len[\s\S]*?\}\s+IEC_STRING\b/)
  })

  it('generates shm_data_in_t / shm_data_out_t structs with raw C types', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')],
      processedPythonCode: '',
    })

    // SHM is a packed binary protocol the Python runtime decodes via
    // `struct.unpack`. Fields must be trivially-copyable C primitives;
    // strucpp's IEC_INT (= IECVar<int16_t>) has a non-trivial copy
    // assignment which would make memcpy(&data_out, …) UB and trigger
    // -Wclass-memaccess.
    expect(result).toContain('shm_data_in_t')
    expect(result).toContain('int16_t speed;')
    expect(result).toContain('shm_data_out_t')
    expect(result).toContain('float result;')
  })

  it('uses shm_iec_string_t (not IEC_STRING) for STRING fields in the SHM struct', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeStringVar('msg', 'input')],
      processedPythonCode: '',
    })

    expect(result).toContain('shm_iec_string_t msg;')
    expect(result).not.toMatch(/^\s*IEC_STRING msg;$/m)
  })

  it('pads empty input/output structs (mmap rejects size 0)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [],
      processedPythonCode: '',
    })

    const paddingCount = (result.match(/uint8_t _padding;/g) || []).length
    expect(paddingCount).toBe(2)
  })

  it('reads scalar inputs through the IECVar (force-aware)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('speed', 'input', 'INT')],
      processedPythonCode: '',
    })

    // IECVar's `operator T()` routes through .get() — forced inputs are
    // reflected in the SHM the Python user observes.
    expect(result).toContain('data_in.speed = SPEED;')
    expect(result).toContain('memcpy(shm_in_ptr, &data_in, sizeof(data_in));')
    expect(result).not.toContain('data__->')
  })

  it('writes scalar outputs through IECVar::operator= (force-respecting)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('result', 'output', 'REAL')],
      processedPythonCode: '',
    })

    // Operator= routes through .set() which is a no-op when forced —
    // user writes to a forced output don't override the force.
    expect(result).toContain('memcpy(&data_out, shm_out_ptr, sizeof(data_out));')
    expect(result).toContain('RESULT = data_out.result;')
  })

  it('iterates IEC indices for array inputs (handles non-zero lower bounds)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('data', 'input', 'INT', '5..9')],
      processedPythonCode: '',
    })

    // 5 elements, IEC indices 5..9. Reads through .get() per element.
    expect(result).toContain('for (int __i = 0; __i < 5; __i++) data_in.data[__i] = DATA[5 + __i].get();')
  })

  it('writes back array outputs via IECVar element-wise (force-respect)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('out', 'output', 'REAL', '0..2')],
      processedPythonCode: '',
    })

    expect(result).toContain('for (int __i = 0; __i < 3; __i++) OUT[0 + __i] = data_out.out[__i];')
  })

  it('reads STRING inputs into the SHM struct via IECStringVar.get()', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeStringVar('msg', 'input')],
      processedPythonCode: '',
    })

    expect(result).toContain('auto __s = MSG.get();')
    expect(result).toContain('data_in.msg.len = (__strlen_t)__s.length();')
    expect(result).toContain('std::memcpy(data_in.msg.body, __s.c_str(), STR_MAX_LEN);')
  })

  it('writes STRING outputs back through IECStringVar (force-respect)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeStringVar('msg', 'output')],
      processedPythonCode: '',
    })

    expect(result).toContain(
      'MSG = strucpp::IECString<254>(reinterpret_cast<const char*>(data_out.msg.body), data_out.msg.len);',
    )
  })

  it('reads / writes the runtime SHM-pointer locals through their IECVars', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [],
      processedPythonCode: '',
    })

    expect(result).toContain('if first_run = false then')
    // First-run branch: cache the SHM pointers into the program-level
    // ULINT IECVars via operator=.
    expect(result).toContain('SHM_IN_PTR = (uint64_t)shm_in_ptr;')
    expect(result).toContain('SHM_OUT_PTR = (uint64_t)shm_out_ptr;')
    expect(result).toContain('first_run := true;')

    // Else branch: read them back via the implicit conversion.
    expect(result).toContain('void *shm_in_ptr = (void *)(uint64_t)SHM_IN_PTR;')
    expect(result).toContain('void *shm_out_ptr = (void *)(uint64_t)SHM_OUT_PTR;')
    expect(result).toContain('if (shm_in_ptr == NULL)')
    expect(result).toContain('if (shm_out_ptr == NULL)')
  })

  it('embeds the escaped python source into the loader call', () => {
    const result = generateSTCode({
      pouName: 'controller',
      allVariables: [],
      processedPythonCode: 'pass',
    })

    expect(result).toContain('const char *script_name = "controller.py";')
    expect(result).toContain('const char script_template[] =')
    expect(result).toContain('python_block_loader')
  })

  it('skips locals — only input/output appear in SHM structs', () => {
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

    expect(result).toContain('int16_t x;')
    expect(result).toContain('int16_t y;')
    expect(result).not.toContain('localVal')
  })
})
