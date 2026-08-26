import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { injectPythonRuntime } from '../injectPythonRuntime'

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

const makeWStringVar = (name: string, cls: 'input' | 'output'): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'wstring' },
  location: '',
  documentation: '',
  debug: false,
})

describe('WSTRING crosses as UTF-16, counted in code units', () => {
  // WSTRING shared STRING's handling until DOPE-584 P2, which was wrong in both
  // directions: the body is char16_t, so the byte count is twice the length, and
  // the length the C side writes counts code units rather than bytes. These pin
  // the distinction on both sides of the boundary.
  const run = (variables: PLCVariable[]) =>
    injectPythonRuntime({
      fmtIn: '=b252s',
      fmtOut: '=b252s',
      inputVariables: variables.filter((v) => v.class === 'input'),
      outputVariables: variables.filter((v) => v.class === 'output'),
      originalCode: '',
      pouName: 'test',
    })

  it('decodes an inbound WSTRING as utf-16-le over twice the length', () => {
    const result = run([makeWStringVar('label', 'input')])

    expect(result).toContain("label = label_body[:label_len * 2].decode('utf-16-le', errors='ignore')")
  })

  it('decodes an inbound STRING as utf-8 over the length itself', () => {
    const result = run([makeStringVar('label', 'input')])

    expect(result).toContain("label = label_body[:label_len].decode('utf-8', errors='ignore')")
  })

  it('encodes an outbound WSTRING to the doubled byte budget', () => {
    const result = run([makeWStringVar('label', 'output')])

    expect(result).toContain("_body = label.encode('utf-16-le')[:252]")
    expect(result).toContain("_body = _body.ljust(252, b'\\0')")
  })

  it('truncates an outbound WSTRING on a code-unit boundary, never mid-unit', () => {
    // Clipping to an odd byte count would split a UTF-16 unit and hand the C
    // side half a character.
    const result = run([makeWStringVar('label', 'output')])

    expect(result).toContain('_body = _body[: len(_body) - (len(_body) % 2)]')
  })

  it('reports an outbound WSTRING length in code units, not bytes', () => {
    const result = run([makeWStringVar('label', 'output')])

    expect(result).toContain('_len = len(_body) // 2')
  })

  it('reports an outbound STRING length in bytes, which for utf-8 is what it is', () => {
    const result = run([makeStringVar('label', 'output')])

    expect(result).toContain('_len = len(_body)')
    expect(result).not.toContain('_len = len(_body) // 2')
  })
})

