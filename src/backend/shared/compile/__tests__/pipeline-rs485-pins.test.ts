import type { DevicePin } from '../../types/PLC/devices'
import type { PLCProjectData } from '../../types/PLC/open-plc'
import type { CompilerPlatformPort } from '../../../../middleware/shared/ports/compiler-platform-port'
import type { InstalledPackage, PackageManifest, PLCServer } from '../../../../middleware/shared/ports/types'

jest.mock('../../library/program-build-pipeline', () => ({
  runProgramBuildPipeline: jest.fn(),
}))
jest.mock('../../library/program-build-helpers', () => ({
  buildKnownPous: jest.fn(() => []),
  emitCompileErrorEvents: jest.fn(),
}))
jest.mock('../../firmware/build-arduino-cli-args', () => ({
  buildArduinoCliCompileArgs: jest.fn(() => ['compile', '-b', 'STMicroelectronics:stm32:GenF1']),
}))
jest.mock('../../firmware/runtime-version-gate', () => ({
  isStrucppCompatibleRuntime: jest.fn(() => true),
  describeIncompatibleRuntime: jest.fn(() => ''),
  describeEditorTooOldForRuntime: jest.fn(() => ''),
  describeVppRuntimeMismatch: jest.fn(() => ''),
}))

import { BoardInfoResolver } from '../../hardware/board-info-resolver'
import { runProgramBuildPipeline } from '../../library/program-build-pipeline'
import { runCompilePipeline, type RunCompilePipelineArgs } from '../pipeline'
import { resolveBoardSelection } from '../steps/resolve-board-selection'

type ManifestDevice = PackageManifest['devices'][number]
type BoardEntry = RunCompilePipelineArgs['boardEntry']

const WS3U: ManifestDevice = {
  id: 'ws3u-14mx',
  name: 'WS3U-14Mx',
  preview: 'assets/boards/ws3u.png',
  target: { type: 'arduino-cli', core: 'STMicroelectronics:stm32', platform: 'STMicroelectronics:stm32:GenF1' },
  hal: { type: 'arduino-hal', source: 'hal/fx3u.cpp' },
  serialPorts: ['Serial', 'Serial3'],
  defaultSerial: 'Serial',
  rs485FixedPins: { Serial3: 'PA14' },
}

const MANIFEST: PackageManifest = {
  formatVersion: '1.0',
  package: {
    id: 'com.openplc.fx3u-compatible',
    name: 'FX3U-compatible boards',
    version: '1.0.0',
    vendor: { name: 'OpenPLC', logo: 'assets/logo.png' },
    description: '',
  },
  devices: [WS3U],
}

const PKG: InstalledPackage = {
  packageId: 'com.openplc.fx3u-compatible',
  version: '1.0.0',
  installedAt: '2026-11-13T00:00:00.000Z',
  path: '/fake/packages/com.openplc.fx3u-compatible',
  devices: ['ws3u-14mx'],
}

/** The FX3U board entry exactly as the build resolves it. */
function fx3uEntry(): BoardEntry {
  const resolver = new BoardInfoResolver({
    halsContent: {},
    packageManager: {
      listInstalled: () => [PKG],
      getInstalledPackageManifest: (id) => (id === PKG.packageId ? MANIFEST : null),
    },
    resolveHalSourcePath: (rel) => `/fake/sources/${rel}`,
    resolvePackageRelativePath: (pkg, rel) => `${pkg}/${rel}`,
  })
  const selection = resolveBoardSelection(resolver, 'WS3U-14Mx')
  if (!selection.ok) throw new Error(selection.error)
  return selection.boardEntry
}

const MEGA_BASE = {
  platform: 'arduino:avr:mega',
  core: 'arduino:avr',
  compiler: 'arduino-cli',
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
}

/** A Mega whose package ships the `uart-pin-map` field. */
const MEGA_PER_UART = { ...MEGA_BASE, perUartAware: true } as BoardEntry
/** A Mega whose package keeps today's Serial screen. */
const MEGA_LEGACY = { ...MEGA_BASE, perUartAware: false } as BoardEntry

const rtuServer = (serialPort?: string): PLCServer => ({
  name: 'Modbus',
  protocol: 'modbus-tcp',
  modbusSlaveConfig: {
    enabled: true,
    transports: ['rtu'],
    networkInterface: '0.0.0.0',
    port: 502,
    slaveId: 1,
    ...(serialPort ? { serialPort, baudRate: 19200 } : {}),
  },
})

const LEGACY_PIN = { serial: { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: '17' } }

