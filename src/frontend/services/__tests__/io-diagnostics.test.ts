/**
 * Tests for the I/O image diagnostics snapshot.
 *
 * The snapshot exists to be trusted in place of a build, so what is pinned
 * here is that it AGREES with the build: the sizes and the two emitted files
 * come from the pipeline's own functions, and the rows that summarise them
 * (which producer is active, which server the sizer read, which declaration
 * the gate objected to) say the same thing those functions did.
 *
 * What is deliberately NOT re-tested is the sizer's own arithmetic — that is
 * `compute-io-image.test.ts`'s job, and restating it here would produce two
 * copies of one expectation that can drift apart.
 */

import {
  computeIoImage,
  IMAGE_AREAS_BAREMETAL,
  IMAGE_AREAS_RUNTIME_V4,
} from '@root/backend/shared/compile/steps/compute-io-image'
import { generateImageConf } from '@root/backend/shared/compile/steps/generate-image-conf'
import type { DevicePin, PLCProjectData, PLCVariable } from '@root/middleware/shared/ports/types'
import type { BoardInfoLike } from '@root/middleware/shared/utils/target-capabilities'

import { buildIoDiagnostics, type IoDiagnosticsInput, toSizerProjectData } from '../io-diagnostics'

const RUNTIME_V4: BoardInfoLike = { compiler: 'openplc-compiler' }
const ARDUINO: BoardInfoLike = { compiler: 'arduino-cli' }
const SIMULATOR: BoardInfoLike = { compiler: 'simulator' }
/** v3 declares the same compiler as v4, so only the board NAME separates them. */
const RUNTIME_V3_BOARD = 'OpenPLC Runtime v3'

const variable = (name: string, location: string, type?: PLCVariable['type']): PLCVariable => ({
  name,
  location,
  documentation: '',
  type: type ?? { definition: 'base-type', value: 'BOOL' },
})

const arrayVar = (name: string, location: string, start: number, end: number, base = 'WORD'): PLCVariable =>
  variable(name, location, {
    definition: 'array',
    value: `ARRAY [${start}..${end}] OF ${base}`,
    data: {
      baseType: { definition: 'base-type', value: base as 'WORD' },
      dimensions: [{ dimension: `${start}..${end}` }],
    },
  })

const pins = (...addresses: string[]): DevicePin[] =>
  addresses.map((address, index) => ({ pin: `${index}`, pinType: 'digitalInput' as const, address }))

function makeProject(options: {
  pous?: Array<{ name: string; variables: PLCVariable[] }>
  globals?: PLCVariable[]
  servers?: unknown[]
  remoteDevices?: unknown[]
}): PLCProjectData {
  return {
    pous: (options.pous ?? []).map((pou) => ({
      name: pou.name,
      pouType: 'program',
      interface: { variables: pou.variables },
      body: { language: 'st', value: '' },
      documentation: '',
    })),
    dataTypes: [],
    servers: options.servers as PLCProjectData['servers'],
    remoteDevices: options.remoteDevices as PLCProjectData['remoteDevices'],
    configurations: { resource: { tasks: [], instances: [], globalVariables: options.globals ?? [] } },
  }
}

function snapshot(overrides: Partial<IoDiagnosticsInput> = {}) {
  return buildIoDiagnostics({
    board: 'OpenPLC Runtime v4',
    boardInfo: RUNTIME_V4,
    projectData: makeProject({}),
    devicePinMapping: [],
    ...overrides,
  })
}

/** An arduino-cli target, i.e. the bare-metal branch. */
const BAREMETAL = { boardInfo: ARDUINO } as const

const areaFor = (result: ReturnType<typeof snapshot>, prefix: string) =>
  result.areas.find((area) => area.prefix === prefix)

describe('target', () => {
  it('names the runtime the pipeline would branch on', () => {
    expect(snapshot().target.kind).toBe('runtime-v4')
    expect(snapshot(BAREMETAL).target.kind).toBe('arduino-cli')
    expect(snapshot({ boardInfo: SIMULATOR }).target.kind).toBe('simulator')
    // Same compiler as v4 — only the name separates them.
    expect(snapshot({ board: RUNTIME_V3_BOARD, boardInfo: RUNTIME_V4 }).target.kind).toBe('runtime-v3')
  })

  it('says a runtime v3 or simulator target is not sized', () => {
    expect(snapshot().target.sizesTheImage).toBe(true)
    expect(snapshot({ board: RUNTIME_V3_BOARD, boardInfo: RUNTIME_V4 }).target.sizesTheImage).toBe(false)
    expect(snapshot({ boardInfo: SIMULATOR }).target.sizesTheImage).toBe(false)
  })

  it('reports an unresolved board as permissive rather than as having no producers', () => {
    const result = snapshot({ boardInfo: undefined })

    expect(result.target.resolved).toBe(false)
    // The permissive resolver, exactly as the store's recalculation uses it:
    // an unresolved board keeps every producer, so its addresses stay claimed.
    expect(result.target.inactiveProducers).toEqual([])
    expect(result.target.activeProducers).toEqual(['pin-mapping', 'vpp-io', 'modbus-tcp-remote', 'ethercat'])
  })

  it('splits the producers a target turns off from the ones it keeps', () => {
    const result = snapshot(BAREMETAL)

    expect(result.target.activeProducers).toContain('pin-mapping')
    expect(result.target.inactiveProducers).toContain('ethercat')
  })
})

