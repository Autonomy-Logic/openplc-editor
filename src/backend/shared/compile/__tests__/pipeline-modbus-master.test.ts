import type { DevicePin } from '../../types/PLC/devices'
import type { PLCProjectData } from '../../types/PLC/open-plc'
import type { CompilerPlatformPort } from '../../../../middleware/shared/ports/compiler-platform-port'
import type {
  ModbusIOGroup,
  ModbusRemoteTcpConfig,
  PLCRemoteDevice,
  PLCServer,
} from '../../../../middleware/shared/ports/types'
import { RUNTIME_V3_CAPABILITIES } from '../../../../middleware/shared/utils/target-capabilities'

jest.mock('../../library/program-build-pipeline', () => ({
  runProgramBuildPipeline: jest.fn(),
}))
jest.mock('../../library/program-build-helpers', () => ({
  buildKnownPous: jest.fn(() => []),
  emitCompileErrorEvents: jest.fn(),
}))
jest.mock('../../firmware/build-arduino-cli-args', () => ({
  buildArduinoCliCompileArgs: jest.fn(() => ['compile', '-b', 'arduino:avr:mega']),
}))
jest.mock('../../firmware/runtime-version-gate', () => ({
  isStrucppCompatibleRuntime: jest.fn(() => true),
  describeIncompatibleRuntime: jest.fn(() => ''),
  describeEditorTooOldForRuntime: jest.fn(() => ''),
  describeVppRuntimeMismatch: jest.fn(() => ''),
}))
jest.mock('../steps/generate-confs', () => ({
  generateRuntimeConfs: jest.fn(() => ({
    modbusSlave: '',
    modbusMaster: '',
    s7Comm: '',
    opcUa: null,
    ethercat: '',
    ethercatBusconfig: null,
    ethercatIomapping: null,
  })),
}))

import { runProgramBuildPipeline } from '../../library/program-build-pipeline'
import { type PipelineProgressEvent, runCompilePipeline, type RunCompilePipelineArgs } from '../pipeline'
import { generateRuntimeConfs } from '../steps/generate-confs'

type BoardEntry = RunCompilePipelineArgs['boardEntry']
type VppModbusState = RunCompilePipelineArgs['vppModbusState']
type Target = 'baremetal' | 'simulator' | 'runtime-v4' | 'runtime-v3'

const MEGA_ENTRY = {
  platform: 'arduino:avr:mega',
  core: 'arduino:avr',
  compiler: 'arduino-cli',
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true, networkSockets: 4 },
  vppScreenNames: ['Serial', 'Network'],
  define: [],
} as BoardEntry

/** The same Mega, with a package that ships the per-UART RS-485 pin map. */
const MEGA_PER_UART = { ...MEGA_ENTRY, perUartAware: true } as BoardEntry

const TARGETS: Record<
  Target,
  Pick<
    RunCompilePipelineArgs,
    'boardTarget' | 'boardRuntime' | 'boardEntry' | 'isSimulator' | 'isRuntimeV4' | 'isRuntimeV3'
  >
> = {
  baremetal: {
    boardTarget: 'Arduino Mega',
    boardRuntime: 'arduino-cli',
    boardEntry: MEGA_ENTRY,
    isSimulator: false,
    isRuntimeV4: false,
    isRuntimeV3: false,
  },
  simulator: {
    boardTarget: 'OpenPLC Simulator',
    boardRuntime: 'simulator',
    boardEntry: { platform: 'arduino:avr:mega', core: 'arduino:avr', compiler: 'simulator', define: [] } as BoardEntry,
    isSimulator: true,
    isRuntimeV4: false,
    isRuntimeV3: false,
  },
  'runtime-v4': {
    boardTarget: 'OpenPLC Runtime v4',
    boardRuntime: 'openplc-compiler',
    boardEntry: { platform: '', core: '', compiler: 'openplc-compiler', define: [] } as BoardEntry,
    isSimulator: false,
    isRuntimeV4: true,
    isRuntimeV3: false,
  },
  'runtime-v3': {
    boardTarget: 'OpenPLC Runtime v3',
    boardRuntime: 'openplc-compiler',
    boardEntry: {
      platform: '',
      core: '',
      compiler: 'openplc-compiler',
      capabilities: RUNTIME_V3_CAPABILITIES,
      define: [],
    } as BoardEntry,
    isSimulator: false,
    isRuntimeV4: false,
    isRuntimeV3: true,
  },
}