describe('injectPythonRuntime', () => {
  it('injects runtime wrapper around original code with no variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: [],
      outputVariables: [],
      originalCode: 'def block_init():\n    pass\ndef block_loop():\n    pass',
      pouName: 'test',
    })

    expect(result).toContain('def block_init():')
    expect(result).toContain('def block_loop():')
    expect(result).toContain("fmt_in = ('=')")
    expect(result).toContain("fmt_out = ('=')")
    expect(result).toContain('plc_pid = %d')
    expect(result).toContain('block_init()')
    expect(result).toContain('block_loop()')
    expect(result).toContain('Stopping Python block: test')
    expect(result).toContain('shm_in.close()')
    expect(result).toContain('shm_out.close()')
  })

  it('generates input unpack code for scalar variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=hf',
      fmtOut: '=',
      inputVariables: [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('temp', 'input', 'REAL')],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('_vals = struct.unpack(fmt_in, shm_in.buf[:data_size_in])')
    expect(result).toContain('_idx = 0')
    expect(result).toContain('speed = _vals[_idx]')
    expect(result).toContain('temp = _vals[_idx]')
  })

  it('generates output pack code for scalar variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=hB',
      inputVariables: [],
      outputVariables: [makeScalarVar('result', 'output', 'INT'), makeScalarVar('flag', 'output', 'BOOL')],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('_out = []')
    expect(result).toContain('_out.append(result)')
    expect(result).toContain('_out.append(flag)')
    expect(result).toContain('packed = struct.pack(fmt_out, *_out)')
    expect(result).toContain('shm_out.buf[:data_size_out] = packed')
  })

  it('generates input unpack code for array variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=5h',
      fmtOut: '=',
      inputVariables: [makeArrayVar('data', 'input', 'INT', '0..4')],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('data = list(_vals[_idx:_idx+5])')
    expect(result).toContain('_idx += 5')
  })

  it('generates output pack code for array variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=3f',
      inputVariables: [],
      outputVariables: [makeArrayVar('temps', 'output', 'REAL', '0..2')],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('_out.extend(temps)')
  })

  it('generates input unpack code for string variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=b126s',
      fmtOut: '=',
      inputVariables: [makeStringVar('msg', 'input')],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('msg_len = _vals[_idx]')
    expect(result).toContain('msg_body = _vals[_idx]')
    expect(result).toContain("msg = msg_body[:msg_len].decode('utf-8', errors='ignore')")
  })

  it('generates output pack code for string variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=b126s',
      inputVariables: [],
      outputVariables: [makeStringVar('msg', 'output')],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain("_body = msg.encode('utf-8')[:126]")
    expect(result).toContain('_len = len(_body)')
    expect(result).toContain("_body = _body.ljust(126, b'\\0')")
    expect(result).toContain('_out.append(_len)')
    expect(result).toContain('_out.append(_body)')
  })

  it('seeds scalar outputs from shared memory, not from the declaration', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=h',
      inputVariables: [],
      outputVariables: [makeScalarVar('count', 'output', 'INT')],
      originalCode: '',
      pouName: 'test',
    })

    // The old behaviour set `count = 0` from the declaration and wrote that
    // back on the first cycle, destroying whatever the PLC held.
    expect(result).toContain('# Seed outputs from the values the PLC already holds')
    expect(result).toContain('_vals = struct.unpack(fmt_out, shm_out.buf[:data_size_out])')
    expect(result).toContain('count = _vals[_idx]')
    expect(result).not.toContain('count = 0')
  })

  it('seeds array outputs from shared memory', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=3h',
      inputVariables: [],
      outputVariables: [makeArrayVar('arr', 'output', 'INT', '0..2')],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('arr = list(_vals[_idx:_idx+3])')
    expect(result).not.toContain('arr = [0] * 3')
  })

  it('seeds string outputs by decoding the shared-memory body', () => {
    const outputVar: PLCVariable = {
      name: 'msg',
      class: 'output',
      type: { definition: 'base-type', value: 'string' },
      location: '',
      documentation: '',
      debug: false,
    }

    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=b126s',
      inputVariables: [],
      outputVariables: [outputVar],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain("msg = msg_body[:msg_len].decode('utf-8', errors='ignore')")
    expect(result).not.toContain('msg = ""')
  })

  it('ignores a declared initialValue on an output — the PLC value wins', () => {
    const outputVar: PLCVariable = {
      name: 'count',
      class: 'output',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
      initialValue: '42',
    }

    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=h',
      inputVariables: [],
      outputVariables: [outputVar],
      originalCode: '',
      pouName: 'test',
    })

    // The declaration's initial value is applied by the runtime on the IEC
    // side and reaches Python through shared memory. Re-applying it here is
    // what overwrote a retained value on restart.
    expect(result).not.toContain('count = 42')
    expect(result).toContain('count = _vals[_idx]')
  })

  it('seeds before block_init so the user sees real values in it', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=h',
      inputVariables: [],
      outputVariables: [makeScalarVar('count', 'output', 'INT')],
      originalCode: '',
      pouName: 'test',
    })

    expect(result.indexOf('# Seed outputs')).toBeLessThan(result.indexOf('block_init()'))
    // calcsize has to precede the seed — the seed reads that many bytes.
    expect(result.indexOf('data_size_out = struct.calcsize')).toBeLessThan(result.indexOf('# Seed outputs'))
  })

  it('says so plainly when there are no outputs to seed', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: [],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('# No output variables to seed')
  })

  it('outputs comment for no input variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: [],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('# No input variables to read')
  })

  it('outputs comment for no output variables in write section', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: [],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('# No output variables to write')
  })
})
