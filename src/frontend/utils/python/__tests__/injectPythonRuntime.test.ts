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

    // The table is the contract now: one row per pin, with the instance's class
    // named at its node so the fixed runtime can construct it.
    for (const pin of ['IN', 'PT', 'Q', 'ET']) {
      expect(result).toContain(`(('ton0', '${pin}'), ('TON', None),`)
    }
  })

  it('rebuilds it from only the drivable pins when seeding outputs', () => {
    // The seed decodes the outbound layout, which has no output pins in it.
    // Naming one here is what killed the block with `NameError: _ton0_Q`.
    const result = run([instance('ton0')])
    const outTable = result.slice(result.indexOf('_SHM_OUT = ('), result.indexOf('# ====='))

    // Only the drivable pins appear in the OUT table.
    expect(outTable).toContain(`(('ton0', 'IN'), ('TON', None),`)
    expect(outTable).toContain(`(('ton0', 'PT'), ('TON', None),`)
    expect(outTable).not.toContain(`(('ton0', 'Q'),`)
  })

  it('packs only the drivable pins back', () => {
    // One table drives both directions of the exchange, so "what is packed" is
    // the same question as "what is in the OUT table" — there is no separate
    // pack code that could disagree with it.
    const result = run([instance('ton0')])
    const outTable = result.slice(result.indexOf('_SHM_OUT = ('), result.indexOf('# ====='))

    expect(outTable).toContain(`(('ton0', 'IN'),`)
    expect(outTable).not.toContain(`(('ton0', 'Q'),`)
    expect(result).toContain('_shm_pack(shm_out.buf, _SHM_OUT, globals())')
  })

  it('upper-cases a pin the project declared in lower case', () => {
    // The compiler upper-cases members, and the Python attribute has to match
    // the slot it was constructed with.
    const lower = {
      functionBlocks: [{ name: 'ACC', inputs: [{ name: 'step', type: 'INT' }], inouts: [], outputs: [] }],
    }
    const acc: PLCVariable = { ...instance('acc'), type: { definition: 'derived', value: 'ACC' } }
    const result = injectPythonRuntime({
      inputVariables: [acc],
      outputVariables: [acc],
      originalCode: '',
      pouName: 'test',
      inbound: { dataTypes: [], libraries: [lower], direction: 'in' },
      outbound: { dataTypes: [], libraries: [lower], direction: 'out' },
    })

    expect(result).toContain("__slots__ = ('STEP',)")
    expect(result).toContain(`(('acc', 'STEP'), ('ACC', None),`)
  })
})

