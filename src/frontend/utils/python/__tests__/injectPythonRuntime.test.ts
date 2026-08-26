import type { PLCDataType, PLCVariable } from '../../../../middleware/shared/ports/types'
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

const userTyped = (name: string, cls: 'input' | 'output', typeName: string): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'user-data-type', value: typeName },
  location: '',
  documentation: '',
  debug: false,
})

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

describe('function block instances', () => {
  const instance = (name: string): PLCVariable => ({
    name,
    class: 'local',
    type: { definition: 'derived', value: 'TON' },
    location: '',
    documentation: '',
    debug: false,
  })
  const run = (variables: PLCVariable[]) =>
    injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: variables,
      outputVariables: variables,
      originalCode: '',
      pouName: 'test',
      inbound: { dataTypes: [], libraries: [TON_LIB], direction: 'in' },
      outbound: { dataTypes: [], libraries: [TON_LIB], direction: 'out' },
    })

  it('declares a class carrying every pin, so one class serves both directions', () => {
    const result = run([instance('ton0')])

    expect(result).toContain('class TON:')
    expect(result).toContain("__slots__ = ('IN', 'PT', 'Q', 'ET')")
  })

  it('says the instances are called by the PLC, not by the block', () => {
    expect(run([instance('ton0')])).toContain('# Function block instances — called once per scan by the PLC')
  })

  it('declares each block type once however many instances use it', () => {
    const result = run([instance('a'), instance('b')])

    expect(result.match(/class TON:/g)).toHaveLength(1)
  })

  it('rebuilds the instance from every pin on the way in', () => {
    const result = run([instance('ton0')])

    expect(result).toContain('ton0 = TON(IN=_ton0_IN, PT=_ton0_PT, Q=_ton0_Q, ET=_ton0_ET)')
  })

  it('rebuilds it from only the drivable pins when seeding outputs', () => {
    // The seed decodes the outbound layout, which has no output pins in it.
    // Naming one here is what killed the block with `NameError: _ton0_Q`.
    const result = run([instance('ton0')])
    const seed = result.slice(result.indexOf('# Seed outputs'), result.indexOf('# Initialize block'))

    expect(seed).toContain('ton0 = TON(IN=_ton0_IN, PT=_ton0_PT)')
    expect(seed).not.toContain('_ton0_Q')
  })

  it('packs only the drivable pins back', () => {
    const result = run([instance('ton0')])
    const pack = result.slice(result.indexOf('# Write output variables'))

    expect(pack).toContain('_out.append(ton0.IN)')
    expect(pack).not.toContain('_out.append(ton0.Q)')
  })

  it('upper-cases a pin the project declared in lower case', () => {
    // The compiler upper-cases members, and the Python attribute has to match
    // the slot it was constructed with.
    const lower = {
      functionBlocks: [{ name: 'ACC', inputs: [{ name: 'step', type: 'INT' }], inouts: [], outputs: [] }],
    }
    const acc: PLCVariable = { ...instance('acc'), type: { definition: 'derived', value: 'ACC' } }
    const result = injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: [acc],
      outputVariables: [acc],
      originalCode: '',
      pouName: 'test',
      inbound: { dataTypes: [], libraries: [lower], direction: 'in' },
      outbound: { dataTypes: [], libraries: [lower], direction: 'out' },
    })

    expect(result).toContain("__slots__ = ('STEP',)")
    expect(result).toContain('acc = ACC(STEP=_acc_STEP)')
    expect(result).toContain('_out.append(acc.STEP)')
  })
})

