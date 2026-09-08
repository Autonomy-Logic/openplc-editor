/**
 * Tests for the project-driven I/O image sizer (DOPE-615).
 *
 * Two behaviours are pinned here, and they are deliberately asymmetric:
 * `%I` / `%Q` declarations are VALIDATED against what the producers claim,
 * while `%M` declarations SIZE their own area. That asymmetry is BR14 and
 * BR15, and most of these cases exist to keep it from quietly collapsing into
 * "everything grows the image", which is the behaviour this replaces.
 */

import type { DevicePin } from '@root/middleware/shared/ports/types'
import type { AddressProducerCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import type { PLCProjectData } from '../../types/PLC/open-plc'
import {
  computeIoImage,
  describeUnbackedLocation,
  describeUnsupportedArea,
  IMAGE_AREAS_BAREMETAL,
  IMAGE_AREAS_RUNTIME_V4,
} from '../steps/compute-io-image'

const ALL_ACTIVE: AddressProducerCapabilities = {
  pinMapping: true,
  vppIo: true,
  modbusTcpRemote: true,
  ethercat: true,
}

type TestVariable = { name: string; location: string; type?: unknown }

/** A located `ARRAY [start..end] OF <base>` variable. */
const arrayVar = (name: string, location: string, start: number, end: number, base = 'WORD'): TestVariable => ({
  name,
  location,
  type: {
    definition: 'array',
    value: `ARRAY [${start}..${end}] OF ${base}`,
    data: { baseType: { definition: 'base-type', value: base }, dimensions: [{ dimension: `${start}..${end}` }] },
  },
})

function makeProject(options: {
  pous?: Array<{ name: string; variables: TestVariable[] }>
  globals?: TestVariable[]
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
    servers: options.servers,
    remoteDevices: options.remoteDevices,
    configuration: { resource: { tasks: [], instances: [], globalVariables: options.globals ?? [] } },
  } as unknown as PLCProjectData
}

/** A local `VAR … AT` in one POU — the common shape in these tests. */
const withLocal = (location: string, name = 'v') =>
  makeProject({ pous: [{ name: 'main', variables: [{ name, location }] }] })

/** A pin-mapping producer at each of `addresses`. */
const pins = (...addresses: string[]): DevicePin[] =>
  addresses.map((address, index) => ({ pin: `${index}`, pinType: 'digitalInput' as const, address }))

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
const compute = (projectData: PLCProjectData, extra: Partial<Parameters<typeof computeIoImage>[0]> = {}) =>
  computeIoImage({
    projectData,
    capabilities: ALL_ACTIVE,
    areas: IMAGE_AREAS_RUNTIME_V4,
    ...extra,
  })

describe('computeIoImage — sizing from producers', () => {
  it('sizes nothing for an empty project', () => {
    // FR21 / BR12: the floor is zero, and zero is expressed by absence.
    expect(compute(makeProject({}))).toEqual({ sizes: {}, unbacked: [], unsupported: [] })
  })

  it('sizes an area from the pins that claim it', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%IX0.0', '%IX0.1', '%QW0') })
    // Four bits would still be a whole byte: FR06.
    expect(image.sizes).toEqual({ '%IX': 8, '%QW': 1 })
    expect(image.unbacked).toEqual([])
  })

  it('leaves a class with no producers absent rather than zero-valued', () => {
    const image = compute(makeProject({}), { devicePinMapping: pins('%QW0') })
    expect(image.sizes['%IX']).toBeUndefined()
    expect(image.sizes['%IX'] ?? 0).toBe(0)
  })

  it('counts a Modbus master group even with no variable declared for it', () => {
    // BR03 / TC02: an IO group claims addresses on its own. Sizing from the
    // program's declarations alone would leave the master writing outside the
    // image — the failure this contributor exists to prevent.
    const image = compute(makeProject({ remoteDevices: modbusMaster('%IX0.0', '%IX0.1', '%IX0.2') }))
    expect(image.sizes).toEqual({ '%IX': 8 })
  })

  it('sizes to the producer high-water mark, not the producer count', () => {
    // One pin at %QW9 needs ten words: the image is a contiguous buffer.
    const image = compute(makeProject({}), { devicePinMapping: pins('%QW9') })
    expect(image.sizes).toEqual({ '%QW': 10 })
  })

  it('rounds a bit area up to a whole byte', () => {
    // %IX1.2 is bit 10, so 11 bits are needed and 16 are emitted (FR06).
    const image = compute(makeProject({}), { devicePinMapping: pins('%IX1.2') })
    expect(image.sizes).toEqual({ '%IX': 16 })
  })

  it('counts VPP backplane channels', () => {
    const image = compute(makeProject({}), {
      vendorScreenData: {
        'io-mapping': { entries: [{ iecAddress: '%IW3', slot: 1, channelName: 'ch0', moduleId: 'm1' }] },
      },
    })
    expect(image.sizes).toEqual({ '%IW': 4 })
  })

  it('ignores a producer whose kind the target does not support', () => {
    // A target without pin mapping frees that space, so it must not size the
    // image either — the same scoping the store's recalculation applies.
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
    expect(image.sizes).toEqual({ '%QX': 8 })
  })

  it('skips a global with no location', () => {
    const project = makeProject({
      globals: [
        { name: 'g', location: '' },
        { name: 'h', location: '%MW1' },
      ],
    })
    expect(compute(project).sizes).toEqual({ '%MW': 2 })
  })

  it('is deterministic', () => {
    // FR07: same project, same bytes.
    const project = makeProject({
      pous: [{ name: 'main', variables: [{ name: 'm', location: '%MW7' }] }],
      remoteDevices: modbusMaster('%IX0.0'),
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
    // FR04: what the user asked the server to publish has to fit.
    const image = compute(makeProject({ servers: serverWith({ holdingRegisters: { qwCount: 10 } }) }))
    expect(image.sizes).toEqual({ '%QW': 10 })
  })

  it('contributes nothing when the server carries no buffer mapping', () => {
    // The load-bearing case. DEFAULT_BUFFER_MAPPING is today's fixed image
    // (8192 bits / 1024 registers), so treating absence as a request for the
    // defaults would pin every project with a Modbus server back to the very
    // constant this change removes, and BR10 would never hold.
    const image = compute(makeProject({ servers: serverWith(undefined) }))
    expect(image.sizes).toEqual({})
  })

  it('treats a count of zero as exposing nothing', () => {
    // The %MX default. The segment exists and is switched off.
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
      // Bit areas rounded up to whole bytes.
      '%QX': 16,
      '%MX': 24,
      '%IX': 8,
      '%IW': 5,
    })
  })

  it('backs the outputs it exposes', () => {
    // A %QW the server publishes has something reading it, which is what
    // BR14 asks of an output.
    const project = makeProject({
      pous: [{ name: 'main', variables: [{ name: 'v', location: '%QW5' }] }],
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

  it('takes the same server the config emitter takes', () => {
    // `generateModbusSlaveConfig` ships the FIRST modbus-tcp server carrying a
    // config. Sizing for a different one would size for exposure the device
    // never receives.
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

describe('computeIoImage — memory is its own producer', () => {
  it('sizes a memory area from a declaration with nothing else configured', () => {
    // BR15 / TC13: without this, a program using scratch memory and no
    // Modbus server would be handed zero memory words.
    const image = compute(withLocal('%MW100'))
    expect(image.sizes).toEqual({ '%MW': 101 })
    expect(image.unbacked).toEqual([])
  })

  it('never reports a memory declaration as unbacked', () => {
    // FR24. Every memory width, including %MX, which no producer emits.
    for (const location of ['%MX5.3', '%MW1', '%MD2', '%ML3']) {
      expect(compute(withLocal(location)).unbacked).toEqual([])
    }
  })

  it('counts a memory bit declaration in bits and rounds the area', () => {
    // %MX5.3 is bit 43, so 44 bits are needed and 48 are emitted.
    expect(compute(withLocal('%MX5.3')).sizes).toEqual({ '%MX': 48 })
  })

  it('sizes a located array to its LAST element', () => {
    // openplc-editor#565: `AT %MW60 : ARRAY [0..66] OF WORD` occupies %MW60
    // through %MW126, so sizing from the base address would leave the tail
    // outside the image.
    const project = makeProject({ pous: [{ name: 'main', variables: [arrayVar('a', '%MW60', 0, 66)] }] })
    expect(compute(project).sizes).toEqual({ '%MW': 127 })
  })

  it('takes the largest of the declarations and the server exposure', () => {
    // BR15: the union, not whichever was read last.
    const bigServer = compute(
      makeProject({
        pous: [{ name: 'main', variables: [{ name: 'v', location: '%MW3' }] }],
        servers: [
          {
            name: 'mb',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: { bufferMapping: { holdingRegisters: { mwCount: 40 } } },
          },
        ],
      }),
    )
    expect(bigServer.sizes).toEqual({ '%MW': 40 })

    const bigProgram = compute(
      makeProject({
        pous: [{ name: 'main', variables: [{ name: 'v', location: '%MW99' }] }],
        servers: [
          {
            name: 'mb',
            protocol: 'modbus-tcp',
            modbusSlaveConfig: { bufferMapping: { holdingRegisters: { mwCount: 40 } } },
          },
        ],
      }),
    )
    expect(bigProgram.sizes).toEqual({ '%MW': 100 })
  })

  it('walks configuration globals as well as POU locals', () => {
    const project = makeProject({ globals: [{ name: 'g', location: '%MW4' }] })
    expect(compute(project).sizes).toEqual({ '%MW': 5 })
  })
})

describe('computeIoImage — BR14, an address with no producer', () => {
  it('fails an output declaration nothing produces', () => {
    // TC12. The address from the requirements document.
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
    // The case a size comparison would miss: %QW5 is inside a ten-word image
    // and still has nothing behind it. This is why the check is per slot.
    const image = compute(withLocal('%QW5'), { devicePinMapping: pins('%QW0', '%QW9') })
    expect(image.sizes).toEqual({ '%QW': 10 })
    expect(image.unbacked).toEqual([
      { scope: 'main', variableName: 'v', location: '%QW5', prefix: '%QW', slot: 5, slotCount: 1 },
    ])
  })

  it('reports the FIRST unbacked slot of a partially backed array', () => {
    // The base address is fine and the length is what runs past the
    // producers, so pointing at the declared address alone would be useless.
    const project = makeProject({ pous: [{ name: 'main', variables: [arrayVar('a', '%QW0', 0, 3)] }] })
    const image = compute(project, { devicePinMapping: pins('%QW0', '%QW1') })
    expect(image.unbacked).toEqual([
      { scope: 'main', variableName: 'a', location: '%QW0', prefix: '%QW', slot: 2, slotCount: 4 },
    ])
  })

  it('names the scope of a global as well as of a POU', () => {
    const project = makeProject({
      pous: [{ name: 'pump', variables: [{ name: 'a', location: '%QW0' }] }],
      globals: [{ name: 'b', location: '%QW1' }],
    })
    expect(compute(project).unbacked.map((issue) => [issue.scope, issue.variableName])).toEqual([
      ['pump', 'a'],
      ['Global Variables', 'b'],
    ])
  })

  it('skips a variable with no location and one whose location is not literal', () => {
    // Aliases were resolved before the pipeline ran, so anything still
    // unparseable here resolved to nothing: unlocated, not out of range.
    const project = makeProject({
      pous: [
        {
          name: 'main',
          variables: [
            { name: 'plain', location: '' },
            { name: 'orphan', location: 'SomeAlias' },
          ],
        },
      ],
    })
    expect(compute(project)).toEqual({ sizes: {}, unbacked: [], unsupported: [] })
  })
})

describe('computeIoImage — areas the target does not have', () => {
  it('reports %MX on bare metal instead of dropping it in silence', () => {
    // DOPE-605: openplc.h declares no bool_memory, so today the address is
    // simply lost. FR24 protects a memory declaration from failing for want of
    // a producer, and this is a different failure — the area is not there.
    const image = compute(withLocal('%MX0.1', 'flag'), { areas: IMAGE_AREAS_BAREMETAL })
    expect(image.unbacked).toEqual([])
    expect(image.unsupported).toEqual([{ scope: 'main', variableName: 'flag', location: '%MX0.1', prefix: '%MX' }])
    // And the area is not sized either: there is no macro to emit it under.
    expect(image.sizes['%MX']).toBeUndefined()
  })

  it('accepts %MX on Runtime v4, which does have bool_memory', () => {
    const image = compute(withLocal('%MX0.1'), { areas: IMAGE_AREAS_RUNTIME_V4 })
    expect(image.unsupported).toEqual([])
    expect(image.sizes).toEqual({ '%MX': 8 })
  })

  it('reports a byte-addressed declaration on bare metal', () => {
    // No byte buffer of any kind in openplc.h.
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
    // A target switch can leave a producer holding an address the new target
    // has no buffer for. Sizing it would ask the emitter for a macro that does
    // not exist.
    const image = compute(makeProject({}), {
      devicePinMapping: pins('%QW0'),
      areas: new Set(['%IX']),
    })
    expect(image.sizes).toEqual({})
  })

  it('prefers the area message over the unbacked one for the same variable', () => {
    // Both are true of `%IB4` on bare metal; only the area message is useful,
    // because no producer would fix it.
    const image = compute(withLocal('%IB4'), { areas: IMAGE_AREAS_BAREMETAL })
    expect(image.unbacked).toEqual([])
    expect(image.unsupported).toHaveLength(1)
  })
})

describe('the messages', () => {
  it('names the variable, the slot and what would fix it', () => {
    const [issue] = compute(withLocal('%QW3859', 'valve')).unbacked
    const message = describeUnbackedLocation(issue)
    expect(message).toContain('"valve"')
    expect(message).toContain('%QW3859')
    expect(message).toContain('slot 3859')
    expect(message).toContain('nothing produces that address')
  })

  it('says which slot an array runs past, since its own address looks legal', () => {
    const project = makeProject({ pous: [{ name: 'main', variables: [arrayVar('a', '%QW0', 0, 3)] }] })
    const [issue] = compute(project, { devicePinMapping: pins('%QW0', '%QW1') }).unbacked
    expect(describeUnbackedLocation(issue)).toContain('4 elements reach past slot 2')
  })

  it('names the board for an area that does not exist there', () => {
    const [issue] = compute(withLocal('%MX0.1'), { areas: IMAGE_AREAS_BAREMETAL }).unsupported
    const message = describeUnsupportedArea(issue, 'Arduino Uno')
    expect(message).toContain('"Arduino Uno" has no %MX area at all')
    // Different remedy from the unbacked message: no producer would help.
    expect(message).not.toContain('nothing produces')
  })
})

describe('computeIoImage — array extents that cannot be read', () => {
  const oneSlot = (type: unknown) => {
    const project = makeProject({ pous: [{ name: 'main', variables: [{ name: 'a', location: '%MW10', type }] }] })
    // A single slot at %MW10 means the area stops at 11.
    expect(compute(project).sizes).toEqual({ '%MW': 11 })
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
