import type { PLCDataType, PLCVariable } from '../../../../middleware/shared/ports/types'
import type { ShmWalkContext } from '../shm-leaves'
import { describeShmLayout, describeShmLeaves, pythonFunctionBlockInstances } from '../shm-leaves'

const scalar = (name: string, value: string): PLCVariable => ({
  name,
  class: 'input',
  type: { definition: 'base-type', value },
  location: '',
  documentation: '',
  debug: false,
})

const userTyped = (name: string, value: string): PLCVariable => ({
  name,
  class: 'input',
  type: { definition: 'user-data-type', value },
  location: '',
  documentation: '',
  debug: false,
})

const arrayOf = (name: string, baseType: string, dimension = '0..3'): PLCVariable => ({
  name,
  class: 'input',
  type: {
    definition: 'array',
    value: `ARRAY [${dimension}] OF ${baseType}`,
    data: { baseType: { definition: 'base-type', value: baseType }, dimensions: [{ dimension }] },
  },
  location: '',
  documentation: '',
  debug: false,
})

/** An array of arbitrary rank, for the one-dimension-only rule. */
const arrayOfRank = (
  name: string,
  baseType: string,
  dimensions: string[],
  baseDefinition: 'base-type' | 'user-data-type' = 'base-type',
): PLCVariable => ({
  name,
  class: 'input',
  type: {
    definition: 'array',
    value: `ARRAY [${dimensions.join(',')}] OF ${baseType}`,
    data: {
      baseType: { definition: baseDefinition, value: baseType },
      dimensions: dimensions.map((dimension) => ({ dimension })),
    },
  },
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

/**
 * The inbound direction, which is the wider one — for a function block instance
 * it carries the outputs as well as the inputs. Tests that care about direction
 * pass their own.
 */
const inbound = (dataTypes: PLCDataType[] = []): ShmWalkContext => ({ dataTypes, direction: 'in' })

/** A library declaring TON, in the shape a `.stlib` manifest provides. */
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

const leavesOf = (result: ReturnType<typeof describeShmLeaves>) => ('leaves' in result ? result.leaves : [])
const refusalOf = (result: ReturnType<typeof describeShmLeaves>) => ('refusal' in result ? result.refusal : null)

describe('describeShmLeaves', () => {
  it('describes a scalar as one leaf reaching the member directly', () => {
    const [leaf] = leavesOf(describeShmLeaves(scalar('x', 'INT'), inbound()))

    expect(leaf.field).toBe('x')
    expect(leaf.path).toEqual(['x'])
    expect(leaf.access).toBe('X')
    expect(leaf.count).toBe(1)
  })

  it('describes an array as one leaf with its element count and lower bound', () => {
    const [leaf] = leavesOf(describeShmLeaves(arrayOf('data', 'INT', '2..5'), inbound()))

    expect(leaf.count).toBe(4)
    expect(leaf.startIndex).toBe(2)
  })

  it('flattens a structure into one leaf per member, in declaration order', () => {
    const leaves = leavesOf(describeShmLeaves(userTyped('m', 'Motor'), inbound([MOTOR])))

    expect(leaves.map((l) => l.field)).toEqual(['m_speed', 'm_label'])
    expect(leaves.map((l) => l.path)).toEqual([
      ['m', 'speed'],
      ['m', 'label'],
    ])
    expect(leaves.map((l) => l.access)).toEqual(['M.SPEED', 'M.LABEL'])
  })

  it('flattens rather than nesting, so neither side computes padding', () => {
    // `#pragma pack` applies to the struct being defined, never to a member type
    // already laid out — the trap that made WSTRING 254 bytes against Python's
    // 253. Every leaf sits at the top level of one packed struct.
    const leaves = leavesOf(describeShmLeaves(userTyped('m', 'Motor'), inbound([MOTOR])))

    expect(leaves.every((l) => !l.field.includes('.'))).toBe(true)
  })

  it('flattens a nested structure through both levels', () => {
    const outer: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'drive', type: { definition: 'user-data-type', value: 'Motor' } }],
    }
    const leaves = leavesOf(describeShmLeaves(userTyped('r', 'Rig'), inbound([outer, MOTOR])))

    expect(leaves.map((l) => l.field)).toEqual(['r_drive_speed', 'r_drive_label'])
    expect(leaves.map((l) => l.access)).toEqual(['R.DRIVE.SPEED', 'R.DRIVE.LABEL'])
  })

  it('describes an enumeration as its stored integer, naming the type for Python', () => {
    const [leaf] = leavesOf(describeShmLeaves(userTyped('md', 'Mode'), inbound([MODE])))

    expect(leaf.descriptor.cType).toBe('int16_t')
    expect(leaf.enumTypeName).toBe('Mode')
    // The access stays assignable; the emitter casts through the wrapper, since
    // an IEC_ENUM_Var yields an IEC_ENUM_Value that converts to the scoped enum
    // but not to an integer.
    expect(leaf.access).toBe('MD')
  })

  it('mangles a member named after its own type, as the compiler does', () => {
    // GCC rejects a member that changes the meaning of its type name inside the
    // class, so STruC++ emits a trailing underscore. CODESYS allows
    // `RunningLights : RunningLights` and real projects use it.
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'mode', type: { definition: 'user-data-type', value: 'Mode' } }],
    }
    const [leaf] = leavesOf(describeShmLeaves(userTyped('r', 'Rig'), inbound([rig, MODE])))

    expect(leaf.access).toBe('R.MODE_')
  })

  it('does not mangle a member whose name merely matches an elementary type', () => {
    // `Time : TIME` is an ordinary declaration the compiler emits unmangled;
    // mangling it would name a `TIME_` member that does not exist.
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [{ name: 'time', type: { definition: 'base-type', value: 'TIME' } }],
    }
    const [leaf] = leavesOf(describeShmLeaves(userTyped('r', 'Rig'), inbound([rig])))

    expect(leaf.access).toBe('R.TIME')
  })

  it('describes an array nested inside a structure', () => {
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [
        {
          name: 'trims',
          type: {
            definition: 'array',
            value: 'ARRAY [1..3] OF INT',
            data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '1..3' }] },
          },
        },
      ],
    }
    const [leaf] = leavesOf(describeShmLeaves(userTyped('r', 'Rig'), inbound([rig])))

    expect(leaf.count).toBe(3)
    expect(leaf.startIndex).toBe(1)
    expect(leaf.access).toBe('R.TRIMS')
  })

  it('refuses an array member whose dimension text is malformed', () => {
    // An unparsable range makes `getArrayTotalElements` return 0. That used to
    // fall through to the scalar path — one field against an array member — and
    // the old test asserted only `startIndex`, so it executed the bug without
    // pinning it. The size of the field is unknown, so the only safe answer is
    // to refuse.
    const rig: PLCDataType = {
      name: 'Rig',
      derivation: 'structure',
      variable: [
        {
          name: 'trims',
          type: {
            definition: 'array',
            value: 'ARRAY [?] OF INT',
            data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: 'nonsense' }] },
          },
        },
      ],
    }
    expect(refusalOf(describeShmLeaves(userTyped('r', 'Rig'), inbound([rig])))?.reason).toContain(
      'array bounds cannot be read',
    )
  })

  it('refuses an array declaration carrying no dimension data rather than guessing', () => {
    // Without `data` there is no element type and no count. Describing it as
    // one scalar would put a single field where the C side may write many.
    const bare: PLCVariable = {
      name: 'data',
      class: 'input',
      type: { definition: 'array', value: 'ARRAY [0..3] OF INT' },
      location: '',
      documentation: '',
      debug: false,
    }

    expect(refusalOf(describeShmLeaves(bare, inbound()))?.reason).toContain('not a type a Python block can exchange')
  })

  describe('function block instances', () => {
    // Python cannot call an instance, but the generated ST wrapper does, once per
    // scan, in the PLC process where the instance lives. So the pins cross like a
    // structure's members — and which ones cross depends on the direction, because
    // the block's inputs are the caller's to drive and its outputs are the
    // instance's to produce.
    const ton = (name: string): PLCVariable => ({
      name,
      class: 'local',
      type: { definition: 'derived', value: 'TON' },
      location: '',
      documentation: '',
      debug: false,
    })
    const ctx = (direction: 'in' | 'out'): ShmWalkContext => ({ dataTypes: [], libraries: [TON_LIB], direction })

    it('carries every pin inbound, so Python can read what the instance produced', () => {
      const leaves = leavesOf(describeShmLeaves(ton('ton0'), ctx('in')))

      expect(leaves.map((l) => l.field)).toEqual(['ton0_IN', 'ton0_PT', 'ton0_Q', 'ton0_ET'])
    })

    it('carries only the drivable pins outbound, so Python cannot forge an output', () => {
      const leaves = leavesOf(describeShmLeaves(ton('ton0'), ctx('out')))

      expect(leaves.map((l) => l.field)).toEqual(['ton0_IN', 'ton0_PT'])
    })

    it('reaches each pin as an upper-cased member of the instance', () => {
      const leaves = leavesOf(describeShmLeaves(ton('ton0'), ctx('in')))

      expect(leaves.map((l) => l.access)).toEqual(['TON0.IN', 'TON0.PT', 'TON0.Q', 'TON0.ET'])
    })

    it('describes each pin with its own IEC type', () => {
      const leaves = leavesOf(describeShmLeaves(ton('ton0'), ctx('in')))

      expect(leaves.map((l) => l.descriptor.cType)).toEqual(['uint8_t', 'int64_t', 'uint8_t', 'int64_t'])
    })

    it('gives Python an attribute path per pin', () => {
      const leaves = leavesOf(describeShmLeaves(ton('ton0'), ctx('in')))

      expect(leaves.map((l) => l.path)).toEqual([
        ['ton0', 'IN'],
        ['ton0', 'PT'],
        ['ton0', 'Q'],
        ['ton0', 'ET'],
      ])
    })

    it('leaves a project block’s internal state out entirely', () => {
      // A block's own locals are its business; letting Python write them would
      // corrupt the instance from outside. Only a project-declared block can
      // have them — a library manifest lists pins only.
      const withLocal = {
        name: 'Accum',
        pouType: 'function-block' as const,
        interface: {
          variables: [
            {
              name: 'step',
              class: 'input' as const,
              type: { definition: 'base-type' as const, value: 'INT' },
              location: '',
              documentation: '',
            },
            {
              name: 'carry',
              class: 'local' as const,
              type: { definition: 'base-type' as const, value: 'DINT' },
              location: '',
              documentation: '',
            },
            {
              name: 'total',
              class: 'output' as const,
              type: { definition: 'base-type' as const, value: 'DINT' },
              location: '',
              documentation: '',
            },
          ],
        },
        body: { language: 'st' as const, value: '' },
      }
      const acc: PLCVariable = { ...ton('acc'), type: { definition: 'derived', value: 'Accum' } }
      const leaves = leavesOf(describeShmLeaves(acc, { dataTypes: [], pous: [withLocal], direction: 'in' }))

      expect(leaves.map((l) => l.field)).toEqual(['acc_STEP', 'acc_TOTAL'])
    })

    it('accepts a library pin spelled with a registry alias (TIME_OF_DAY)', () => {
      // The path the alias gap was actually reachable through: a `.stlib`
      // manifest carries bare IEC type names, and TOD's alias is a legal
      // spelling there. The hand-written table had only `tod`, so this refused
      // the whole block; the registry knows both.
      const aliasLib = {
        functionBlocks: [
          {
            name: 'CLOCK',
            inputs: [{ name: 'AT', type: 'TIME_OF_DAY' }],
            inouts: [],
            outputs: [{ name: 'STAMP', type: 'DATE_AND_TIME' }],
          },
        ],
      }
      const instance: PLCVariable = { ...ton('c'), type: { definition: 'derived', value: 'CLOCK' } }
      const leaves = leavesOf(describeShmLeaves(instance, { dataTypes: [], libraries: [aliasLib], direction: 'in' }))

      expect(leaves.map((l) => l.field)).toEqual(['c_AT', 'c_STAMP'])
      // Both are 64-bit counts, taken from the registry's byteSize.
      expect(leaves.every((l) => l.descriptor.size === 8)).toBe(true)
    })

    it('refuses an instance whose pin is a multi-dimensional array', () => {
      // The rank rule applies to a block's pins too, not only to the variables
      // the Python POU declares itself — an instance's pins cross the same
      // boundary and are emitted by the same exchange.
      const gridBlock = {
        name: 'Grid',
        pouType: 'function-block' as const,
        interface: {
          variables: [
            {
              name: 'cells',
              class: 'input' as const,
              type: {
                definition: 'array' as const,
                value: 'ARRAY [0..1,0..1] OF INT',
                data: {
                  baseType: { definition: 'base-type' as const, value: 'INT' },
                  dimensions: [{ dimension: '0..1' }, { dimension: '0..1' }],
                },
              },
              location: '',
              documentation: '',
            },
          ],
        },
        body: { language: 'st' as const, value: '' },
      }
      const instance: PLCVariable = { ...ton('g'), type: { definition: 'derived', value: 'Grid' } }
      const refusal = refusalOf(describeShmLeaves(instance, { dataTypes: [], pous: [gridBlock], direction: 'in' }))

      expect(refusal?.reason).toContain('2-dimensional array cannot cross into Python')
      expect(refusal?.path).toEqual(['g', 'CELLS'])
    })

    it('omits a library block’s pins that are not declared', () => {
      // A block's own locals are its business; letting Python write them would
      // corrupt the instance from outside.
      const withLocals = {
        functionBlocks: [
          {
            name: 'ACC',
            inputs: [{ name: 'STEP', type: 'INT' }],
            inouts: [],
            outputs: [{ name: 'TOTAL', type: 'DINT' }],
          },
        ],
      }
      const acc: PLCVariable = { ...ton('acc'), type: { definition: 'derived', value: 'ACC' } }
      const leaves = leavesOf(describeShmLeaves(acc, { dataTypes: [], libraries: [withLocals], direction: 'in' }))

      expect(leaves.map((l) => l.field)).toEqual(['acc_STEP', 'acc_TOTAL'])
    })

    it('resolves a project-declared block, which shadows a library of the same name', () => {
      const projectPou = {
        name: 'TON',
        pouType: 'function-block' as const,
        interface: {
          variables: [
            {
              name: 'mine',
              class: 'input' as const,
              type: { definition: 'base-type' as const, value: 'INT' },
              location: '',
              documentation: '',
            },
          ],
        },
        body: { language: 'st' as const, value: '' },
      }
      const leaves = leavesOf(
        describeShmLeaves(ton('t'), { dataTypes: [], pous: [projectPou], libraries: [TON_LIB], direction: 'in' }),
      )

      // Upper-cased even though the project declared it lowercase: the compiler
      // upper-cases members, and the Python attribute has to match the slot.
      expect(leaves.map((l) => l.field)).toEqual(['t_MINE'])
    })
  })

  describe('pythonFunctionBlockInstances', () => {
    it('finds the instances the wrapper has to call, in declaration order', () => {
      const vars: PLCVariable[] = [
        scalar('x', 'INT'),
        { ...scalar('b', 'INT'), type: { definition: 'derived', value: 'TON' } },
        userTyped('m', 'Motor'),
        { ...scalar('a', 'INT'), type: { definition: 'derived', value: 'ACC' } },
      ]

      expect(pythonFunctionBlockInstances(vars, [MOTOR]).map((v) => v.name)).toEqual(['b', 'a'])
    })

    it('does not mistake a declared structure for an instance', () => {
      expect(pythonFunctionBlockInstances([userTyped('m', 'Motor')], [MOTOR])).toEqual([])
    })

    it('treats a name the project does not declare as an instance', () => {
      // The parser leaves it `user-data-type` when it resolved nothing; from here
      // that is the same situation as `derived`.
      expect(pythonFunctionBlockInstances([userTyped('t', 'TON')], [MOTOR]).map((v) => v.name)).toEqual(['t'])
    })
  })

  describe('refusals', () => {
    it('refuses an instance whose block cannot be found anywhere', () => {
      // No project POU and no library declares it, so there are no pins to walk.
      // The reason says that rather than blaming the type.
      const refusal = refusalOf(describeShmLeaves(userTyped('t', 'Nowhere'), inbound([MOTOR])))

      expect(refusal?.reason).toContain('no function block by that name was found')
    })

    it('refuses an array of function block instances', () => {
      const bank: PLCVariable = {
        name: 'bank',
        class: 'local',
        type: {
          definition: 'array',
          value: 'ARRAY [0..1] OF TON',
          data: { baseType: { definition: 'user-data-type', value: 'TON' }, dimensions: [{ dimension: '0..1' }] },
        },
        location: '',
        documentation: '',
        debug: false,
      }

      expect(refusalOf(describeShmLeaves(bank, { ...inbound(), libraries: [TON_LIB] }))?.reason).toContain(
        'array of function block instances',
      )
    })

    it('refuses an instance whose pin type cannot cross, naming the pin', () => {
      // A generic pin (`ANY_NUM`) has no type until it is wired, so there is no
      // width to marshal.
      const generic = {
        functionBlocks: [{ name: 'ADD', inputs: [{ name: 'IN1', type: 'ANY_NUM' }], outputs: [], inouts: [] }],
      }
      const refusal = refusalOf(describeShmLeaves(userTyped('a', 'ADD'), { ...inbound(), libraries: [generic] }))

      expect(refusal?.path).toEqual(['a', 'IN1'])
    })

    it('refuses an array of structures', () => {
      const bank = arrayOf('bank', 'Motor')
      bank.type.data!.baseType = { definition: 'user-data-type', value: 'Motor' }

      expect(refusalOf(describeShmLeaves(bank, inbound([MOTOR])))?.reason).toContain('array of structures')
    })

    it('refuses a named ARRAY type', () => {
      const named: PLCDataType = {
        name: 'Bank',
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'INT' },
        dimensions: [{ dimension: '0..3' }],
      }

      expect(refusalOf(describeShmLeaves(userTyped('b', 'Bank'), inbound([named])))?.reason).toContain(
        'named ARRAY type',
      )
    })

    it('refuses an unsupported elementary type', () => {
      const reason = refusalOf(describeShmLeaves(scalar('x', 'float32'), inbound()))?.reason
      // The reason lists what IS supported, so the message stands on its own —
      // an FB-instance refusal needs a different explanation entirely, and a
      // single trailing list would be wrong for one of them.
      expect(reason).toContain('FLOAT32 is not a type a Python block can exchange')
      expect(reason).toContain('STRING, WSTRING')
    })

    it('names the member that cannot cross, not the variable containing it', () => {
      const rig: PLCDataType = {
        name: 'Rig',
        derivation: 'structure',
        variable: [{ name: 'timer', type: { definition: 'user-data-type', value: 'TON' } }],
      }
      const refusal = refusalOf(describeShmLeaves(userTyped('r', 'Rig'), inbound([rig])))

      expect(refusal?.path).toEqual(['r', 'timer'])
    })

    it('refuses a structure that contains itself rather than recursing forever', () => {
      const loop: PLCDataType = {
        name: 'Loop',
        derivation: 'structure',
        variable: [{ name: 'inner', type: { definition: 'user-data-type', value: 'Loop' } }],
      }

      expect(refusalOf(describeShmLeaves(userTyped('l', 'Loop'), inbound([loop])))?.reason).toContain(
        'refers to itself',
      )
    })
  })
})