const STUB = '#ifndef MODBUS_MASTER_CONFIG_H\n#define MODBUS_MASTER_CONFIG_H\n#define MB_MASTER_ENABLED 0\n#endif\n'

const SKELETON = {
  'examples/Baremetal/Baremetal.ino': '// sketch',
  'src/arduino.cpp': '// hal',
  'src/modbus_master_config.h': STUB,
}

/** The support units the Simulator's WebAssembly build requires next to the skeleton. */
const SIMULATOR_SUPPORT = {
  'wasm-sim/sim_main.cpp': '// shim',
  'wasm-sim/sim_python.cpp': '// python blocks',
  'wasm-sim/core/api/Common.cpp': '// common',
  'wasm-sim/core/api/Print.cpp': '// print',
  'wasm-sim/core/api/Stream.cpp': '// stream',
  'wasm-sim/core/api/String.cpp': '// string',
}

const NETWORK_ON = { network: { enabled: true } } as VppModbusState

const group = (iecLocation: string, over: Partial<ModbusIOGroup> = {}): ModbusIOGroup => ({
  id: `g-${iecLocation}`,
  name: 'Inputs',
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 1,
  errorHandling: 'keep-last-value',
  ioPoints: [{ id: `p-${iecLocation}`, name: `p_${iecLocation}`, type: 'WORD', iecLocation }],
  ...over,
})

const tcp = (name: string, over: Partial<ModbusRemoteTcpConfig> = {}, iecLocation = '%IW0'): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'tcp',
    host: '10.0.0.5',
    port: 502,
    reconnect: true,
    slaveId: 1,
    timeout: 1000,
    ioGroups: [group(iecLocation)],
    ...over,
  },
})

const rtu = (name: string, over: Partial<ModbusRemoteTcpConfig> = {}, iecLocation = '%IW1'): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'rtu',
    serialPort: 'Serial1',
    baudRate: 9600,
    parity: 'N',
    stopBits: 1,
    dataBits: 8,
    slaveId: 1,
    timeout: 1000,
    ioGroups: [group(iecLocation)],
    ...over,
  },
})

const ETHERCAT_BUS: PLCRemoteDevice = { name: 'Bus', protocol: 'ethercat', ethercatConfig: { devices: [] } }

const rtuServer = (serialPort: string): PLCServer => ({
  name: 'Modbus',
  protocol: 'modbus-tcp',
  modbusSlaveConfig: {
    enabled: true,
    transports: ['rtu'],
    networkInterface: '0.0.0.0',
    port: 502,
    slaveId: 1,
    serialPort,
    baudRate: 19200,
  },
})

const remoteIoWarning = (boardTarget: string): string =>
  `Warning: Your project contains Remote IO configurations, but the selected target (${boardTarget}) does not support this feature. The remote device configurations will be ignored during compilation.`

function makePort() {
  const materializeRuntimeV4Bundle = jest.fn().mockResolvedValue({ written: 0 })
  const port = {
    computeMd5: jest.fn().mockResolvedValue('a'.repeat(32)),
    transpileToSt: jest.fn().mockResolvedValue({ ok: true, programSt: 'PROGRAM main\nEND_PROGRAM' }),
    compileArduino: jest.fn().mockResolvedValue({ ok: true, binary: new Uint8Array([1, 2, 3]) }),
    compileToWasm: jest.fn().mockResolvedValue({
      ok: true,
      wasm: new Uint8Array([0, 97, 115, 109]),
      stats: { units: 1, cached: 0 },
      diagnostics: [],
    }),
    uploadRuntimeV4: jest.fn().mockResolvedValue({ ok: true }),
    uploadArduinoBoard: jest.fn().mockResolvedValue({ ok: true }),
    uploadRuntimeV3: jest.fn().mockResolvedValue({ ok: true }),
    checkRuntimeVersion: jest.fn().mockResolvedValue({ ok: true, version: '4.1.0' }),
    packageVppPlugin: jest.fn().mockResolvedValue({ files: {} }),
    materializeRuntimeV4Bundle,
  } as unknown as jest.Mocked<CompilerPlatformPort>
  return { port, materializeRuntimeV4Bundle }
}

