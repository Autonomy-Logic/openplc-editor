import { DEFAULT_S7_PROFILE, RUNTIME_V4_S7_PROFILE } from '@root/middleware/shared/utils/target-capabilities'
import type { DevicePin } from '@root/middleware/shared/ports/types'
import type { AddressProducerCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { getArrayTotalElements } from '@root/frontend/utils/PLC/array-codegen-helpers'
import type { PLCProjectData, PLCVariable } from '../../types/PLC/open-plc'
import {
  computeIoImage,
  describeDuplicateOutput,
  describeIoImageSizes,
  describeUnbackedLocations,
  describeUnsupportedArea,
  IMAGE_AREAS_BAREMETAL,
  IMAGE_AREAS_RUNTIME_V4,
} from '../steps/compute-io-image'

const ALL_ACTIVE: AddressProducerCapabilities = {
  pinMapping: true,
  vppIo: true,
  modbusTcpMaster: true,
  modbusRtuMaster: true,
  ethercat: true,
}

/** A located variable, with the fields `PLCVariable` requires filled in. */
const variable = (name: string, location: string, type?: PLCVariable['type']): PLCVariable => ({
  name,
  location,
  documentation: '',
  type: type ?? { definition: 'base-type', value: 'BOOL' },
})

/** A located `ARRAY [start..end] OF <base>` variable. */
const arrayVar = (name: string, location: string, start: number, end: number, base = 'WORD'): PLCVariable =>
  variable(name, location, {
    definition: 'array',
    value: `ARRAY [${start}..${end}] OF ${base}`,
    data: {
      baseType: { definition: 'base-type', value: base as 'WORD' },
      dimensions: [{ dimension: `${start}..${end}` }],
    },
  })

function makeProject(options: {
  pous?: Array<{ name: string; variables: PLCVariable[] }>
  globals?: PLCVariable[]
  servers?: unknown[]
  remoteDevices?: unknown[]
}): PLCProjectData {
  return {
    pous: (options.pous ?? []).map((pou) => ({
      type: 'program',
      data: {
        name: pou.name,
        language: 'st',
        variables: pou.variables,
        documentation: '',
        body: { language: 'st', value: '' },
      },
    })),
    dataTypes: [],
    libraries: [],
    servers: options.servers as PLCProjectData['servers'],
    remoteDevices: options.remoteDevices as PLCProjectData['remoteDevices'],
    configuration: { resource: { tasks: [], instances: [], globalVariables: options.globals ?? [] } },
  }
}

/** A local `VAR … AT` in one POU — the common shape in these tests. */
const withLocal = (location: string, name = 'v') =>
  makeProject({ pous: [{ name: 'main', variables: [variable(name, location)] }] })

/** A pin-mapping producer at each of `addresses`. */
const pins = (...addresses: string[]): DevicePin[] =>
  addresses.map((address, index) => ({ pin: `${index}`, pinType: 'digitalInput' as const, address }))

/** A Modbus server exposing `mwCount` memory words. */
const mwServer = (mwCount: number) => [
  { name: 'mb', protocol: 'modbus-tcp', modbusSlaveConfig: { bufferMapping: { holdingRegisters: { mwCount } } } },
]

/** A Modbus master device whose one IO group claims `addresses`. */
const modbusMaster = (...addresses: string[]) => [
  {
    name: 'plc1',
    modbusTcpConfig: {
      ioGroups: [
        {
          id: 'g1',
          ioPoints: addresses.map((iecLocation, index) => ({ id: `p${index}`, iecLocation })),
        },
      ],
    },
  },
]

/** Runtime v4's area set unless a case says otherwise: it is the wider of the
 *  two, so a case about sizing is not accidentally also a case about areas. */
/** A target that runs every server, which is what the exposure cases assume. */
// The suite's default target is Runtime v4 (`areas: IMAGE_AREAS_RUNTIME_V4`),
// so it carries v4's S7 profile: 64 areas and every buffer type. A bare-metal
// case states its own.
const ALL_SERVERS = { modbusTcpServer: true, opcuaServer: true, s7Server: true, s7: RUNTIME_V4_S7_PROFILE }
/** A target that runs none — bare metal, and what a retargeted project meets. */
const NO_SERVERS = { modbusTcpServer: false, opcuaServer: false, s7Server: false }

const compute = (projectData: PLCProjectData, extra: Partial<Parameters<typeof computeIoImage>[0]> = {}) =>
  computeIoImage({
    projectData,
    capabilities: ALL_ACTIVE,
    serverCapabilities: ALL_SERVERS,
    areas: IMAGE_AREAS_RUNTIME_V4,
    ...extra,
  })

describe('computeIoImage — sizing from producers', () => {
  it('sizes nothing for an empty project', () => {
    expect(compute(makeProject({}))).toEqual({
      sizes: {},
      origins: {},
      unbacked: [],
      unsupported: [],
      duplicateOutputs: [],
    })
  })

  it('sizes an area from the pins that claim it', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%IX0.0', '%IX0.1', '%QW0') })
    expect(image.sizes).toEqual({ '%IX': 2, '%QW': 1 })
    expect(image.unbacked).toEqual([])
  })

  it('leaves a class with no producers absent rather than zero-valued', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%QW0') })
    expect(image.sizes['%IX']).toBeUndefined()
    expect(image.sizes['%IX'] ?? 0).toBe(0)
  })

  it('counts a Modbus master group even with no variable declared for it', () => {
    const image = compute(makeProject({ remoteDevices: modbusMaster('%IX0.0', '%IX0.1', '%IX0.2') }))
    expect(image.sizes).toEqual({ '%IX': 3 })
  })

  it('sizes to the producer high-water mark, not the producer count', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%QW9') })
    expect(image.sizes).toEqual({ '%QW': 10 })
  })

  it('reports a bit area in bits, unpadded', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%IX1.2') })
    expect(image.sizes).toEqual({ '%IX': 11 })
  })

  it('counts VPP backplane channels', () => {
    const image = compute(makeProject({}), {
      vendorScreenData: {
        'io-mapping': { entries: [{ iecAddress: '%IW3', slot: 1, channelName: 'ch0', moduleId: 'm1' }] },
      },
    })
    expect(image.sizes).toEqual({ '%IW': 4 })
  })

  it.each([
    ['no io-mapping at all', {}],
    ['io-mapping that is not an object', { 'io-mapping': 42 }],
    ['io-mapping that is null', { 'io-mapping': null }],
    ['entries that is not an array', { 'io-mapping': { entries: 'nope' } }],
    ['entries missing', { 'io-mapping': {} }],
  ])('survives vendorScreenData with %s', (_label, vendorScreenData) => {
    expect(compute(makeProject({}), { vendorScreenData: vendorScreenData as Record<string, unknown> }).sizes).toEqual(
      {},
    )
  })

  it('ignores a producer whose kind the target does not support', () => {
    const image = compute(makeProject({}), {
      devicePinMapping: pins('%QW9'),
      capabilities: { ...ALL_ACTIVE, pinMapping: false },
    })
    expect(image.sizes).toEqual({})
  })

  it('ignores a producer address that is not parseable', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('NOT_AN_ADDRESS') })
    expect(image.sizes).toEqual({})
  })

  it('counts EtherCAT channels', () => {
    const image = compute(
      makeProject({
        remoteDevices: [
          {
            name: 'ecat',
            ethercatConfig: {
              devices: [{ name: 'slave1', channelMappings: [{ channelId: 'c0', iecLocation: '%QX0.3' }] }],
            },
          },
        ],
      }),
    )
    expect(image.sizes).toEqual({ '%QX': 4 })
  })

  it('skips a global with no location', () => {
    const project = makeProject({
      globals: [variable('g', ''), variable('h', '%MW1')],
      servers: mwServer(2),
    })
    expect(compute(project).sizes).toEqual({ '%MW': 2 })
    expect(compute(project).unbacked).toEqual([])
  })

  it('is deterministic', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('m', '%MW7')] }],
      remoteDevices: modbusMaster('%IX0.0'),
      servers: mwServer(8),
    })
    const first = compute(project, { devicePinMapping: pins('%QW3') })
    const second = compute(project, { devicePinMapping: pins('%QW3') })
    expect(first).toEqual(second)
    expect(Object.keys(first.sizes).sort()).toEqual(['%IX', '%MW', '%QW'])
  })
})