describe('describeShmLayout', () => {
  it('concatenates every variable’s leaves in order', () => {
    const result = describeShmLayout([scalar('a', 'INT'), userTyped('m', 'Motor')], inbound([MOTOR]))

    expect(leavesOf(result).map((l) => l.field)).toEqual(['a', 'm_speed', 'm_label'])
  })

  it('reports the first refusal rather than a partial layout', () => {
    // A partial layout is the corruption this design exists to prevent: a
    // missing field shifts every later field's offset.
    const result = describeShmLayout([scalar('a', 'INT'), userTyped('t', 'TON')], inbound([MOTOR]))

    expect('refusal' in result).toBe(true)
  })

  it('is empty for no variables', () => {
    expect(leavesOf(describeShmLayout([], inbound()))).toEqual([])
  })
})

describe('describeShmLeaves — array shapes the exchange cannot express', () => {
  // Each of these used to be accepted and then mis-emitted. A refusal is the
  // contract (AC 3): marshal correctly, or say why not. Silence was the one
  // outcome ruled out, because a leaf the format string mis-sizes shifts every
  // field after it and the corruption surfaces on an unrelated variable.

  it('refuses a two-dimensional array, naming the rank and the way out', () => {
    const refusal = refusalOf(describeShmLeaves(arrayOfRank('grid', 'INT', ['0..1', '0..2']), inbound()))
    expect(refusal?.reason).toContain('2-dimensional array cannot cross into Python')
    expect(refusal?.reason).toContain('one-dimensional arrays only')
  })

  it('refuses a three-dimensional array', () => {
    const refusal = refusalOf(describeShmLeaves(arrayOfRank('cube', 'INT', ['0..1', '0..1', '0..1']), inbound()))
    expect(refusal?.reason).toContain('3-dimensional array cannot cross into Python')
  })

  it('accepts a one-dimensional array, so the rank check is not over-broad', () => {
    const [leaf] = leavesOf(describeShmLeaves(arrayOfRank('row', 'INT', ['0..3']), inbound()))
    expect(leaf.isArray).toBe(true)
    expect(leaf.count).toBe(4)
  })

  it('refuses an array of STRING', () => {
    expect(refusalOf(describeShmLeaves(arrayOf('names', 'STRING'), inbound()))?.reason).toContain(
      'an array of STRING cannot cross into Python yet',
    )
  })

  it('refuses an array of WSTRING', () => {
    expect(refusalOf(describeShmLeaves(arrayOf('names', 'WSTRING'), inbound()))?.reason).toContain(
      'an array of WSTRING cannot cross into Python yet',
    )
  })

  it('refuses an array of an enumeration', () => {
    const modes = arrayOfRank('modes', 'Mode', ['0..2'], 'user-data-type')
    const refusal = refusalOf(describeShmLeaves(modes, inbound([MODE])))
    expect(refusal?.reason).toContain('an array of enumerations cannot cross into Python yet')
  })

  it('treats a single-element array as an array, not a scalar', () => {
    // `ARRAY [0..0] OF INT` has count 1. Every emitter used to branch on
    // `count > 1`, so this bound a plain int where the user declared an array —
    // a scalar struct field against an array member on the C side.
    const [leaf] = leavesOf(describeShmLeaves(arrayOf('one', 'INT', '0..0'), inbound()))
    expect(leaf.isArray).toBe(true)
    expect(leaf.count).toBe(1)
    expect(leaf.startIndex).toBe(0)
  })

  it('carries isArray false for a genuine scalar', () => {
    const [leaf] = leavesOf(describeShmLeaves(scalar('x', 'INT'), inbound()))
    expect(leaf.isArray).toBe(false)
    expect(leaf.count).toBe(1)
  })
})
