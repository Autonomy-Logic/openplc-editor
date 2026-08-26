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

const makeWStringVar = (name: string, cls: 'input' | 'output'): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'wstring' },
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
    // The length is clamped to the transport budget and the body zero-filled
    // before the copy, so a short string cannot carry the previous tail.
    expect(result).toContain('data_in.msg.len = __n;')
    expect(result).toContain('std::memset(data_in.msg.body, 0, STR_MAX_LEN);')
    expect(result).toContain('std::memcpy(data_in.msg.body, __s.c_str(), (size_t)__n);')
  })

  it('publishes the live IEC output values into shared memory at startup', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('count', 'output', 'dint'), makeStringVar('msg', 'output')],
      processedPythonCode: '',
    })

    // Shared memory is created zeroed, so without this the Python side has
    // nothing to seed from and falls back to its declarations — overwriting
    // the IEC value (a retained one included) on the first write-back.
    expect(result).toContain('shm_data_out_t seed_out;')
    expect(result).toContain('seed_out.count = COUNT;')
    expect(result).toContain('seed_out.msg.len = __n;')
    expect(result).toContain('memcpy(shm_out_ptr, &seed_out, sizeof(seed_out));')
  })

  it('publishes the seed inside the first_run branch, after the loader maps the segment', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('count', 'output', 'dint')],
      processedPythonCode: '',
    })

    const loaderAt = result.indexOf('python_block_loader')
    const seedAt = result.indexOf('memcpy(shm_out_ptr, &seed_out')
    const firstRunSetAt = result.indexOf('first_run := true;')
    expect(loaderAt).toBeGreaterThan(-1)
    expect(seedAt).toBeGreaterThan(loaderAt)
    expect(seedAt).toBeLessThan(firstRunSetAt)
  })

  it('emits no seed block when the POU has no outputs', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('v', 'input', 'int')],
      processedPythonCode: '',
    })

    expect(result).not.toContain('seed_out')
  })

  it('packs the string typedefs themselves, not just the structs using them', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeWStringVar('wmsg', 'input')],
      processedPythonCode: '',
    })

    // Regression: `#pragma pack` applies to the struct being defined, not to a
    // member type already laid out elsewhere. Without its own packed region,
    // shm_iec_wstring_t's uint16_t body forces a padding byte after `len` and
    // the field becomes 254 bytes where Python packs 253 — every later field
    // then decodes from the wrong offset. Only a real compile surfaced this.
    const preamble = result.slice(0, result.indexOf('shm_data_in_t'))
    const packedRegion = preamble.slice(preamble.indexOf('#pragma pack(push, 1)'), preamble.indexOf('#pragma pack(pop)'))
    expect(packedRegion).toContain('shm_iec_string_t')
    expect(packedRegion).toContain('shm_iec_wstring_t')
  })

  it('reads WSTRING inputs as UTF-16 code units, not bytes', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeWStringVar('wmsg', 'input')],
      processedPythonCode: '',
    })

    // WSTRING gets its own struct shape; sharing STRING's meant copying
    // STR_MAX_LEN *bytes* (half the characters) under a character count.
    expect(result).toContain('shm_iec_wstring_t wmsg;')
    expect(result).toContain('std::memcpy(data_in.wmsg.body, __s.c_str(), (size_t)__n * sizeof(uint16_t));')
    expect(result).toContain('std::memset(data_in.wmsg.body, 0, STR_MAX_LEN * sizeof(uint16_t));')
  })

  it('writes WSTRING outputs back through char16_t, not a reinterpreted char*', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeWStringVar('wmsg', 'output')],
      processedPythonCode: '',
    })

    expect(result).toContain('reinterpret_cast<const char16_t*>(data_out.wmsg.body)')
    expect(result).toContain('strucpp::IECWString<254>')
  })

  it('emits int64 fields for the duration and calendar types', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [
        makeScalarVar('t', 'input', 'time'),
        makeScalarVar('d', 'input', 'date'),
        makeScalarVar('td', 'input', 'tod'),
        makeScalarVar('dt', 'input', 'dt'),
      ],
      processedPythonCode: '',
    })

    // Previously these reached the C struct as int64_t while the Python format
    // string omitted them entirely, shifting every later field.
    expect(result).toContain('int64_t t;')
    expect(result).toContain('int64_t d;')
    expect(result).toContain('int64_t td;')
    expect(result).toContain('int64_t dt;')
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