describe('areas', () => {
  it('lists all fourteen tables whatever the target, so a zero is visible as a zero', () => {
    expect(snapshot().areas).toHaveLength(14)
    expect(snapshot(BAREMETAL).areas).toHaveLength(14)
  })

  it('marks an area the target has no buffer for as absent rather than as zero', () => {
    const v4 = areaFor(snapshot(), '%MX')
    const baremetal = areaFor(snapshot(BAREMETAL), '%MX')

    expect(v4?.present).toBe(true)
    expect(baremetal?.present).toBe(false)
    expect(IMAGE_AREAS_RUNTIME_V4.has('%MX')).toBe(true)
    expect(IMAGE_AREAS_BAREMETAL.has('%MX')).toBe(false)
  })

  it('carries the sizer sizes and origins verbatim', () => {
    const projectData = makeProject({
      pous: [{ name: 'main', variables: [variable('counter', '%MW4', { definition: 'base-type', value: 'INT' })] }],
    })
    const result = snapshot({ projectData })
    const image = computeIoImage({
      projectData: toSizerProjectData(projectData),
      devicePinMapping: [],
      capabilities: result.target.producerCapabilities,
      serverCapabilities: result.target.serverCapabilities,
      areas: IMAGE_AREAS_RUNTIME_V4,
    })

    for (const area of result.areas) {
      expect(area.size).toBe(image.sizes[area.prefix] ?? 0)
      expect(area.origin).toBe(image.origins[area.prefix] ?? null)
    }
    expect(areaFor(result, '%MW')).toMatchObject({ size: 5, origin: 'declarations' })
  })

  it('names the bare-metal macro for the areas that have one', () => {
    expect(areaFor(snapshot(), '%QW')?.macro).toBe('MAX_ANALOG_OUTPUT')
    expect(areaFor(snapshot(), '%IB')?.macro).toBeNull()
  })
})

describe('servers', () => {
  const modbus = {
    name: 'slave1',
    protocol: 'modbus-tcp',
    modbusSlaveConfig: { enabled: true, bufferMapping: { coils: { qxBits: 52 } } },
  }

  it('separates the screen switch, the target capability and which server was read', () => {
    const result = snapshot({ projectData: makeProject({ servers: [modbus] }) })

    expect(result.servers).toEqual([
      { name: 'slave1', protocol: 'modbus-tcp', enabled: true, runs: true, dispatched: true, sizes: true },
    ])
    expect(areaFor(result, '%QX')).toMatchObject({ size: 52, origin: 'modbus-server' })
  })

  it('shows a disabled server still sizing the image, which is what the sizer does', () => {
    const disabled = { ...modbus, modbusSlaveConfig: { ...modbus.modbusSlaveConfig, enabled: false } }
    const result = snapshot({ projectData: makeProject({ servers: [disabled] }) })

    expect(result.servers[0]).toMatchObject({ enabled: false, sizes: true })
    expect(areaFor(result, '%QX')?.size).toBe(52)
  })

  it('marks the protocols the sizer never dispatches, which nothing says today', () => {
    const result = snapshot({
      projectData: makeProject({ servers: [{ name: 'ua', protocol: 'opcua', opcuaServerConfig: {} }] }),
    })

    expect(result.servers[0]).toMatchObject({ protocol: 'opcua', dispatched: false, sizes: false })
    expect(areaFor(result, '%QW')?.size).toBe(0)
  })

  it('reads only the first server of a protocol, as the emitter does', () => {
    const second = { ...modbus, name: 'slave2' }
    const result = snapshot({ projectData: makeProject({ servers: [modbus, second] }) })

    expect(result.servers.map((server) => server.sizes)).toEqual([true, false])
  })

  it('reports a server the target does not run as not sizing', () => {
    const result = snapshot({
      ...BAREMETAL,
      projectData: makeProject({ servers: [{ name: 's7', protocol: 's7comm', s7commSlaveConfig: { server: {} } }] }),
    })

    expect(result.servers[0]).toMatchObject({ runs: false, sizes: false })
  })
})

