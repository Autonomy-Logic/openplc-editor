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

  it('generates output initialization for scalar output variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=h',
      inputVariables: [],
      outputVariables: [makeScalarVar('count', 'output', 'INT')],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('count = 0')
  })

  it('generates output initialization for array output variables', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=3h',
      inputVariables: [],
      outputVariables: [makeArrayVar('arr', 'output', 'INT', '0..2')],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('arr = [0] * 3')
  })

  it('generates output initialization for string output variables', () => {
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

    expect(result).toContain('msg = ""')
  })

  it('uses initialValue when present for scalar output initialization', () => {
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

    expect(result).toContain('count = 42')
  })

  it('outputs comment for no output variables in initialization', () => {
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: [],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
    })

    expect(result).toContain('# No output variables to initialize')
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