describe('computeIoImage — server exposure', () => {
  const serverWith = (bufferMapping: unknown) => [
    {
      name: 'mb',
      protocol: 'modbus-tcp',
      modbusSlaveConfig: { enabled: true, networkInterface: '', port: 502, bufferMapping },
    },
  ]

  it('sizes an area from an explicitly configured count', () => {
    const image = compute(makeProject({ servers: serverWith({ holdingRegisters: { qwCount: 10 } }) }))
    expect(image.sizes).toEqual({ '%QW': 10 })
  })

  it('contributes nothing when the server carries no buffer mapping', () => {
    const image = compute(makeProject({ servers: serverWith(undefined) }))
    expect(image.sizes).toEqual({})
  })

  it('treats a count of zero as exposing nothing', () => {
    const image = compute(makeProject({ servers: serverWith({ coils: { qxBits: 8, mxBits: 0 } }) }))
    expect(image.sizes).toEqual({ '%QX': 8 })
  })

  it('covers every segment of the buffer mapping', () => {
    const image = compute(
      makeProject({
        servers: serverWith({
          holdingRegisters: { qwCount: 1, mwCount: 2, mdCount: 3, mlCount: 4 },
          coils: { qxBits: 9, mxBits: 17 },
          discreteInputs: { ixBits: 3 },
          inputRegisters: { iwCount: 5 },
        }),
      }),
    )
    expect(image.sizes).toEqual({
      '%QW': 1,
      '%MW': 2,
      '%MD': 3,
      '%ML': 4,
      '%QX': 9,
      '%MX': 17,
      '%IX': 3,
      '%IW': 5,
    })
  })

  it('does NOT back an input it merely publishes', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('sensor', '%IW7')] }],
      servers: serverWith({ inputRegisters: { iwCount: 64 } }),
    })
    const image = compute(project)
    expect(image.sizes['%IW']).toBe(64)
    expect(image.unbacked.map((u) => u.location)).toEqual(['%IW7'])
  })

  it('does NOT back a discrete input either', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('di', '%IX0.1')] }],
      servers: serverWith({ discreteInputs: { ixBits: 64 } }),
    })
    expect(compute(project).unbacked.map((u) => u.location)).toEqual(['%IX0.1'])
  })

  it('backs the outputs it exposes', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('v', '%QW5')] }],
      servers: serverWith({ holdingRegisters: { qwCount: 10 } }),
    })
    expect(compute(project).unbacked).toEqual([])
  })

  it('ignores a server of another protocol', () => {
    const image = compute(
      makeProject({
        servers: [{ name: 's7', protocol: 's7comm', s7commSlaveConfig: {} }],
      }),
    )
    expect(image.sizes).toEqual({})
  })

  it('sizes NOTHING from a server the target does not run', () => {
    const image = compute(makeProject({ servers: serverWith({ holdingRegisters: { qwCount: 1024 } }) }), {
      serverCapabilities: NO_SERVERS,
      areas: IMAGE_AREAS_BAREMETAL,
    })
    expect(image.sizes).toEqual({})
  })

  it('does not BACK an address for a server the target does not run', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('v', '%QW0')] }],
        servers: serverWith({ holdingRegisters: { qwCount: 16 } }),
      }),
      { serverCapabilities: NO_SERVERS, areas: IMAGE_AREAS_BAREMETAL },
    )
    expect(image.unbacked).toHaveLength(1)
    expect(image.unbacked[0].location).toBe('%QW0')
  })

  it('still sizes and backs when the target does run the server', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('v', '%QW0')] }],
        servers: serverWith({ holdingRegisters: { qwCount: 16 } }),
      }),
    )
    expect(image.sizes).toEqual({ '%QW': 16 })
    expect(image.unbacked).toEqual([])
  })

  it('takes the same server the config emitter takes', () => {
    const image = compute(
      makeProject({
        servers: [
          {
            name: 'first',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: { bufferMapping: { inputRegisters: { iwCount: 4 } } },
          },
          {
            name: 'second',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: { bufferMapping: { inputRegisters: { iwCount: 99 } } },
          },
        ],
      }),
    )
    expect(image.sizes).toEqual({ '%IW': 4 })
  })
})

