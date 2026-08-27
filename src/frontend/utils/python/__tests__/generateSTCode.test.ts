import type { PLCDataType, PLCVariable } from '../../../../middleware/shared/ports/types'
import { generateSTCode } from '../generateSTCode'

const makeScalarVar = (name: string, cls: PLCVariable['class'], baseType: string): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: baseType },
  location: '',
  documentation: '',
  debug: false,
})

const makeStringVar = (name: string, cls: PLCVariable['class']): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'string' },
  location: '',
  documentation: '',
  debug: false,
})

const makeWStringVar = (name: string, cls: PLCVariable['class']): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'wstring' },
  location: '',
  documentation: '',
  debug: false,
})

const makeArrayVar = (name: string, cls: PLCVariable['class'], baseType: string, dimension: string): PLCVariable => ({
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

  it('copies each array element at its declared IEC index', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('data', 'input', 'INT', '5..9')],
      processedPythonCode: '',
    })

    // 5 elements, IEC indices 5..9: one statement per element at its declared
    // index, with no loop and no `startIndex + i` arithmetic to get wrong. An
    // element goes through the same implicit `IECVar` conversion a scalar does,
    // because it IS a scalar now as far as the emitter is concerned.
    expect(result).toContain('data_in.data_5 = DATA[5];')
    expect(result).toContain('data_in.data_9 = DATA[9];')
  })

  it('reaches an enumeration ARRAY element without the wrapper accessors', () => {
    // `IEC_ARRAY_1D<MODE, …>::operator[]` yields a RAW scoped enum — the
    // container holds values, not wrappers — so `.get().get()` / `.set()` do not
    // compile on an element. A standalone enumeration variable is an
    // `IEC_ENUM_Var` and still needs them. Found by an on-device build.
    const MODE: PLCDataType = {
      name: 'Mode',
      derivation: 'enumerated',
      values: [{ description: 'STOPPED' }, { description: 'RUNNING' }],
    }
    const modes: PLCVariable = {
      name: 'modes',
      class: 'inOut',
      type: {
        definition: 'array',
        value: 'ARRAY [0..1] OF Mode',
        data: {
          baseType: { definition: 'user-data-type', value: 'Mode' },
          dimensions: [{ dimension: '0..1' }],
        },
      },
      location: '',
      documentation: '',
      debug: false,
    }
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [modes],
      processedPythonCode: '',
      dataTypes: [MODE],
    })

    expect(result).toContain('data_in.modes_0 = static_cast<int16_t>(MODES[0]);')
    expect(result).toContain('MODES[0] = static_cast<MODE>(data_out.modes_0);')
    expect(result).not.toContain('MODES[0].get().get()')
    expect(result).not.toContain('MODES[0].set(')
  })

  it('writes back each array element through its IECVar (force-respect)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('out', 'output', 'REAL', '0..2')],
      processedPythonCode: '',
    })

    expect(result).toContain('OUT[0] = data_out.out_0;')
    expect(result).toContain('OUT[2] = data_out.out_2;')
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
    const packedRegion = preamble.slice(
      preamble.indexOf('#pragma pack(push, 1)'),
      preamble.indexOf('#pragma pack(pop)'),
    )
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

  it('guards the STRING write-back so a value wider than the transport is not truncated', () => {
    // The transport carries STR_MAX_LEN characters; an `IECStringVar` holds 254.
    // An IEC string longer than the transport reaches Python already truncated,
    // so writing Python's copy back would shorten the IEC variable permanently
    // — with no user code having touched it. Reachable only since `local`,
    // `inOut` and `external` began to round-trip.
    // Every class that writes back gets the guard: an `external` reaches its
    // global through the lock guard (`__r`) rather than by name, so the check is
    // asserted on all four rather than on one spelling.
    for (const cls of ['output', 'inOut', 'local', 'external'] as const) {
      const result = generateSTCode({
        pouName: 'test',
        allVariables: [makeStringVar('msg', cls)],
        processedPythonCode: '',
      })
      expect(result).toContain('if (__cur.length() <= STR_MAX_LEN)')
      expect(result).toMatch(/auto __cur = (MSG|__r)\.get\(\);/)
    }
  })

  it('guards the WSTRING write-back the same way', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeWStringVar('wmsg', 'output')],
      processedPythonCode: '',
    })

    expect(result).toContain('auto __cur = WMSG.get();')
    expect(result).toContain('if (__cur.length() <= STR_MAX_LEN)')
    expect(result).toContain('strucpp::IECWString<254>(reinterpret_cast<const char16_t*>(data_out.wmsg.body)')
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

  describe('structures and enumerations', () => {
    const MOTOR: PLCDataType = {
      name: 'Motor',
      derivation: 'structure',
      variable: [
        { name: 'speed', type: { definition: 'base-type', value: 'int' } },
        { name: 'label', type: { definition: 'base-type', value: 'string' } },
      ],
    }
    const MODE: PLCDataType = {
      name: 'Mode',
      derivation: 'enumerated',
      values: [{ description: 'STOPPED' }, { description: 'RUNNING' }],
    }
    const userTyped = (name: string, cls: PLCVariable['class'], typeName: string): PLCVariable => ({
      name,
      class: cls,
      type: { definition: 'user-data-type', value: typeName },
      location: '',
      documentation: '',
      debug: false,
    })
    const run = (variables: PLCVariable[], dataTypes: PLCDataType[]) =>
      generateSTCode({ pouName: 'test', allVariables: variables, processedPythonCode: '', dataTypes })

    it('flattens a structure into one field per member', () => {
      const result = run([userTyped('m', 'input', 'Motor')], [MOTOR])

      expect(result).toContain('int16_t m_speed;')
      expect(result).toContain('shm_iec_string_t m_label;')
    })

    it('copies each member individually, by its name on the strucpp side', () => {
      const result = run([userTyped('m', 'input', 'Motor')], [MOTOR])

      expect(result).toContain('data_in.m_speed = M.SPEED;')
      expect(result).toContain('auto __s = M.LABEL.get();')
    })

    it('reads an enumeration through both wrappers before casting to its integer', () => {
      // `IEC_ENUM_Var::get()` yields an `IEC_ENUM_Value`, which converts to the
      // scoped enum but not to an integer.
      const result = run([userTyped('md', 'input', 'Mode')], [MODE])

      expect(result).toContain('data_in.md = static_cast<int16_t>(MD.get().get());')
    })

    it('writes an enumeration back through set(), not operator=', () => {
      // `operator=` would copy-assign a whole temporary wrapper and take its
      // forced state along; `set()` leaves forcing where it was.
      const result = run([userTyped('md', 'output', 'Mode')], [MODE])

      expect(result).toContain('MD.set(static_cast<MODE>(data_out.md));')
    })

    it('writes a structure member back individually', () => {
      const result = run([userTyped('m', 'output', 'Motor')], [MOTOR])

      expect(result).toContain('M.SPEED = data_out.m_speed;')
    })

    it('seeds a structure output from what the PLC holds', () => {
      const result = run([userTyped('m', 'output', 'Motor')], [MOTOR])

      expect(result).toContain('seed_out.m_speed = M.SPEED;')
    })

    it('copies a structure member of an external under the global’s lock', () => {
      const result = run([userTyped('g', 'external', 'Motor')], [MOTOR])

      expect(result).toContain('G->with_lock([&](auto* __g) {')
      expect(result).toContain('data_in.g_speed = __r.SPEED;')
    })
  })

  describe('function block instances', () => {
    const TON_LIB = {
      functionBlocks: [
        {
          name: 'TON',
          inputs: [
            { name: 'IN', type: 'BOOL' },
            { name: 'PT', type: 'TIME' },
          ],
          inouts: [],
          outputs: [
            { name: 'Q', type: 'BOOL' },
            { name: 'ET', type: 'TIME' },
          ],
        },
      ],
    }
    const instance = (name: string): PLCVariable => ({
      name,
      class: 'local',
      type: { definition: 'derived', value: 'TON' },
      location: '',
      documentation: '',
      debug: false,
    })
    const run = (variables: PLCVariable[]) =>
      generateSTCode({
        pouName: 'blk',
        allVariables: variables,
        processedPythonCode: '',
        dataTypes: [],
        libraries: [TON_LIB],
      })

    it('calls the instance once per scan, as ST', () => {
      // This is what makes an instance usable from Python at all: Python cannot
      // call it, but the wrapper runs in the PLC process where it lives. Written
      // as ST so the call goes through the same path a hand-written `ton0();`
      // would, including the EN gate the compiler puts at every call site.
      expect(run([instance('ton0')])).toContain('ton0();')
    })

    it('calls each instance, in declaration order', () => {
      const result = run([instance('first'), instance('second')])

      expect(result.indexOf('first();')).toBeLessThan(result.indexOf('second();'))
    })

    it('applies Python’s pin writes before the call and publishes after', () => {
      // Otherwise setting `ton0.IN` would see `ton0.Q` answer a scan late for no
      // reason. The exchange splits around the call.
      const result = run([instance('ton0')])
      const applied = result.indexOf('TON0.IN = data_out.ton0_IN;')
      const called = result.indexOf('ton0();')
      const published = result.indexOf('data_in.ton0_Q = TON0.Q;')

      expect(applied).toBeGreaterThan(-1)
      expect(called).toBeGreaterThan(applied)
      expect(published).toBeGreaterThan(called)
    })

    it('puts every pin in the inbound struct and only drivable pins in the outbound one', () => {
      const result = run([instance('ton0')])
      const inStart = result.indexOf('typedef struct {', result.indexOf('#pragma pack(pop)'))
      const inbound = result.slice(inStart, result.indexOf('} shm_data_in_t;'))
      const outbound = result.slice(
        result.indexOf('typedef struct {', result.indexOf('} shm_data_in_t;')),
        result.indexOf('} shm_data_out_t;'),
      )

      expect(inbound).toContain('uint8_t ton0_Q;')
      expect(inbound).toContain('int64_t ton0_ET;')
      expect(outbound).toContain('uint8_t ton0_IN;')
      expect(outbound).not.toContain('ton0_Q')
    })

    it('keeps the single-block exchange when there is no instance', () => {
      // The split only earns its keep when something has to run between the two
      // copies; without an instance the wrapper stays as it was.
      const result = generateSTCode({
        pouName: 'blk',
        allVariables: [makeScalarVar('x', 'input', 'INT')],
        processedPythonCode: '',
      })

      expect(result.match(/\{external/g)?.length).toBe(3)
    })
  })

  describe('variable classes', () => {
    const byClass = (name: string, cls: PLCVariable['class'], type = 'INT'): PLCVariable => ({
      name,
      class: cls,
      type: { definition: 'base-type', value: type },
      location: '',
      documentation: '',
      debug: false,
    })

    const structs = (result: string) => {
      const inStart = result.indexOf('typedef struct {')
      const inEnd = result.indexOf('} shm_data_in_t;')
      const outStart = result.indexOf('typedef struct {', inEnd)
      const outEnd = result.indexOf('} shm_data_out_t;')
      return { inbound: result.slice(inStart, inEnd), outbound: result.slice(outStart, outEnd) }
    }

    it('sends an input in only and an output back only', () => {
      const result = generateSTCode({
        pouName: 'test',
        allVariables: [makeScalarVar('x', 'input', 'INT'), makeScalarVar('y', 'output', 'INT')],
        processedPythonCode: '',
      })
      const { inbound, outbound } = structs(result)

      expect(inbound).toContain('int16_t x;')
      expect(inbound).not.toContain('int16_t y;')
      expect(outbound).toContain('int16_t y;')
      expect(outbound).not.toContain('int16_t x;')
    })

    it.each([
      ['inOut', 'ioVal'],
      ['local', 'localVal'],
      ['external', 'gVal'],
    ])('sends a %s both ways, so the PLC keeps owning the value', (cls, name) => {
      // A block that never assigns one sends back what it received. That is what
      // makes a VAR the block's own state, keeps it visible to the debugger, and
      // lets it be retained.
      const result = generateSTCode({
        pouName: 'test',
        allVariables: [makeScalarVar('x', 'input', 'INT'), byClass(name, cls as PLCVariable['class'])],
        processedPythonCode: '',
      })
      const { inbound, outbound } = structs(result)

      expect(inbound).toContain(`int16_t ${name};`)
      expect(outbound).toContain(`int16_t ${name};`)
    })

    it('leaves a temp out entirely — it is refused before reaching here', () => {
      const result = generateSTCode({
        pouName: 'test',
        allVariables: [makeScalarVar('x', 'input', 'INT'), byClass('scratch', 'temp')],
        processedPythonCode: '',
      })

      expect(result).not.toContain('scratch')
    })

    it('copies an external under the global’s own lock', () => {
      // A VAR_EXTERNAL is a `GlobalVar<V>*`, not a member. Naming it directly
      // would compile and copy from the wrong place holding no lock at all.
      const result = generateSTCode({
        pouName: 'test',
        allVariables: [byClass('gVal', 'external')],
        processedPythonCode: '',
      })

      expect(result).toContain('GVAL->with_lock([&](auto* __g) {')
      expect(result).toContain('auto& __r = *__g;')
      expect(result).toContain('data_in.gVal = __r;')
    })

    it('never writes `(*` inside the external block, which the ST lexer reads as a comment', () => {
      const result = generateSTCode({
        pouName: 'test',
        allVariables: [byClass('gVal', 'external')],
        processedPythonCode: '',
      })

      expect(result).not.toContain('(*__g)')
    })

    it('locks each external on its own rather than nesting them', () => {
      // The stub only copies values; it runs no user code, so one lock at a time
      // is enough and there is no lock ordering to reason about.
      const result = generateSTCode({
        pouName: 'test',
        allVariables: [byClass('gA', 'external'), byClass('gB', 'external')],
        processedPythonCode: '',
      })
      const closeBeforeSecondOpen = result.indexOf('});') < result.indexOf('GB->with_lock')

      expect(closeBeforeSecondOpen).toBe(true)
    })
  })
})