describe('structures and enumerations', () => {
  const run = (variables: PLCVariable[], dataTypes: PLCDataType[]) =>
    injectPythonRuntime({
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

    expect(result).toContain(`(('m', 'speed'), ('Motor', None), 'h',`)
    expect(result).toContain(`(('m', 'label'), ('Motor', None), 'str',`)
  })

  it('rebuilds a nested structure innermost first', () => {
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'drive', type: { definition: 'user-data-type', value: 'Motor' } }],
    }
    const result = run([userTyped('r', 'input', 'Rig')], [rig, MOTOR])

    // The nested class is named at its own node, so the runtime constructs Rig
    // then Motor without the generator having to order anything.
    expect(result).toContain(`(('r', 'drive', 'speed'), ('Rig', 'Motor', None),`)
  })

  it('wraps a structure member that is an enumeration', () => {
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'state', type: { definition: 'user-data-type', value: 'Mode' } }],
    }
    const result = run([userTyped('r', 'input', 'Rig')], [rig, MODE])

    expect(result).toContain(`(('r', 'state'), ('Rig', None), 'h', 0, 2, 'Mode')`)
  })

  it('wraps a top-level enumeration in its IntEnum after decoding', () => {
    const result = run([userTyped('md', 'input', 'Mode')], [MODE])

    expect(result).toContain(`(('md',), (None,), 'h', 0, 2, 'Mode')`)
  })

  it('packs a structure member by member, through the attribute path', () => {
    const result = run([userTyped('m', 'output', 'Motor')], [MOTOR])

    expect(result).toContain(`(('m', 'speed'), ('Motor', None), 'h',`)
  })

  it('packs an enumeration as its integer, explicitly', () => {
    const result = run([userTyped('md', 'output', 'Mode')], [MODE])

    // The runtime coerces an enum with int(); the table only has to say which
    // class it is.
    expect(result).toContain(`'Mode')`)
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
  // the length the C side writes counts code units rather than bytes.
  //
  // The distinction now lives in the FIXED runtime, not in generated code, so
  // what the table has to get right is which of the two a field is and how wide
  // it therefore is. The encode/decode itself is pinned by the runtime fixture
  // and exercised by the Python round-trip test.
  const run = (variables: PLCVariable[]) =>
    injectPythonRuntime({
      inputVariables: variables.filter((v) => v.class === 'input'),
      outputVariables: variables.filter((v) => v.class === 'output'),
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

  it('marks a WSTRING field wstr, at one length byte plus two bytes per code unit', () => {
    const result = run([makeWStringVar('label', 'input')])

    expect(result).toContain(`(('label',), (None,), 'wstr', 0, 253, None)`)
  })

  it('marks a STRING field str, at one length byte plus one byte per character', () => {
    const result = run([makeStringVar('label', 'input')])

    expect(result).toContain(`(('label',), (None,), 'str', 0, 127, None)`)
  })

  it('keeps the two apart in the same table, so neither inherits the other width', () => {
    const result = run([makeStringVar('narrow', 'input'), makeWStringVar('wide', 'input')])

    expect(result).toContain(`(('narrow',), (None,), 'str', 0, 127, None)`)
    // 127 bytes on, not 254: the widths differ and the offsets prove it.
    expect(result).toContain(`(('wide',), (None,), 'wstr', 127, 253, None)`)
  })
})

describe('injectPythonRuntime', () => {
  it('injects runtime wrapper around original code with no variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [],
      originalCode: 'def block_init():\n    pass\ndef block_loop():\n    pass',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain('def block_init():')
    expect(result).toContain('def block_loop():')
    // No format strings any more: the tables are the layout and the runtime
    // reads them.
    expect(result).toContain('_SHM_IN = ()')
    expect(result).toContain('_SHM_OUT = ()')
    expect(result).toContain('data_size_in = _shm_total(_SHM_IN)')
    expect(result).toContain('_shm_unpack(shm_in.buf, _SHM_IN, globals())')
    expect(result).toContain('_shm_pack(shm_out.buf, _SHM_OUT, globals())')
    expect(result).toContain('plc_pid = %d')
    expect(result).toContain('block_init()')
    expect(result).toContain('block_loop()')
    expect(result).toContain('Stopping Python block: test')
    expect(result).toContain('shm_in.close()')
    expect(result).toContain('shm_out.close()')
  })

  it('generates input unpack code for scalar variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('temp', 'input', 'REAL')],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    // Two rows, packed back to back, and one call that reads them. There is no
    // per-variable decode statement left to get wrong.
    expect(result).toContain(`(('speed',), (None,), 'h', 0, 2, None)`)
    expect(result).toContain(`(('temp',), (None,), 'f', 2, 4, None)`)
    expect(result).toContain('_shm_unpack(shm_in.buf, _SHM_IN, globals())')
  })

  it('generates output pack code for scalar variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [makeScalarVar('result', 'output', 'INT'), makeScalarVar('flag', 'output', 'BOOL')],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain(`(('result',), (None,), 'h', 0, 2, None)`)
    expect(result).toContain(`(('flag',), (None,), 'B', 2, 1, None)`)
    expect(result).toContain('_shm_pack(shm_out.buf, _SHM_OUT, globals())')
  })

  it('generates input unpack code for array variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [makeArrayVar('data', 'input', 'INT', '0..4')],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    // One row per element, at the DECLARED IEC index — this fixture is `0..4`,
    // so `data[0]`..`data[4]`. The old model handed Python a 0-based list
    // whatever the lower bound was, while the C side used `startIndex + i`, so a
    // 1-based array disagreed by one on every element. The runtime rebuilds the
    // list from the indices in the table, so the two cannot part company.
    expect(result).toContain(`(('data', 0), (None, None), 'h', 0, 2, None)`)
    expect(result).toContain(`(('data', 4), (None, None), 'h', 8, 2, None)`)
  })

  it('generates output pack code for array variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [makeArrayVar('temps', 'output', 'REAL', '0..2')],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })
  })

  it('generates input unpack code for string variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [makeStringVar('msg', 'input')],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })
    expect(result).toContain(`(('msg',), (None,), 'str', 0, 127, None)`)
  })

  it('generates output pack code for string variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [makeStringVar('msg', 'output')],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain(`(('msg',), (None,), 'str', 0, 127, None)`)
  })

  it('seeds scalar outputs from shared memory, not from the declaration', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [makeScalarVar('count', 'output', 'INT')],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    // The old behaviour set `count = 0` from the declaration and wrote that
    // back on the first cycle, destroying whatever the PLC held.
    expect(result).toContain('_shm_unpack(shm_out.buf, _SHM_OUT, globals())')
    expect(result).not.toContain('count = 0')
  })

  it('seeds array outputs from shared memory', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [makeArrayVar('arr', 'output', 'INT', '0..2')],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toMatch(/\(\('arr', 0\), \(None, None\), '[a-z]', 0, \d+, None\)/)
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
      inputVariables: [],
      outputVariables: [outputVar],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain(`(('msg',), (None,), 'str', 0, 127, None)`)
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
  })

  it('seeds before block_init so the user sees real values in it', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [makeScalarVar('count', 'output', 'INT')],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    // The seed still has to run before block_init(), so the user's init sees
    // real PLC values rather than defaults.
    expect(result.indexOf('_shm_unpack(shm_out.buf, _SHM_OUT, globals())')).toBeLessThan(result.indexOf('block_init()'))
    // The size must be resolved before the seed reads that many bytes, and the
    // size check must precede both.
    expect(result.indexOf('data_size_out = _shm_total(_SHM_OUT)')).toBeLessThan(
      result.indexOf('_shm_unpack(shm_out.buf, _SHM_OUT, globals())'),
    )
  })

  it('says so plainly when there are no outputs to seed', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain('_SHM_OUT = ()')
  })

  it('outputs comment for no input variables', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain('_SHM_IN = ()')
  })

  it('outputs comment for no output variables in write section', () => {
    const result = injectPythonRuntime({
      inputVariables: [],
      outputVariables: [],
      originalCode: '',
      pouName: 'test',
      inbound: { direction: 'in' },
      outbound: { direction: 'out' },
    })

    expect(result).toContain('_SHM_OUT = ()')
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
      inputVariables: [drv],
      outputVariables: [drv],
      originalCode: '',
      pouName: 'test',
      inbound: { dataTypes: [MOTOR, MODE], libraries: [DRIVE_LIB], direction: 'in' },
      outbound: { dataTypes: [MOTOR, MODE], libraries: [DRIVE_LIB], direction: 'out' },
    })

  it('builds a structure pin from the member temporaries the decode produced', () => {
    // The pin's own class is named at its node, so the runtime constructs the
    // Motor without the generator emitting a constructor call for it.
    expect(run()).toContain(`(('drv', 'CFG', 'speed'), ('DRIVE', 'Motor', None),`)
    expect(run()).toContain(`(('drv', 'CFG', 'label'), ('DRIVE', 'Motor', None),`)
  })

  it('never names a temporary for the composite itself', () => {
    // `_drv_CFG` alone is the bug: assigned nowhere, referenced by the ctor.
    expect(run()).not.toMatch(/CFG=_drv_CFG[,)]/)
  })

  it('wraps an enumeration pin back into its class', () => {
    expect(run()).toContain(`(('drv', 'STATE'), ('DRIVE', None), 'h', 129, 2, 'Mode')`)
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