describe('computeIoImage — two declarations on one output', () => {
  const pousWith = (...decls: Array<[pou: string, name: string, location: string]>) =>
    makeProject({
      pous: decls.map(([pou, name, location]) => ({
        name: pou,
        variables: [variable(name, location)],
      })),
    })

  it('refuses the same output slot in two POUs, naming both', () => {
    const image = compute(pousWith(['motor', 'run', '%QX0.0'], ['pump', 'start', '%QX0.0']))
    expect(image.duplicateOutputs).toHaveLength(1)
    expect(image.duplicateOutputs[0]).toMatchObject({
      prefix: '%QX',
      slot: 0,
      first: { scope: 'motor', variableName: 'run' },
      second: { scope: 'pump', variableName: 'start' },
    })
  })

  it('refuses it within one POU as well', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('a', '%QW5'), variable('b', '%QW5')] }],
      }),
    )
    expect(image.duplicateOutputs).toHaveLength(1)
  })

  it('refuses a POU-local colliding with a configuration global', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('local', '%QW3')] }],
        globals: [variable('shared', '%QW3')],
      }),
    )
    expect(image.duplicateOutputs).toHaveLength(1)
    expect(image.duplicateOutputs[0].second.scope).toBe('Global Variables')
  })

  it('allows two POUs to read the same input', () => {
    const image = compute(pousWith(['a', 'x', '%IX0.0'], ['b', 'y', '%IX0.0']))
    expect(image.duplicateOutputs).toEqual([])
  })

  it('allows two POUs to share a memory address', () => {
    const image = compute(pousWith(['a', 'x', '%MW7'], ['b', 'y', '%MW7']))
    expect(image.duplicateOutputs).toEqual([])
  })

  it('allows distinct outputs', () => {
    const image = compute(pousWith(['a', 'x', '%QX0.0'], ['b', 'y', '%QX0.1']))
    expect(image.duplicateOutputs).toEqual([])
  })

  it('catches overlapping located arrays at the slot they share', () => {
    const image = compute(
      makeProject({
        pous: [
          { name: 'a', variables: [arrayVar('first', '%QW0', 0, 9)] },
          { name: 'b', variables: [arrayVar('second', '%QW5', 0, 9)] },
        ],
      }),
    )
    expect(image.duplicateOutputs).toHaveLength(1)
    expect(image.duplicateOutputs[0].slot).toBe(5)
  })

  it('reports one entry per pair, not one per overlapping slot', () => {
    const image = compute(
      makeProject({
        pous: [
          { name: 'a', variables: [arrayVar('first', '%QW0', 0, 3999)] },
          { name: 'b', variables: [arrayVar('second', '%QW0', 0, 3999)] },
        ],
      }),
    )
    expect(image.duplicateOutputs).toHaveLength(1)
  })

  it('says "both in" when the two are in one scope', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('a', '%QW5'), variable('b', '%QW5')] }],
      }),
    )
    expect(describeDuplicateOutput(image.duplicateOutputs[0])).toContain('both in main')
  })

  it('reports the ADDRESS, not the linear slot number', () => {
    const image = compute(pousWith(['motor', 'run', '%QX3.2'], ['pump', 'start', '%QX3.2']))
    const message = describeDuplicateOutput(image.duplicateOutputs[0])
    expect(message).toContain('%QX3.2')
    expect(message).not.toContain('slot 26')
  })

  it('names the overlap address when two arrays clash at neither base', () => {
    const image = compute(
      makeProject({
        pous: [
          { name: 'a', variables: [arrayVar('first', '%QW0', 0, 9)] },
          { name: 'b', variables: [arrayVar('second', '%QW5', 0, 9)] },
        ],
      }),
    )
    const message = describeDuplicateOutput(image.duplicateOutputs[0])
    expect(message).toContain('%QW0')
    expect(message).toContain('%QW5')
    expect(message).toContain('%QW5')
  })

  it('does not walk a huge located array element by element', () => {
    const started = Date.now()
    const image = compute(
      makeProject({
        pous: [
          { name: 'a', variables: [arrayVar('first', '%QW0', 0, 10_000_000)] },
          { name: 'b', variables: [arrayVar('second', '%QW0', 0, 10_000_000)] },
        ],
      }),
    )
    expect(image.duplicateOutputs).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('describes the clash so either side can be the one that moves', () => {
    const image = compute(pousWith(['motor', 'run', '%QX0.0'], ['pump', 'start', '%QX0.0']))
    const message = describeDuplicateOutput(image.duplicateOutputs[0])
    expect(message).toContain('run')
    expect(message).toContain('start')
    expect(message).toContain('motor')
    expect(message).toContain('pump')
  })
})