function makePort(): jest.Mocked<CompilerPlatformPort> {
  return {
    computeMd5: jest.fn().mockResolvedValue('a'.repeat(32)),
    transpileToSt: jest.fn().mockResolvedValue({ ok: true, programSt: 'PROGRAM main\nEND_PROGRAM' }),
    compileArduino: jest.fn().mockResolvedValue({ ok: true, binary: new Uint8Array([1, 2, 3]) }),
    uploadRuntimeV4: jest.fn().mockResolvedValue({ ok: true }),
    uploadArduinoBoard: jest.fn().mockResolvedValue({ ok: true }),
    uploadRuntimeV3: jest.fn().mockResolvedValue({ ok: true }),
    checkRuntimeVersion: jest.fn().mockResolvedValue({ ok: true, version: '4.1.0' }),
    packageVppPlugin: jest.fn().mockResolvedValue({ files: {} }),
  } as unknown as jest.Mocked<CompilerPlatformPort>
}

/** Builds for `boardEntry` with one Modbus RTU server and returns the `defines.h` handed to the compiler. */
async function buildDefines(
  boardEntry: BoardEntry,
  server: PLCServer,
  vppModbusState: RunCompilePipelineArgs['vppModbusState'],
): Promise<string> {
  const port = makePort()
  const projectData = {
    pous: [],
    dataTypes: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
    servers: [server],
    remoteDevices: [],
  } as unknown as PLCProjectData

  await runCompilePipeline(
    {
      projectData,
      boardTarget: 'Board',
      boardRuntime: 'arduino-cli',
      boardEntry,
      devicePinMapping: [] as DevicePin[],
      isSimulator: false,
      isRuntimeV4: false,
      isRuntimeV3: false,
      compileOnly: true,
      libraryArchives: [],
      missingLibraries: [],
      firmwareSkeleton: { 'examples/Baremetal/Baremetal.ino': '// sketch', 'src/arduino.cpp': '// hal' },
      strucppRuntimeHeaders: {},
      avrLibStdCppInclude: '/usr/avr/include',
      arduinoCliParallel: false,
      vppModbusState,
    },
    port,
    () => undefined,
  )

  expect(port.compileArduino).toHaveBeenCalledTimes(1)
  const files = port.compileArduino.mock.calls[0][0].files as Record<string, string>
  return Object.entries(files).find(([name]) => name.endsWith('defines.h'))?.[1] ?? ''
}

const txPinLines = (defines: string): string[] => defines.split('\n').filter((line) => line.includes('MBSERIAL_TXPIN'))

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

describe('defines.h RS-485 pin through the board hand-off', () => {
  it('emits the fixed pin of the FX3U when the RTU server uses that UART', async () => {
    const defines = await buildDefines(fx3uEntry(), rtuServer('Serial3'), { serial: { baud_rate: '115200' } })

    expect(txPinLines(defines)).toEqual(['#define MBSERIAL_TXPIN PA14'])
  })

  it('lets the fixed pin win over a 4.3.x pin on the same UART', async () => {
    const defines = await buildDefines(fx3uEntry(), rtuServer('Serial3'), LEGACY_PIN)

    expect(txPinLines(defines)).toEqual(['#define MBSERIAL_TXPIN PA14'])
  })

  it("moves a 4.3.x pin to the RTU server's default UART on the FX3U", async () => {
    const defines = await buildDefines(fx3uEntry(), rtuServer(), LEGACY_PIN)

    expect(txPinLines(defines)).toEqual(['#define MBSERIAL_TXPIN 17'])
  })

  it("emits the per-UART pin of the RTU server's UART on a per-UART package", async () => {
    const defines = await buildDefines(MEGA_PER_UART, rtuServer('Serial2'), {
      serial: { baud_rate: '115200', rs485_en_pins: { Serial1: '22', Serial2: '23' } },
    })

    expect(txPinLines(defines)).toEqual(['#define MBSERIAL_TXPIN 23'])
  })

  it("emits nothing when the RTU server's UART has no pin on a per-UART package", async () => {
    const defines = await buildDefines(MEGA_PER_UART, rtuServer('Serial2'), {
      serial: { baud_rate: '115200', rs485_en_pins: { Serial1: '22' } },
    })

    expect(txPinLines(defines)).toEqual([])
    expect(defines).toContain('#define MBSERIAL\n')
  })

  it('builds the same defines.h for a 4.3.x project on a legacy and on a per-UART package', async () => {
    const legacy = await buildDefines(MEGA_LEGACY, rtuServer('Serial2'), LEGACY_PIN)
    const perUart = await buildDefines(MEGA_PER_UART, rtuServer('Serial2'), LEGACY_PIN)

    expect(txPinLines(legacy)).toEqual(['#define MBSERIAL_TXPIN 17'])
    expect(perUart).toBe(legacy)
  })

  it('emits no pin outside the pattern on a legacy package', async () => {
    const defines = await buildDefines(MEGA_LEGACY, rtuServer('Serial2'), {
      serial: { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: '2\n#define MBSERIAL_SLAVE 9' },
    })

    expect(txPinLines(defines)).toEqual([])
    expect(defines).not.toContain('#define MBSERIAL_SLAVE 9')
  })
})