describe('structures and enumerations', () => {
  const run = (variables: PLCVariable[], dataTypes: PLCDataType[]) =>
    injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: variables.filter((v) => v.class === 'input'),
      outputVariables: variables.filter((v) => v.class === 'output'),
      originalCode: '',
      pouName: 'test',
      inbound: { dataTypes, direction: 'in' },
      outbound: { dataTypes, direction: 'out' },
    })

  it('declares a structure as a slotted class, so the user writes m.speed', () => {
    // The wire format is flat, but the block should read like ST. `__slots__`
    // also makes an assignment to a name the structure lacks raise, rather than
    // silently creating an attribute the PLC will never read back.
    const result = run([userTyped('m', 'input', 'Motor')], [MOTOR])

    expect(result).toContain('class Motor:')
    expect(result).toContain("__slots__ = ('speed', 'label')")
    expect(result).toContain('def __init__(self, speed=None, label=None):')
  })

  it('gives a one-member structure a trailing comma, so __slots__ is a tuple', () => {
    // `('speed')` is the string, not a one-element tuple, and Python would then
    // treat every character as a slot name.
    const single: PLCDataType = {
      name: 'One',
      derivation: 'structure',
      variable: [{ name: 'speed', type: { definition: 'base-type', value: 'int' } }],
    }
    const result = run([userTyped('o', 'input', 'One')], [single])

    expect(result).toContain("__slots__ = ('speed',)")
  })

  it('declares an enumeration as an IntEnum, so mode == Mode.RUNNING reads naturally', () => {
    const result = run([userTyped('md', 'input', 'Mode')], [MODE])

    expect(result).toContain('from enum import IntEnum')
    expect(result).toContain('class Mode(IntEnum):')
    expect(result).toContain('    STOPPED = 0')
    expect(result).toContain('    RUNNING = 1')
  })

  it('declares a nested structure before the one that constructs it', () => {
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'drive', type: { definition: 'user-data-type', value: 'Motor' } }],
    }
    const result = run([userTyped('r', 'input', 'Rig')], [rig, MOTOR])

    expect(result.indexOf('class Motor:')).toBeLessThan(result.indexOf('class Rig:'))
  })

  it('declares each type once even when several variables use it', () => {
    const result = run([userTyped('a', 'input', 'Motor'), userTyped('b', 'input', 'Motor')], [MOTOR])

    expect(result.match(/class Motor:/g)).toHaveLength(1)
  })

  it('says so plainly when a block uses no composite type', () => {
    const result = run([makeScalarVar('x', 'input', 'INT')], [MOTOR])

    expect(result).toContain('# This block uses no structures, enumerations or function block instances')
    expect(result).not.toContain('class Motor:')
  })

  it('rebuilds a structure from its consecutive leaves', () => {
    const result = run([userTyped('m', 'input', 'Motor')], [MOTOR])

    expect(result).toContain('_m_speed = _vals[_idx]')
    expect(result).toContain('m = Motor(speed=_m_speed, label=_m_label)')
  })

  it('rebuilds a nested structure innermost first', () => {
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'drive', type: { definition: 'user-data-type', value: 'Motor' } }],
    }
    const result = run([userTyped('r', 'input', 'Rig')], [rig, MOTOR])

    expect(result).toContain('r = Rig(drive=Motor(speed=_r_drive_speed, label=_r_drive_label))')
  })

  it('wraps a structure member that is an enumeration', () => {
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'state', type: { definition: 'user-data-type', value: 'Mode' } }],
    }
    const result = run([userTyped('r', 'input', 'Rig')], [rig, MODE])

    expect(result).toContain('r = Rig(state=Mode(_r_state))')
  })

  it('wraps a top-level enumeration in its IntEnum after decoding', () => {
    const result = run([userTyped('md', 'input', 'Mode')], [MODE])

    expect(result).toContain('md = Mode(md)')
  })

  it('packs a structure member by member, through the attribute path', () => {
    const result = run([userTyped('m', 'output', 'Motor')], [MOTOR])

    expect(result).toContain('_out.append(m.speed)')
    expect(result).toContain("_body = m.label.encode('utf-8')[:126]")
  })

  it('packs an enumeration as its integer, explicitly', () => {
    const result = run([userTyped('md', 'output', 'Mode')], [MODE])

    expect(result).toContain('_out.append(int(md))')
  })

  it('ignores a named ARRAY type when declaring classes', () => {
    // It cannot cross, and the build is refused upstream; there is no class to
    // declare for it either way.
    const named: PLCDataType = {
      name: 'Bank',
      derivation: 'array',
      baseType: { definition: 'base-type', value: 'INT' },
      dimensions: [{ dimension: '0..3' }],
    }
    const result = run([userTyped('b', 'input', 'Bank')], [named])

    expect(result).toContain('# This block uses no structures, enumerations or function block instances')
  })

  it('declares nothing for an instance whose block cannot be resolved', () => {
    // With no library and no project POU there are no pins to expose. The build
    // is refused upstream; here there is simply no class to emit.
    const result = run([userTyped('t', 'input', 'TON')], [MOTOR])

    expect(result).not.toContain('class TON:')
  })

  it('declares a structure reached through an array element type', () => {
    const bank: PLCVariable = {
      name: 'bank',
      class: 'input',
      type: {
        definition: 'array',
        value: 'ARRAY [0..1] OF Motor',
        data: {
          baseType: { definition: 'user-data-type', value: 'Motor' },
          dimensions: [{ dimension: '0..1' }],
        },
      },
      location: '',
      documentation: '',
      debug: false,
    }
    const result = run([bank], [MOTOR])

    expect(result).toContain('class Motor:')
  })
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
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
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain('# No output variables to write')
  })
})