describe('computeIoImage — S7comm exposure', () => {
  const s7Server = (dataBlocks: unknown[], systemAreas?: unknown) => [
    {
      name: 's7',
      protocol: 's7comm',
      s7commSlaveConfig: { server: { enabled: true }, dataBlocks, systemAreas },
    },
  ]

  let nextDb = 0
  const block = (type: string, startBuffer: number, sizeBytes: number, dbNumber = ++nextDb) => ({
    dbNumber,
    description: '',
    sizeBytes,
    mapping: { type, startBuffer, bitAddressing: false },
  })

  it('sizes the table a data block names', () => {
    const image = compute(makeProject({ servers: s7Server([block('int_output', 0, 128)]) }))
    expect(image.sizes).toEqual({ '%QW': 64 })
  })

  it('converts bytes to elements per width', () => {
    const image = compute(
      makeProject({
        servers: s7Server([
          block('byte_output', 0, 8),
          block('int_memory', 0, 8),
          block('dint_memory', 0, 8),
          block('lint_memory', 0, 8),
        ]),
      }),
    )
    expect(image.sizes).toEqual({ '%QB': 8, '%MW': 4, '%MD': 2, '%ML': 1 })
  })

  it('counts a BOOL block in bits, from its element start', () => {
    const image = compute(makeProject({ servers: s7Server([block('bool_output', 2, 4)]) }))
    expect(image.sizes).toEqual({ '%QX': 48 })
  })

  it('adds the start buffer to the extent', () => {
    const image = compute(makeProject({ servers: s7Server([block('int_output', 100, 8)]) }))
    expect(image.sizes).toEqual({ '%QW': 104 })
  })

  it('takes the largest extent when blocks overlap a table', () => {
    const image = compute(makeProject({ servers: s7Server([block('int_output', 0, 8), block('int_output', 50, 8)]) }))
    expect(image.sizes).toEqual({ '%QW': 54 })
  })

  const tenSpacedBlocks = () => Array.from({ length: 10 }, (_, i) => block('int_memory', i * 10, 2, i + 1))

  const baremetal = (maxDataBlocks: number) => ({
    ...ALL_SERVERS,
    s7: { ...DEFAULT_S7_PROFILE, maxDataBlocks },
  })

  it('stops at the ceiling the target states, as the emitted file does', () => {
    const project = makeProject({ servers: s7Server(tenSpacedBlocks()) })

    expect(compute(project, { serverCapabilities: baremetal(8) }).sizes).toEqual({ '%MW': 71 })
    expect(compute(project, { serverCapabilities: baremetal(64) }).sizes).toEqual({ '%MW': 91 })
  })

  it('backs only the blocks that fit under the ceiling', () => {
    const project = makeProject({
      servers: s7Server(tenSpacedBlocks()),
      pous: [{ name: 'main', variables: [variable('late', '%MW90')] }],
    })

    expect(compute(project, { serverCapabilities: baremetal(8) }).unbacked).toEqual([
      { scope: 'main', variableName: 'late', location: '%MW90', prefix: '%MW', slot: 90, slotCount: 1 },
    ])
    expect(compute(project, { serverCapabilities: baremetal(64) }).unbacked).toEqual([])
  })

  it('honours a ceiling a package manifest lowered', () => {
    const project = makeProject({ servers: s7Server(tenSpacedBlocks()) })
    expect(compute(project, { serverCapabilities: baremetal(4) }).sizes).toEqual({ '%MW': 31 })
  })

  it('sizes nothing for a DB number already defined', () => {
    const project = makeProject({
      servers: s7Server([block('int_memory', 0, 2, 1), block('int_memory', 50, 2, 1)]),
    })
    expect(compute(project, { serverCapabilities: baremetal(8) }).sizes).toEqual({ '%MW': 1 })
  })

  it('sizes nothing for a buffer the target cannot address', () => {
    const project = makeProject({
      servers: s7Server([block('dint_input', 0, 8, 1)]),
      pous: [{ name: 'main', variables: [variable('reading', '%ID0')] }],
    })
    const image = compute(project, { serverCapabilities: baremetal(8), areas: IMAGE_AREAS_BAREMETAL })

    expect(image.sizes['%ID']).toBeUndefined()
    expect(image.unbacked).toEqual([
      { scope: 'main', variableName: 'reading', location: '%ID0', prefix: '%ID', slot: 0, slotCount: 1 },
    ])
  })

  it('still serves that buffer on a target that has it', () => {
    const project = makeProject({
      servers: s7Server([block('dint_input', 0, 8, 1)]),
      pous: [{ name: 'main', variables: [variable('reading', '%ID0')] }],
    })
    const image = compute(project)

    expect(image.sizes['%ID']).toBe(2)
    expect(image.unbacked).toEqual([])
  })

  it('sizes and backs NOTHING when the target does not run an S7 server', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('v', '%IW2')] }],
        servers: s7Server([block('int_input', 0, 16)]),
      }),
      { serverCapabilities: NO_SERVERS, areas: IMAGE_AREAS_BAREMETAL },
    )
    expect(image.sizes).toEqual({})
    expect(image.unbacked).toHaveLength(1)
    expect(image.unbacked[0].location).toBe('%IW2')
  })

  it('scopes the two protocols independently', () => {
    const image = compute(
      makeProject({
        servers: [
          {
            name: 'mb',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: {
              enabled: true,
              networkInterface: '',
              port: 502,
              bufferMapping: { holdingRegisters: { qwCount: 16 } },
            },
          },
          ...s7Server([block('int_input', 0, 16)]),
        ],
      }),
      { serverCapabilities: { modbusTcpServer: true, opcuaServer: false, s7Server: false } },
    )
    expect(image.sizes).toEqual({ '%QW': 16 })
  })

  it('BACKS an input block, unlike Modbus', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('v', '%IW2')] }],
        servers: s7Server([block('int_input', 0, 16)]),
      }),
    )
    expect(image.unbacked).toEqual([])
    expect(image.sizes['%IW']).toBe(8)
  })

  it('does NOT back an address below the block start', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('v', '%IW0')] }],
        servers: s7Server([block('int_input', 100, 8)]),
      }),
    )
    expect(image.unbacked).toHaveLength(1)
    expect(image.unbacked[0].location).toBe('%IW0')
    expect(image.sizes['%IW']).toBe(104)
  })

  it('contributes nothing when the server is switched off', () => {
    const servers = [
      {
        name: 's7',
        protocol: 's7comm',
        s7commSlaveConfig: { server: { enabled: false }, dataBlocks: [block('int_input', 0, 16)] },
      },
    ]
    const image = compute(makeProject({ pous: [{ name: 'main', variables: [variable('v', '%IW2')] }], servers }))
    expect(image.unbacked).toHaveLength(1)
    expect(image.sizes['%IW']).toBeUndefined()
  })

  it('backs an address the block does cover', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('v', '%IW100')] }],
        servers: s7Server([block('int_input', 100, 8)]),
      }),
    )
    expect(image.unbacked).toEqual([])
  })

  it('still refuses an input address the block does not reach', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('v', '%IW20')] }],
        servers: s7Server([block('int_input', 0, 16)]),
      }),
    )
    expect(image.unbacked).toHaveLength(1)
    expect(image.unbacked[0].location).toBe('%IW20')
  })

  it('counts an enabled system area with a mapping', () => {
    const image = compute(
      makeProject({
        servers: s7Server([], {
          paArea: {
            enabled: true,
            sizeBytes: 16,
            mapping: { type: 'int_output', startBuffer: 0, bitAddressing: false },
          },
        }),
      }),
    )
    expect(image.sizes).toEqual({ '%QW': 8 })
  })

  it('sizes nothing for a block too small to hold one element', () => {
    const image = compute(makeProject({ servers: s7Server([block('lint_memory', 0, 7)]) }))
    expect(image.sizes).toEqual({})
  })

  it('ignores a system area that is switched off', () => {
    const image = compute(
      makeProject({
        servers: s7Server([], {
          paArea: {
            enabled: false,
            sizeBytes: 16,
            mapping: { type: 'int_output', startBuffer: 0, bitAddressing: false },
          },
        }),
      }),
    )
    expect(image.sizes).toEqual({})
  })

  it('ignores an enabled system area with no mapping yet', () => {
    const image = compute(makeProject({ servers: s7Server([], { mkArea: { enabled: true, sizeBytes: 16 } }) }))
    expect(image.sizes).toEqual({})
  })

  it('sizes a Modbus and an S7comm server in the same project', () => {
    const servers = [
      {
        name: 'mb',
        protocol: 'modbus-tcp',
        modbusSlaveConfig: {
          enabled: true,
          networkInterface: '',
          port: 502,
          bufferMapping: { holdingRegisters: { qwCount: 10 } },
        },
      },
      ...s7Server([block('int_memory', 0, 40)]),
    ]
    const image = compute(makeProject({ servers }))
    expect(image.sizes).toEqual({ '%QW': 10, '%MW': 20 })
  })

  it('takes the first S7comm server, as the config emitter does', () => {
    const servers = [...s7Server([block('int_output', 0, 8)]), ...s7Server([block('int_output', 0, 800)])]
    const image = compute(makeProject({ servers }))
    expect(image.sizes).toEqual({ '%QW': 4 })
  })
})