describe('located declarations', () => {
  it('counts the slots an array claims, not one per declaration', () => {
    const result = snapshot({
      projectData: makeProject({ globals: [arrayVar('block', '%MW60', 0, 66)] }),
    })

    expect(result.located).toEqual([
      { scope: 'Global Variables', name: 'block', location: '%MW60', prefix: '%MW', slots: 67, issue: null },
    ])
  })

  it('flags a declaration nothing produces', () => {
    const result = snapshot({
      projectData: makeProject({ pous: [{ name: 'main', variables: [variable('orphan', '%QX0.0')] }] }),
    })

    expect(result.located[0]).toMatchObject({ name: 'orphan', issue: 'unbacked' })
    expect(result.issues.unbacked).toHaveLength(1)
  })

  it('flags an area the target does not have', () => {
    const result = snapshot({
      ...BAREMETAL,
      projectData: makeProject({ globals: [variable('flag', '%MX0.0')] }),
    })

    expect(result.located[0]).toMatchObject({ name: 'flag', issue: 'unsupported' })
    expect(result.issues.unsupported).toHaveLength(1)
  })

  it('flags both writers of a duplicated output, not just the second', () => {
    const result = snapshot({
      devicePinMapping: pins('%QX0.0'),
      ...BAREMETAL,
      projectData: makeProject({
        pous: [
          { name: 'a', variables: [variable('out1', '%QX0.0')] },
          { name: 'b', variables: [variable('out2', '%QX0.0')] },
        ],
      }),
    })

    expect(result.located.map((entry) => entry.issue)).toEqual(['duplicate-output', 'duplicate-output'])
    expect(result.issues.duplicateOutputs).toHaveLength(1)
  })

  it('leaves a declaration with no location out entirely', () => {
    const result = snapshot({
      projectData: makeProject({ pous: [{ name: 'main', variables: [variable('plain', '')] }] }),
    })

    expect(result.located).toEqual([])
  })
})

describe('producer claims', () => {
  it('attributes every claimed address to the producer that took it', () => {
    const result = snapshot({
      ...BAREMETAL,
      devicePinMapping: [{ pin: '2', pinType: 'digitalInput', address: '%IX0.1', alias: 'start_button' }],
    })

    expect(result.claims).toEqual([
      { address: '%IX0.1', prefix: '%IX', kind: 'pin-mapping', ref: expect.any(String), alias: 'start_button' },
    ])
  })

  it('drops the claims of a producer the target turns off', () => {
    // Runtime v4 has no pin mapping, so the same pins claim nothing there.
    expect(snapshot({ devicePinMapping: pins('%IX0.0') }).claims).toEqual([])
    expect(snapshot({ ...BAREMETAL, devicePinMapping: pins('%IX0.0') }).claims).toHaveLength(1)
  })

  it('reports two producers reaching for one address', () => {
    const result = snapshot({
      ...BAREMETAL,
      devicePinMapping: pins('%IX0.0', '%IX0.0'),
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.address).toBe('%IX0.0')
  })
})

describe('artifacts', () => {
  it('emits the image.conf the build would write', () => {
    const projectData = makeProject({ globals: [variable('w', '%MW2', { definition: 'base-type', value: 'INT' })] })
    const result = snapshot({ projectData })
    const image = computeIoImage({
      projectData: toSizerProjectData(projectData),
      devicePinMapping: [],
      capabilities: result.target.producerCapabilities,
      serverCapabilities: result.target.serverCapabilities,
      areas: IMAGE_AREAS_RUNTIME_V4,
    })

    expect(result.artifacts.imageConf).toBe(generateImageConf(image.sizes))
    expect(result.artifacts.imageConf).toContain('int_memory=3')
  })

  it('pads the bit macros for bare metal and leaves the word ones alone', () => {
    const result = snapshot({
      ...BAREMETAL,
      devicePinMapping: pins('%IX0.0', '%IX0.1', '%IX0.2'),
    })

    // Three bits round up to a whole byte for the firmware, which declares
    // `bool_input[MAX_DIGITAL_INPUT/8][8]` and divides.
    expect(result.artifacts.processImageDefines).toContain('#define MAX_DIGITAL_INPUT 8')
    expect(result.artifacts.processImageDefines).toContain('#define MAX_ANALOG_INPUT 0')
    // …while the image.conf keeps the raw high-water mark.
    expect(result.artifacts.imageConf).toContain('bool_input=3')
  })
})