describe('a function block pin that is itself composite', () => {
  // The walk emits a temporary per LEAF, never one for the composite. A
  // structure MEMBER already got that recursion; a pin did not, so the
  // constructor named `_drv_CFG` — which the decode never assigns — and the
  // module raised `NameError` before `block_init()`. Reproduced through
  // openplc-cli before fixing.
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
  /** A library block whose input pin is a structure and whose output is an enum. */
  const DRIVE_LIB = {
    functionBlocks: [
      {
        name: 'DRIVE',
        inputs: [{ name: 'CFG', type: 'Motor' }],
        inouts: [],
        outputs: [{ name: 'STATE', type: 'Mode' }],
      },
    ],
  }
  const drv: PLCVariable = {
    name: 'drv',
    class: 'local',
    type: { definition: 'derived', value: 'DRIVE' },
    location: '',
    documentation: '',
    debug: false,
  }
  const run = () =>
    injectPythonRuntime({
      fmtIn: '=',
      fmtOut: '=',
      inputVariables: [drv],
      outputVariables: [drv],
      originalCode: '',
      pouName: 'test',
      inbound: { dataTypes: [MOTOR, MODE], libraries: [DRIVE_LIB], direction: 'in' },
      outbound: { dataTypes: [MOTOR, MODE], libraries: [DRIVE_LIB], direction: 'out' },
    })

  it('builds a structure pin from the member temporaries the decode produced', () => {
    expect(run()).toContain('CFG=Motor(speed=_drv_CFG_speed, label=_drv_CFG_label)')
  })

  it('never names a temporary for the composite itself', () => {
    // `_drv_CFG` alone is the bug: assigned nowhere, referenced by the ctor.
    expect(run()).not.toMatch(/CFG=_drv_CFG[,)]/)
  })

  it('wraps an enumeration pin back into its class', () => {
    expect(run()).toContain('STATE=Mode(_drv_STATE)')
  })

  it('declares the classes reached only through a pin', () => {
    // `collectReferencedTypes` stopped at the instance, so a structure used
    // only as a pin type was never declared and the ctor named a missing class.
    const result = run()
    expect(result).toContain('class Motor:')
    expect(result).toContain('class Mode(IntEnum):')
  })

  it('declares a pin type before the block class that constructs it', () => {
    const result = run()
    expect(result.indexOf('class Motor:')).toBeLessThan(result.indexOf('class DRIVE:'))
  })
})