describe('computeIoImage — a Modbus server that is switched off', () => {
  const disabled = (bufferMapping: unknown) => [
    {
      name: 'mb',
      protocol: 'modbus-tcp',
      modbusSlaveConfig: { enabled: false, transports: ['tcp'], bufferMapping },
    },
  ]

  it('sizes nothing at all', () => {
    const image = compute(makeProject({ servers: disabled({ holdingRegisters: { qwCount: 10 } }) }))
    expect(image.sizes).toEqual({})
  })

  it('leaves a declaration against it unbacked, so the gate refuses the build', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('valve', '%QW0')] }],
        servers: disabled({ holdingRegisters: { qwCount: 10 } }),
      }),
    )
    expect(image.sizes['%QW']).toBeUndefined()
    expect(image.unbacked).toHaveLength(1)
    expect(image.unbacked[0]).toMatchObject({ variableName: 'valve', location: '%QW0' })
  })

  it('reaches the enabled server behind it, the way the emitters do', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('valve', '%QW0')] }],
        servers: [
          ...disabled({ holdingRegisters: { qwCount: 99 } }),
          {
            name: 'mb2',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: {
              enabled: true,
              transports: ['tcp'],
              bufferMapping: { holdingRegisters: { qwCount: 4 } },
            },
          },
        ],
      }),
    )
    expect(image.sizes).toEqual({ '%QW': 4 })
    expect(image.unbacked).toEqual([])
  })

  it('backs normally when the server is enabled', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('valve', '%QW0')] }],
        servers: [
          {
            name: 'mb',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: {
              enabled: true,
              transports: ['tcp'],
              bufferMapping: { holdingRegisters: { qwCount: 10 } },
            },
          },
        ],
      }),
    )
    expect(image.unbacked).toEqual([])
  })

  it('treats an absent `enabled` as serving, the way selectModbusServer does', () => {
    const image = compute(
      makeProject({
        pous: [{ name: 'main', variables: [variable('valve', '%QW0')] }],
        servers: [
          {
            name: 'mb',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: { transports: ['tcp'], bufferMapping: { holdingRegisters: { qwCount: 10 } } },
          },
        ],
      }),
    )
    expect(image.unbacked).toEqual([])
  })
})