interface BuildOptions {
  remoteDevices?: PLCRemoteDevice[]
  servers?: PLCServer[]
  vppModbusState?: VppModbusState
  boardEntry?: BoardEntry
}

/** A compile-only build of an empty program carrying `remoteDevices`, with every event it emitted. */
async function build(target: Target, options: BuildOptions = {}) {
  const { port, materializeRuntimeV4Bundle } = makePort()
  const events: PipelineProgressEvent[] = []
  const projectData = {
    pous: [],
    dataTypes: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
    servers: options.servers ?? [],
    remoteDevices: options.remoteDevices ?? [],
  } as unknown as PLCProjectData

  const result = await runCompilePipeline(
    {
      projectData,
      hmi: null,
      ...TARGETS[target],
      ...(options.boardEntry ? { boardEntry: options.boardEntry } : {}),
      devicePinMapping: [] as DevicePin[],
      compileOnly: true,
      libraryArchives: [],
      missingLibraries: [],
      firmwareSkeleton: target === 'simulator' ? { ...SKELETON, ...SIMULATOR_SUPPORT } : SKELETON,
      strucppRuntimeHeaders: {},
      avrLibStdCppInclude: '',
      arduinoCliParallel: false,
      ...(options.vppModbusState ? { vppModbusState: options.vppModbusState } : {}),
    },
    port,
    (event) => events.push(event),
  )

  const compileCall = port.compileArduino.mock.calls[0] ?? port.compileToWasm.mock.calls[0]
  const files = compileCall ? (compileCall[0].files as Record<string, string>) : undefined
  const materializeCall = materializeRuntimeV4Bundle.mock.calls[0] as [{ bundle: Record<string, string> }] | undefined
  return { result, events, port, files, bundle: materializeCall?.[0].bundle, materializeRuntimeV4Bundle }
}

const validateErrors = (events: PipelineProgressEvent[]): string[] =>
  events.filter((event) => event.stage === 'validate' && event.level === 'error').map((event) => event.message)

const remoteIoEvents = (events: PipelineProgressEvent[]): PipelineProgressEvent[] =>
  events.filter((event) => event.message.includes('Remote IO'))

const definesOf = (files: Record<string, string> | undefined): string =>
  Object.entries(files ?? {}).find(([name]) => name.endsWith('defines.h'))?.[1] ?? ''

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(runProgramBuildPipeline).mockReturnValue({
    success: true,
    files: [{ name: 'debug-map.json', content: '{}' }],
    errors: [],
    warnings: [],
    md5Hash: 'a'.repeat(32),
    splitterFallbackMessage: null,
    debugMapSummary: null,
    retainBlobSize: null,
  })
})

