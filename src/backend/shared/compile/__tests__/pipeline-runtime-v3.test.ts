/**
 * Focused tests for the Runtime v3 branch of the shared compile pipeline.
 *
 * v3 is the legacy target that ingests a single `program.st` (not a v4
 * zip) and recompiles it on-device with MatIEC.  The pipeline must
 * therefore short-circuit to `uploadRuntimeV3` BEFORE any arduino-cli
 * step (core/lib install, firmware bundle, compile) — a regression
 * where the v3 branch sat after `installArduinoCore` made every v3
 * build die with "invalid empty core argument" (v3 has no Arduino
 * core).  These tests lock that ordering in.
 *
 * Kept in a separate file from `pipeline.test.ts` (which is stale from
 * the xml2st→JSON-transpiler migration and references the removed
 * `transpileXmlToSt` port method) so the v3 coverage compiles + runs
 * against the current `transpileToSt` contract.
 */

import type { DevicePin } from '../../types/PLC/devices'
import type { PLCProjectData } from '../../types/PLC/open-plc'
import type {
  CompilerPlatformPort,
  PlatformDeviceContext,
} from '../../../../middleware/shared/ports/compiler-platform-port'

jest.mock('../../utils/PLC/xml-generator', () => ({ XmlGenerator: jest.fn() }))
jest.mock('../../library/program-build-pipeline', () => ({ runProgramBuildPipeline: jest.fn() }))
jest.mock('../../library/program-build-helpers', () => ({
  buildKnownPous: jest.fn(() => []),
  emitCompileErrorEvents: jest.fn(),
}))
jest.mock('../../firmware/build-arduino-cli-args', () => ({
  buildArduinoCliCompileArgs: jest.fn(() => ['compile', '-b', 'arduino:avr:mega']),
}))
jest.mock('../../firmware/runtime-version-gate', () => ({
  isStrucppCompatibleRuntime: jest.fn(() => true),
  describeIncompatibleRuntime: jest.fn((v: string | null) => `Runtime ${String(v)} too old`),
}))
jest.mock('../steps/generate-confs', () => ({
  generateRuntimeConfs: jest.fn(() => ({ modbusSlave: '', modbusMaster: '', s7Comm: '', opcUa: null, ethercat: '' })),
}))

import { runProgramBuildPipeline } from '../../library/program-build-pipeline'
import { type PipelineProgressEvent, runCompilePipeline, type RunCompilePipelineArgs } from '../pipeline'

const mockedStrucpp = runProgramBuildPipeline as jest.MockedFunction<typeof runProgramBuildPipeline>

function makePort(overrides: Partial<CompilerPlatformPort> = {}): jest.Mocked<CompilerPlatformPort> {
  return {
    computeMd5: jest.fn().mockResolvedValue('a'.repeat(32)),
    transpileToSt: jest.fn().mockResolvedValue({ ok: true, programSt: 'PROGRAM main\nEND_PROGRAM' }),
    installArduinoCore: jest.fn().mockResolvedValue({ ok: true }),
    installArduinoLib: jest.fn().mockResolvedValue({ ok: true }),
    compileArduino: jest.fn().mockResolvedValue({ ok: true, binary: new Uint8Array([1]) }),
    uploadRuntimeV4: jest.fn().mockResolvedValue({ ok: true }),
    uploadArduinoBoard: jest.fn().mockResolvedValue({ ok: true }),
    uploadRuntimeV3: jest.fn().mockResolvedValue({ ok: true }),
    checkRuntimeVersion: jest.fn().mockResolvedValue({ ok: true, version: '3.0' }),
    packageVppPlugin: jest.fn().mockResolvedValue({ files: {} }),
    ...overrides,
  } as unknown as jest.Mocked<CompilerPlatformPort>
}

const deviceContext: PlatformDeviceContext = { kind: 'editor-https', ip: '192.168.1.199', jwt: 'jwt' }