describe('computeIoImage — memory follows the same rule as input and output', () => {
  it('does not walk a huge array element by element', () => {
    const project = makeProject({ pous: [{ name: 'main', variables: [arrayVar('huge', '%MW0', 0, 10_000_000)] }] })
    const started = Date.now()
    expect(compute(project).unbacked).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('does not size a memory area from a declaration with nothing else configured', () => {
    const image = compute(withLocal('%MW100'))
    expect(image.sizes['%MW']).toBeUndefined()
    expect(image.unbacked).toEqual([
      { scope: 'main', variableName: 'v', location: '%MW100', prefix: '%MW', slot: 100, slotCount: 1 },
    ])
  })

  it('reports an unbacked memory declaration at every width', () => {
    for (const location of ['%MX5.3', '%MW1', '%MD2', '%ML3']) {
      expect(compute(withLocal(location)).unbacked).toHaveLength(1)
    }
  })

  it('accepts a memory declaration a server exposes', () => {
    const image = compute(
      makeProject({ pous: [{ name: 'main', variables: [variable('v', '%MW3')] }], servers: mwServer(40) }),
    )
    expect(image.sizes).toEqual({ '%MW': 40 })
    expect(image.unbacked).toEqual([])
  })

  it('refuses a declaration past the end of what the server exposes', () => {
    const image = compute(
      makeProject({ pous: [{ name: 'main', variables: [variable('v', '%MW99')] }], servers: mwServer(40) }),
    )
    expect(image.sizes).toEqual({ '%MW': 40 })
    expect(image.unbacked).toHaveLength(1)
  })

  it('reports the first element of a located array that runs past the exposure', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [arrayVar('a', '%MW60', 0, 66)] }],
      servers: mwServer(100),
    })
    const image = compute(project)
    expect(image.sizes).toEqual({ '%MW': 100 })
    expect(image.unbacked).toEqual([
      { scope: 'main', variableName: 'a', location: '%MW60', prefix: '%MW', slot: 100, slotCount: 67 },
    ])
  })

  it('walks configuration globals as well as POU locals', () => {
    const project = makeProject({ globals: [variable('g', '%MW4')] })
    expect(compute(project).unbacked).toHaveLength(1)
  })
})

describe('computeIoImage — BR14, an address with no producer', () => {
  it('fails an output declaration nothing produces', () => {
    expect(compute(withLocal('%QW3859')).unbacked).toEqual([
      { scope: 'main', variableName: 'v', location: '%QW3859', prefix: '%QW', slot: 3859, slotCount: 1 },
    ])
  })

  it('fails an input declaration nothing produces', () => {
    expect(compute(withLocal('%IW7', 'sensor')).unbacked).toEqual([
      { scope: 'main', variableName: 'sensor', location: '%IW7', prefix: '%IW', slot: 7, slotCount: 1 },
    ])
  })

  it('accepts a declaration that lands on a producer', () => {
    const image = compute(withLocal('%QW1'), { devicePinMapping: pins('%QW0', '%QW1') })
    expect(image.unbacked).toEqual([])
    expect(image.sizes).toEqual({ '%QW': 2 })
  })

  it('fails an address in a GAP between two producers', () => {
    const image = compute(withLocal('%QW5'), { devicePinMapping: pins('%QW0', '%QW9') })
    expect(image.sizes).toEqual({ '%QW': 10 })
    expect(image.unbacked).toEqual([
      { scope: 'main', variableName: 'v', location: '%QW5', prefix: '%QW', slot: 5, slotCount: 1 },
    ])
  })

  it('reports the FIRST unbacked slot of a partially backed array', () => {
    const project = makeProject({ pous: [{ name: 'main', variables: [arrayVar('a', '%QW0', 0, 3)] }] })
    const image = compute(project, { devicePinMapping: pins('%QW0', '%QW1') })
    expect(image.unbacked).toEqual([
      { scope: 'main', variableName: 'a', location: '%QW0', prefix: '%QW', slot: 2, slotCount: 4 },
    ])
  })

  it('names the scope of a global as well as of a POU', () => {
    const project = makeProject({
      pous: [{ name: 'pump', variables: [variable('a', '%QW0')] }],
      globals: [variable('b', '%QW1')],
    })
    expect(compute(project).unbacked.map((issue) => [issue.scope, issue.variableName])).toEqual([
      ['pump', 'a'],
      ['Global Variables', 'b'],
    ])
  })

  it('skips a variable with no location and one whose location is not literal', () => {
    const project = makeProject({
      pous: [
        {
          name: 'main',
          variables: [variable('plain', ''), variable('orphan', 'SomeAlias')],
        },
      ],
    })
    expect(compute(project)).toEqual({ sizes: {}, origins: {}, unbacked: [], unsupported: [], duplicateOutputs: [] })
  })
})

describe('computeIoImage — areas the target does not have', () => {
  it('reports %MX on bare metal instead of dropping it in silence', () => {
    const image = compute(withLocal('%MX0.1', 'flag'), { areas: IMAGE_AREAS_BAREMETAL })
    expect(image.unbacked).toEqual([])
    expect(image.unsupported).toEqual([{ scope: 'main', variableName: 'flag', location: '%MX0.1', prefix: '%MX' }])
    expect(image.sizes['%MX']).toBeUndefined()
  })

  it('does not call %MX unsupported on Runtime v4, which does have bool_memory', () => {
    const image = compute(withLocal('%MX0.1'), { areas: IMAGE_AREAS_RUNTIME_V4 })
    expect(image.unsupported).toEqual([])
    expect(image.unbacked).toHaveLength(1)
  })

  it('reports a byte-addressed declaration on bare metal', () => {
    expect(compute(withLocal('%IB4'), { areas: IMAGE_AREAS_BAREMETAL }).unsupported).toEqual([
      { scope: 'main', variableName: 'v', location: '%IB4', prefix: '%IB' },
    ])
  })

  it('reports %MB on Runtime v4, which has byte_input and byte_output but no byte_memory', () => {
    expect(compute(withLocal('%MB4'), { areas: IMAGE_AREAS_RUNTIME_V4 }).unsupported).toEqual([
      { scope: 'main', variableName: 'v', location: '%MB4', prefix: '%MB' },
    ])
  })

  it('does not size an area the target lacks, even when a producer claims it', () => {
    const image = compute(makeProject({}), {
      devicePinMapping: pins('%QW0'),
      areas: new Set(['%IX']),
    })
    expect(image.sizes).toEqual({})
  })

  it('prefers the area message over the unbacked one for the same variable', () => {
    const image = compute(withLocal('%IB4'), { areas: IMAGE_AREAS_BAREMETAL })
    expect(image.unbacked).toEqual([])
    expect(image.unsupported).toHaveLength(1)
  })
})