describe('pipeline: Modbus master refusals in the validate stage', () => {
  it('refuses a baremetal project at validate and hands nothing to the compiler (TC09)', async () => {
    const { result, events, port } = await build('baremetal', {
      remoteDevices: [rtu('Pump', { serialPort: 'Serial' })],
    })

    expect(result.success).toBe(false)
    expect(validateErrors(events)).toContain(`Remote device "Pump" uses Serial, the debugger's UART.`)
    expect(port.compileArduino).not.toHaveBeenCalled()
    expect(events.some((event) => event.stage === 'firmware-bundle' || event.stage === 'arduino-compile')).toBe(false)
    expect(events[events.length - 1]).toEqual({
      stage: 'error',
      message: 'Stopping compilation process.',
      level: 'error',
    })
  })

  it('names every refusal before it stops (TC14)', async () => {
    const { result, events } = await build('baremetal', {
      remoteDevices: [rtu('Pump', { serialPort: 'Serial' }), tcp('Gateway', { host: 'plc.local' })],
      vppModbusState: NETWORK_ON,
    })

    expect(result.success).toBe(false)
    expect(validateErrors(events)).toEqual(
      expect.arrayContaining([
        `Remote device "Pump" uses Serial, the debugger's UART.`,
        'Remote device "Gateway" does not support the host "plc.local": use an IP address.',
      ]),
    )
  })

  it("refuses an RTU device on the Modbus RTU server's UART (TC09)", async () => {
    const { result, events } = await build('baremetal', {
      remoteDevices: [rtu('Pump', { serialPort: 'Serial1' })],
      servers: [rtuServer('Serial1')],
    })

    expect(result.success).toBe(false)
    expect(validateErrors(events)).toContain(`Remote device "Pump" uses Serial1, the Modbus RTU server's UART.`)
  })

  it('refuses a TCP device when the build brings no network up', async () => {
    const { result, events } = await build('baremetal', { remoteDevices: [tcp('Pump')] })

    expect(result.success).toBe(false)
    expect(validateErrors(events)).toContain('Remote device "Pump" does not support TCP without the network enabled.')
  })

  it('refuses an out-of-range field before defines.h is written (AS-05)', async () => {
    const { result, events, port } = await build('baremetal', {
      remoteDevices: [tcp('Gateway', { port: 0 })],
      vppModbusState: NETWORK_ON,
    })

    expect(result.success).toBe(false)
    expect(validateErrors(events).some((message) => message.includes('Gateway') && /port/i.test(message))).toBe(true)
    expect(port.compileArduino).not.toHaveBeenCalled()
  })

  it('refuses mismatched Reconnect on Runtime v4 before the bundle is composed (FR08)', async () => {
    const { result, events, port, materializeRuntimeV4Bundle } = await build('runtime-v4', {
      remoteDevices: [tcp('A', { reconnect: true }), tcp('B', { slaveId: 2, reconnect: false }, '%IW1')],
    })

    expect(result.success).toBe(false)
    expect(validateErrors(events)).toContain('Remote devices "A" and "B" on 10.0.0.5:502 disagree on Reconnect.')
    expect(generateRuntimeConfs).not.toHaveBeenCalled()
    expect(materializeRuntimeV4Bundle).not.toHaveBeenCalled()
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
  })

  it('refuses mismatched line settings on Runtime v4 (FR09)', async () => {
    const { result, events } = await build('runtime-v4', {
      remoteDevices: [
        rtu('A', { serialPort: '/dev/ttyUSB0', baudRate: 9600 }),
        rtu('B', { serialPort: '/dev/ttyUSB0', baudRate: 19200, slaveId: 2 }, '%IW2'),
      ],
    })

    expect(result.success).toBe(false)
    expect(
      validateErrors(events).some((message) => message.startsWith('Remote devices "A" and "B" on /dev/ttyUSB0')),
    ).toBe(true)
  })

  it('refuses mismatched Reconnect on the Simulator (FR08)', async () => {
    const { result, events, port } = await build('simulator', {
      remoteDevices: [tcp('A', { reconnect: true }), tcp('B', { slaveId: 2, reconnect: false }, '%IW1')],
    })

    expect(result.success).toBe(false)
    expect(validateErrors(events)).toContain('Remote devices "A" and "B" on 10.0.0.5:502 disagree on Reconnect.')
    expect(port.compileToWasm).not.toHaveBeenCalled()
  })

  it('builds a project the Simulator can only ignore, with a hostname and a host serial port', async () => {
    const { result, events } = await build('simulator', {
      remoteDevices: [tcp('A', { host: 'plc.local' }), rtu('B', { serialPort: '/dev/ttyUSB0' })],
    })

    expect(validateErrors(events)).toEqual([])
    expect(result.success).toBe(true)
  })

  it('builds a Runtime v4 project with a hostname and a host serial port', async () => {
    const { result, events } = await build('runtime-v4', {
      remoteDevices: [tcp('A', { host: 'plc.local' }), rtu('B', { serialPort: '/dev/ttyUSB0' })],
    })

    expect(validateErrors(events)).toEqual([])
    expect(result.success).toBe(true)
  })
})