function makeArgs(overrides: Partial<RunCompilePipelineArgs> = {}): RunCompilePipelineArgs {
  return {
    projectData: {
      pous: [],
      dataTypes: [],
      configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
      servers: [],
      remoteDevices: [],
    } as unknown as PLCProjectData,
    boardTarget: 'OpenPLC Runtime v3',
    boardRuntime: 'openplc-runtime',
    boardEntry: { platform: '', core: '', define: [] },
    devicePinMapping: [] as DevicePin[],
    isSimulator: false,
    isRuntimeV4: false,
    isRuntimeV3: true,
    compileOnly: false,
    libraryArchives: [],
    missingLibraries: [],
    firmwareSkeleton: {},
    strucppRuntimeHeaders: {},
    avrLibStdCppInclude: '',
    arduinoCliParallel: false,
    deviceContext,
    ...overrides,
  }
}

function captureEvents() {
  const events: PipelineProgressEvent[] = []
  return { events, emit: (e: PipelineProgressEvent) => events.push(e) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedStrucpp.mockReturnValue({
    success: true,
    files: [{ name: 'debug-map.json', content: '{}' }],
    errors: [],
    warnings: [],
    md5Hash: 'a'.repeat(32),
    splitterFallbackMessage: null,
    debugMapSummary: null,
  })
})

describe('runCompilePipeline — Runtime v3 branch', () => {
  it('uploads program.st via uploadRuntimeV3 WITHOUT touching any arduino-cli step', async () => {
    const port = makePort()
    const { events, emit } = captureEvents()

    const result = await runCompilePipeline(makeArgs(), port, emit)

    expect(result).toEqual({ success: true, md5: 'a'.repeat(32), uploaded: true })
    // The regression guard: v3 must never reach the Arduino path.
    expect(port.installArduinoCore).not.toHaveBeenCalled()
    expect(port.installArduinoLib).not.toHaveBeenCalled()
    expect(port.compileArduino).not.toHaveBeenCalled()
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
    // Strucpp still runs as an error-check before upload.
    expect(mockedStrucpp).toHaveBeenCalledTimes(1)
    expect(port.uploadRuntimeV3).toHaveBeenCalledTimes(1)
    expect(events.map((e) => e.stage)).toContain('done')
  })

  it('passes the plain program.st (no FILE markers) when there are no C/C++ POUs', async () => {
    const port = makePort()
    const { emit } = captureEvents()

    await runCompilePipeline(makeArgs(), port, emit)

    const [uploadArg] = port.uploadRuntimeV3.mock.calls[0]
    expect(uploadArg.programSt).toBe('PROGRAM main\nEND_PROGRAM')
    expect(uploadArg.programSt).not.toContain('(*FILE:')
  })

  it('skips upload in compileOnly mode', async () => {
    const port = makePort()
    const { emit } = captureEvents()

    const result = await runCompilePipeline(makeArgs({ compileOnly: true }), port, emit)

    expect(result).toEqual({ success: true, md5: 'a'.repeat(32), uploaded: false })
    expect(port.uploadRuntimeV3).not.toHaveBeenCalled()
    expect(port.installArduinoCore).not.toHaveBeenCalled()
  })

  it('warns and skips upload when no device context is configured', async () => {
    const port = makePort()
    const { events, emit } = captureEvents()

    const result = await runCompilePipeline(makeArgs({ deviceContext: undefined }), port, emit)

    expect(result.uploaded).toBe(false)
    expect(port.uploadRuntimeV3).not.toHaveBeenCalled()
    expect(events.some((e) => e.level === 'warning' && /v3 not configured/i.test(e.message))).toBe(true)
  })

  it('bails when uploadRuntimeV3 reports failure', async () => {
    const port = makePort({ uploadRuntimeV3: jest.fn().mockResolvedValue({ ok: false }) })
    const { emit } = captureEvents()

    const result = await runCompilePipeline(makeArgs(), port, emit)

    expect(result.success).toBe(false)
  })
})