describe('the messages', () => {
  it('names the area, the variable and where a producer is added', () => {
    const [area, remedy] = describeUnbackedLocations(compute(withLocal('%QW3859', 'valve')).unbacked)
    expect(area).toContain('Nothing produces %QW on this target')
    expect(area).toContain('1 located variable sits on it')
    expect(area).toContain('valve at %QW3859')
    expect(remedy).toContain('the Device, Remote Devices or Servers branches')
  })

  it('leaves the slot out for a scalar, where the address already says it', () => {
    const [area] = describeUnbackedLocations(compute(withLocal('%QW3859', 'valve')).unbacked)
    expect(area).not.toContain('slot 3859')
  })

  it('says which slot an array runs past, since its own address looks legal', () => {
    const project = makeProject({ pous: [{ name: 'main', variables: [arrayVar('a', '%QW0', 0, 3)] }] })
    const [area] = describeUnbackedLocations(compute(project, { devicePinMapping: pins('%QW0', '%QW1') }).unbacked)
    expect(area).toContain('4 elements reach past slot 2')
  })

  it('groups by area and states the remedy once, however many variables', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('a', '%MW0'), variable('b', '%MW1'), variable('c', '%MD0')] }],
    })
    const lines = describeUnbackedLocations(compute(project).unbacked)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('%MW')
    expect(lines[0]).toContain('a at %MW0 · b at %MW1')
    expect(lines[1]).toContain('%MD')
  })

  it('points memory at the Buffer Mapping, not at pins it can never come from', () => {
    const lines = describeUnbackedLocations(compute(withLocal('%MX0.1', 'flag')).unbacked)
    const remedy = lines[lines.length - 1]
    expect(remedy).toContain("%MX is sized under a Modbus server's Buffer Mapping, under Servers")
    expect(remedy).not.toContain('the Device, Remote Devices or Servers branches')
  })

  it('does not send %MX to S7comm, which has no buffer code for it', () => {
    const remedy = describeUnbackedLocations(compute(withLocal('%MX0.1', 'flag')).unbacked).at(-1)
    expect(remedy).not.toContain('S7comm')
  })

  it('offers S7comm alongside Modbus for the word areas it can back', () => {
    const remedy = describeUnbackedLocations(compute(withLocal('%MW3859', 'count')).unbacked).at(-1)
    expect(remedy).toContain("%MW is sized under a Modbus server's Buffer Mapping or an S7comm server's data blocks")
  })

  it('separates the bit and word memory remedies when both are unbacked', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('flag', '%MX0.1'), variable('count', '%MW3859')] }],
    })
    const remedy = describeUnbackedLocations(compute(project).unbacked).at(-1)
    expect(remedy).toContain("%MX is sized under a Modbus server's Buffer Mapping, under Servers")
    expect(remedy).toContain("%MW is sized under a Modbus server's Buffer Mapping or an S7comm server's data blocks")
  })

  it('keeps both remedies when a physical area and memory are both unbacked', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('v', '%QW3859'), variable('flag', '%MX0.1')] }],
    })
    const lines = describeUnbackedLocations(compute(project).unbacked)
    const remedy = lines[lines.length - 1]
    expect(remedy).toContain('the Device, Remote Devices or Servers branches')
    expect(remedy).toContain("%MX is sized under a Modbus server's Buffer Mapping, under Servers")
  })

  it('cuts the list short rather than naming every offender', () => {
    const many = Array.from({ length: 9 }, (_, i) => variable(`v${i}`, `%MW${i}`))
    const lines = describeUnbackedLocations(
      compute(makeProject({ pous: [{ name: 'main', variables: many }] })).unbacked,
    )
    expect(lines[0]).toContain('9 located variables sit on it')
    expect(lines[0]).toContain('and 4 more')
  })

  it('names the board for an area that does not exist there', () => {
    const [issue] = compute(withLocal('%MX0.1'), { areas: IMAGE_AREAS_BAREMETAL }).unsupported
    const message = describeUnsupportedArea(issue, 'Arduino Uno')
    expect(message).toContain('"Arduino Uno" has no %MX area at all')
    expect(message).not.toContain('nothing produces')
  })
})

describe('computeIoImage — an array whose lower bound is negative', () => {
  const slotsOf = (array: PLCVariable) => {
    const image = compute(makeProject({ pous: [{ name: 'main', variables: [array] }] }))
    return image.unbacked[0]?.slotCount
  }

  it('counts every element of ARRAY [-5..5]', () => {
    expect(slotsOf(arrayVar('v', '%MW0', -5, 5))).toBe(11)
  })

  it('counts an array that is entirely negative', () => {
    expect(slotsOf(arrayVar('v', '%MW0', -10, -1))).toBe(10)
  })

  it('agrees with the editor about how many slots it claims', () => {
    expect(slotsOf(arrayVar('v', '%MW0', -5, 5))).toBe(getArrayTotalElements(arrayVar('v', '%MW0', -5, 5)))
  })

  it('checks the whole extent against the producers on an output', () => {
    const image = compute(makeProject({ pous: [{ name: 'main', variables: [arrayVar('v', '%QW0', -2, 2)] }] }), {
      devicePinMapping: pins('%QW0', '%QW1'),
    })
    expect(image.unbacked).toHaveLength(1)
    expect(image.unbacked[0].slotCount).toBe(5)
  })
})