describe('pipeline: socket budget (TC15)', () => {
  it('warns when the TCP endpoints exceed the declared sockets and builds on', async () => {
    const remoteDevices = Array.from({ length: 5 }, (_, i) => tcp(`D${i}`, { host: `10.0.0.${i + 1}` }, `%IW${i}`))
    const { result, events, files } = await build('baremetal', { remoteDevices, vppModbusState: NETWORK_ON })

    expect(events).toContainEqual({
      stage: 'validate',
      level: 'warning',
      message: '5 TCP endpoints exceed the 4 network sockets this board declares.',
    })
    expect(result.success).toBe(true)
    expect(files?.['src/modbus_master_config.h']).toMatch(/#\s*define\s+MB_MASTER_ENDPOINT_COUNT\s+5\b/)
  })
})

describe('pipeline: modbus_master_config.h', () => {
  it('composes the header for a baremetal project with a Modbus remote device', async () => {
    const { result, files } = await build('baremetal', { remoteDevices: [rtu('Drive', { serialPort: 'Serial1' })] })

    expect(result.success).toBe(true)
    expect(files?.['src/modbus_master_config.h']).toMatch(/#\s*define\s+MB_MASTER_ENABLED\s+1\b/)
    expect(files?.['src/modbus_master_config.h']).toMatch(/#\s*define\s+MB_MASTER_RTU_ENABLED\s+1\b/)
  })

  it('composes the header for a baremetal TCP device with the network on', async () => {
    const { result, files } = await build('baremetal', {
      remoteDevices: [tcp('Pump', { host: '192.168.1.20' })],
      vppModbusState: NETWORK_ON,
    })

    expect(result.success).toBe(true)
    expect(files?.['src/modbus_master_config.h']).toMatch(/#\s*define\s+MB_MASTER_TCP_ENABLED\s+1\b/)
  })

  it('puts no master define in defines.h', async () => {
    const { files } = await build('baremetal', { remoteDevices: [rtu('Drive', { serialPort: 'Serial1' })] })

    expect(definesOf(files)).not.toMatch(/MB_MASTER/)
  })

  it('hands the per-UART RS-485 pin of the bus to the header', async () => {
    const { files } = await build('baremetal', {
      boardEntry: MEGA_PER_UART,
      remoteDevices: [rtu('Drive', { serialPort: 'Serial2' })],
      vppModbusState: { serial: { baud_rate: '115200', rs485_en_pins: { Serial2: '22' } } } as VppModbusState,
    })

    expect(files?.['src/modbus_master_config.h']).toMatch(/\{\s*&\s*Serial2\s*,[^{}]*,\s*22\s*\}/)
  })

  it('keeps the skeleton stub for a baremetal project without remote devices', async () => {
    const { result, files } = await build('baremetal')

    expect(result.success).toBe(true)
    expect(files?.['src/modbus_master_config.h']).toBe(STUB)
  })

  it('keeps the skeleton stub when the only remote device is not Modbus', async () => {
    const { files } = await build('baremetal', { remoteDevices: [ETHERCAT_BUS] })

    expect(files?.['src/modbus_master_config.h']).toBe(STUB)
  })

  it('keeps the skeleton stub on the Simulator', async () => {
    const { result, files } = await build('simulator', { remoteDevices: [rtu('Drive', { serialPort: 'Serial1' })] })

    expect(result.success).toBe(true)
    expect(files?.['src/modbus_master_config.h']).toBe(STUB)
  })

  it('puts no header in the Runtime v4 bundle', async () => {
    const { result, bundle } = await build('runtime-v4', { remoteDevices: [tcp('Pump')] })

    expect(result.success).toBe(true)
    expect(Object.keys(bundle ?? {}).filter((path) => path.includes('modbus_master_config'))).toEqual([])
  })
})

describe('pipeline: the stored RS-485 pin of a master UART (CR-1, BR15)', () => {
  const storedSerial = (serial: Record<string, unknown>): VppModbusState =>
    JSON.parse(JSON.stringify({ serial: { baud_rate: '115200', ...serial } }))

  const buildDrive = (serial: Record<string, unknown>) =>
    build('baremetal', {
      boardEntry: MEGA_PER_UART,
      remoteDevices: [rtu('Drive', { serialPort: 'Serial2' })],
      vppModbusState: storedSerial(serial),
    })

  const busPin = (header: string | undefined, uart: string): string | undefined =>
    new RegExp(`\\{\\s*&\\s*${uart}\\s*,[^{}]*,\\s*([^,{}\\s]+)\\s*\\}`).exec(header ?? '')?.[1]

  it.each([
    ['-1', 'Serial2: RS-485 pin "-1" is not a pin name such as 22, A0 or PA14.'],
    ['22 ', 'Serial2: RS-485 pin "22 " is not a pin name such as 22, A0 or PA14.'],
    ['d5', 'Serial2: RS-485 pin "d5" is not a pin name such as 22, A0 or PA14.'],
    [22, 'Serial2: RS-485 pin 22 is not a pin name such as 22, A0 or PA14.'],
  ])('refuses the stored pin %j at validate and hands nothing to the compiler', async (pin, message) => {
    const { result, events, port } = await buildDrive({ rs485_en_pins: { Serial2: pin } })

    expect(result.success).toBe(false)
    expect(validateErrors(events)).toContain(message)
    expect(port.compileArduino).not.toHaveBeenCalled()
  })

  it('builds with a valid stored pin and gives it to the Serial2 bus', async () => {
    const { result, files } = await buildDrive({ rs485_en_pins: { Serial2: '22' } })

    expect(result.success).toBe(true)
    expect(busPin(files?.['src/modbus_master_config.h'], 'Serial2')).toBe('22')
  })

  it('builds with an empty stored pin and leaves the Serial2 bus without a pin', async () => {
    const { result, files } = await buildDrive({ rs485_en_pins: { Serial2: '' } })

    expect(result.success).toBe(true)
    expect(busPin(files?.['src/modbus_master_config.h'], 'Serial2')).toBe('MB_MASTER_NO_PIN')
  })

  it('builds with an invalid stored pin on a UART no device uses, and puts no Serial3 pin in the header', async () => {
    const { result, files } = await buildDrive({ rs485_en_pins: { Serial3: '-1' } })

    expect(result.success).toBe(true)
    expect(files?.['src/modbus_master_config.h']).not.toMatch(/\bSerial3\b/)
  })

  it('builds with an invalid legacy pin when there is no Modbus RTU server to map it to', async () => {
    const { result, events } = await buildDrive({ enable_rs485_en_pin: true, rs485_en_pin: '-1' })

    expect(validateErrors(events)).toEqual([])
    expect(result.success).toBe(true)
  })
})

describe('pipeline: the Remote IO warning comes from the validate stage', () => {
  it('warns on Runtime v3 with the new text and builds on without any master check (TC23)', async () => {
    const { result, events } = await build('runtime-v3', {
      remoteDevices: [
        tcp('A', { host: 'plc.local', reconnect: true }),
        tcp('B', { host: 'plc.local', slaveId: 2, reconnect: false }, '%IW1'),
        rtu('C', { serialPort: '/dev/ttyUSB0' }, '%IW2'),
      ],
    })

    expect(remoteIoEvents(events)).toEqual([
      { stage: 'validate', level: 'warning', message: remoteIoWarning('OpenPLC Runtime v3') },
    ])
    expect(events.some((event) => event.message.includes('only supported on OpenPLC Runtime v4'))).toBe(false)
    expect(validateErrors(events)).toEqual([])
    expect(result.success).toBe(true)
  })

  it('warns on Runtime v3 when the only remote device is not Modbus', async () => {
    const { events } = await build('runtime-v3', { remoteDevices: [ETHERCAT_BUS] })

    expect(remoteIoEvents(events).map((event) => event.message)).toEqual([remoteIoWarning('OpenPLC Runtime v3')])
  })

  it('says nothing on Runtime v3 without remote devices', async () => {
    const { events } = await build('runtime-v3')

    expect(remoteIoEvents(events)).toEqual([])
  })

  it('warns on the Simulator with the same text', async () => {
    const { events } = await build('simulator', { remoteDevices: [tcp('A')] })

    expect(remoteIoEvents(events)).toEqual([
      { stage: 'validate', level: 'warning', message: remoteIoWarning('OpenPLC Simulator') },
    ])
  })

  it('never warns on baremetal', async () => {
    const { events } = await build('baremetal', { remoteDevices: [rtu('Drive', { serialPort: 'Serial1' })] })

    expect(remoteIoEvents(events)).toEqual([])
  })

  it('never warns on Runtime v4', async () => {
    const { events } = await build('runtime-v4', { remoteDevices: [tcp('Pump')] })

    expect(remoteIoEvents(events)).toEqual([])
  })
})