describe('computeIoImage — array extents that cannot be read', () => {
  const oneSlot = (malformedType: unknown) => {
    const v = variable('a', '%MW10', malformedType as PLCVariable['type'])
    const project = makeProject({ pous: [{ name: 'main', variables: [v] }] })
    expect(compute(project).unbacked[0]?.slotCount).toBe(1)
  }

  it('falls back to one slot for a missing type', () => oneSlot(undefined))

  it('falls back to one slot for a non-array type', () => oneSlot({ definition: 'base-type', value: 'WORD' }))

  it('falls back to one slot for an array with no dimensions', () => oneSlot({ definition: 'array', data: {} }))

  it('falls back to one slot for a multi-dimensional array', () =>
    oneSlot({ definition: 'array', data: { dimensions: [{ dimension: '0..1' }, { dimension: '0..1' }] } }))

  it('falls back to one slot for a malformed dimension', () =>
    oneSlot({ definition: 'array', data: { dimensions: [{ dimension: 'nonsense' }] } }))

  it('falls back to one slot for reversed bounds', () =>
    oneSlot({ definition: 'array', data: { dimensions: [{ dimension: '9..2' }] } }))

  it('falls back to one slot for a dimension entry with no dimension', () =>
    oneSlot({ definition: 'array', data: { dimensions: [{}] } }))
})

describe('computeIoImage — where each number came from', () => {
  const s7Block = (type: string, startBuffer: number, sizeBytes: number) => [
    {
      name: 's7',
      protocol: 's7comm',
      s7commSlaveConfig: {
        server: { enabled: true },
        dataBlocks: [{ dbNumber: 1, description: '', sizeBytes, mapping: { type, startBuffer, bitAddressing: false } }],
      },
    },
  ]

  const modbusServer = (bufferMapping: unknown) => [
    {
      name: 'mb',
      protocol: 'modbus-tcp',
      modbusSlaveConfig: { enabled: true, networkInterface: '', port: 502, bufferMapping },
    },
  ]

  it('names the producers when a pin set the number', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%IX0.0', '%IX0.1') })
    expect(image.origins).toEqual({ '%IX': 'producers' })
  })

  it('names the Modbus server when its exposure set the number', () => {
    const image = compute(makeProject({ servers: modbusServer({ holdingRegisters: { qwCount: 40 } }) }))
    expect(image.origins).toEqual({ '%QW': 'modbus-server' })
  })

  it('names the S7comm server when a data block set the number', () => {
    const image = compute(makeProject({ servers: s7Block('int_output', 0, 128) }))
    expect(image.origins).toEqual({ '%QW': 's7comm-server' })
  })

  it('never names a declaration, which cannot size an area', () => {
    const image = compute(makeProject({ pous: [{ name: 'main', variables: [variable('m', '%MW7')] }] }))
    expect(image.sizes).toEqual({})
    expect(image.origins).toEqual({})
  })

  it('names the LARGER claimant when two contributors size the same area', () => {
    const image = compute(makeProject({ servers: modbusServer({ holdingRegisters: { qwCount: 40 } }) }), {
      devicePinMapping: pins('%QW0'),
    })
    expect(image.sizes).toEqual({ '%QW': 40 })
    expect(image.origins).toEqual({ '%QW': 'modbus-server' })
  })

  it('leaves the EARLIER claimant named on a tie', () => {
    const image = compute(makeProject({ servers: modbusServer({ holdingRegisters: { qwCount: 1 } }) }), {
      devicePinMapping: pins('%QW0'),
    })
    expect(image.sizes).toEqual({ '%QW': 1 })
    expect(image.origins).toEqual({ '%QW': 'producers' })
  })

  it('drops the origin with the area when the target has no such buffer', () => {
    const image = compute(makeProject({ servers: modbusServer({ coils: { mxBits: 16 } }) }), {
      areas: IMAGE_AREAS_BAREMETAL,
    })
    expect(image.sizes).toEqual({})
    expect(image.origins).toEqual({})
  })
})

describe('describeIoImageSizes', () => {
  const modbusServer = (bufferMapping: unknown) => [
    {
      name: 'mb',
      protocol: 'modbus-tcp',
      modbusSlaveConfig: { enabled: true, networkInterface: '', port: 502, bufferMapping },
    },
  ]

  it('says nothing about a project that sizes nothing', () => {
    expect(describeIoImageSizes(compute(makeProject({})))).toEqual([])
  })

  it('names the area, the size, the unit and the source', () => {
    const image = compute(makeProject({ servers: modbusServer({ holdingRegisters: { qwCount: 40 } }) }))
    expect(describeIoImageSizes(image)).toEqual(['%QW sized to 40 words from Modbus server exposure'])
  })

  it('drops the plural for a single element', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%QW0') })
    expect(describeIoImageSizes(image)).toEqual(['%QW sized to 1 word from address producers'])
  })

  it('follows the image.conf order rather than insertion order', () => {
    const image = compute(
      makeProject({
        servers: modbusServer({
          discreteInputs: { ixBits: 8 },
          holdingRegisters: { qwCount: 2, mwCount: 1 },
        }),
      }),
    )
    expect(describeIoImageSizes(image)).toEqual([
      '%IX sized to 8 bits from Modbus server exposure',
      '%QW sized to 2 words from Modbus server exposure',
      '%MW sized to 1 word from Modbus server exposure',
    ])
  })

  it('is stable across two runs of the same project', () => {
    const project = makeProject({
      pous: [{ name: 'main', variables: [variable('m', '%MW3')] }],
      servers: modbusServer({ coils: { qxBits: 24 }, holdingRegisters: { mwCount: 4 } }),
    })
    expect(describeIoImageSizes(compute(project))).toEqual(describeIoImageSizes(compute(project)))
  })
})
