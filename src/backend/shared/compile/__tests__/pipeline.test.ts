/**
 * Tests for the shared compile pipeline orchestrator.
 *
 * The pipeline composes a bunch of shared helpers + four async port
 * methods.  Each branch (simulator / runtime v4 / runtime v3 /
 * arduino-direct, with `compileOnly` variants for each) is exercised
 * here by mocking the port + the heavy shared dependencies
 * (`runProgramBuildPipeline`).
 * The actual content-authoring steps (defines, confs, composers) are
 * covered by their own unit tests; this suite focuses on the
 * orchestration — call ordering, branch dispatch, error propagation,
 * emit-event payloads.
 */

import type { DevicePin } from '../../types/PLC/devices'
import type { PLCProjectData } from '../../types/PLC/open-plc'
import type {
  CompilerPlatformPort,
  PlatformDeviceContext,
} from '../../../../middleware/shared/ports/compiler-platform-port'

// Mocks for heavy shared deps.  Use `jest.fn()` so individual tests
// can override `.mockReturnValueOnce` / `.mockResolvedValueOnce`.
jest.mock('../../library/program-build-pipeline', () => ({
  runProgramBuildPipeline: jest.fn(),
}))
jest.mock('../../library/program-build-helpers', () => ({
  buildKnownPous: jest.fn(() => []),
  emitCompileErrorEvents: jest.fn(
    (errors: Array<{ formatted: string; raw: unknown }>, emit: (msg: string, level: 'error', err: unknown) => void) => {
      for (const err of errors) emit(err.formatted, 'error', err.raw)
    },
  ),
}))
jest.mock('../../firmware/build-arduino-cli-args', () => ({
  buildArduinoCliCompileArgs: jest.fn(() => ['compile', '-b', 'arduino:avr:mega']),
}))
jest.mock('../../firmware/runtime-version-gate', () => ({
  isStrucppCompatibleRuntime: jest.fn(() => true),
  describeIncompatibleRuntime: jest.fn(
    (v: string | null) => `Runtime ${String(v)} is too old; please upgrade to 4.1.0+.`,
  ),
}))
// Mock the conf-generator step so tests can deterministically force
// the runtime-v4 confs branch to throw (covers the pipeline's outer
// try/catch that wraps the EtherCAT / OPC-UA validators).  Default
// return value gives all branches a passing shape; individual tests
// override via `.mockImplementationOnce`.
jest.mock('../steps/generate-confs', () => ({
  generateRuntimeConfs: jest.fn(() => ({
    modbusSlave: '',
    modbusMaster: '',
    s7Comm: '',
    opcUa: null,
    ethercat: '',
  })),
}))

import { runProgramBuildPipeline } from '../../library/program-build-pipeline'
import { isStrucppCompatibleRuntime } from '../../firmware/runtime-version-gate'
import { generateRuntimeConfs } from '../steps/generate-confs'

import { runCompilePipeline, type RunCompilePipelineArgs, type PipelineProgressEvent } from '../pipeline'

const mockedConfs = generateRuntimeConfs as jest.MockedFunction<typeof generateRuntimeConfs>
const mockedStrucpp = runProgramBuildPipeline as jest.MockedFunction<typeof runProgramBuildPipeline>
const mockedVersionGate = isStrucppCompatibleRuntime as jest.MockedFunction<typeof isStrucppCompatibleRuntime>

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePort(overrides: Partial<CompilerPlatformPort> = {}): jest.Mocked<CompilerPlatformPort> {
  return {
    computeMd5: jest.fn().mockResolvedValue('a'.repeat(32)),
    transpileToSt: jest.fn().mockResolvedValue({ ok: true, programSt: 'PROGRAM main\nEND_PROGRAM' }),
    installArduinoCore: jest.fn().mockResolvedValue({ ok: true }),
    installArduinoLib: jest.fn().mockResolvedValue({ ok: true }),
    compileArduino: jest.fn().mockResolvedValue({ ok: true, binary: new Uint8Array([1, 2, 3]) }),
    uploadRuntimeV4: jest.fn().mockResolvedValue({ ok: true }),
    uploadArduinoBoard: jest.fn().mockResolvedValue({ ok: true }),
    uploadRuntimeV3: jest.fn().mockResolvedValue({ ok: true }),
    checkRuntimeVersion: jest.fn().mockResolvedValue({ ok: true, version: '4.1.0' }),
    packageVppPlugin: jest.fn().mockResolvedValue({ files: {} }),
    ...overrides,
  } as jest.Mocked<CompilerPlatformPort>
}

const projectDataFixture = {
  pous: [],
  dataTypes: [],
  configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
  servers: [],
  remoteDevices: [],
} as unknown as PLCProjectData

const deviceContextFixture: PlatformDeviceContext = {
  kind: 'editor-https',
  ip: '192.168.1.10',
  jwt: 'jwt-token',
}

function makeArgs(overrides: Partial<RunCompilePipelineArgs> = {}): RunCompilePipelineArgs {
  return {
    projectData: projectDataFixture,
    boardTarget: 'OpenPLC Simulator',
    boardRuntime: 'simulator',
    boardEntry: { platform: 'arduino:avr:mega', core: 'arduino:avr', define: ['__AVR_ATmega2560__'] },
    devicePinMapping: [] as DevicePin[],
    isSimulator: true,
    isRuntimeV4: false,
    isRuntimeV3: false,
    compileOnly: false,
    libraryArchives: [],
    missingLibraries: [],
    firmwareSkeleton: {
      'examples/Baremetal/Baremetal.ino': '// sketch',
      'src/arduino.cpp': '// hal',
    },
    strucppRuntimeHeaders: {},
    avrLibStdCppInclude: '/usr/avr/include',
    arduinoCliParallel: false,
    ...overrides,
  }
}

function captureEvents() {
  const events: PipelineProgressEvent[] = []
  return { events, emit: (e: PipelineProgressEvent) => events.push(e) }
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default-mock: strucpp succeeds with empty file map.
  mockedStrucpp.mockReturnValue({
    success: true,
    files: [{ name: 'debug-map.json', content: '{}' }],
    errors: [],
    warnings: [],
    md5Hash: 'a'.repeat(32),
    splitterFallbackMessage: null,
    debugMapSummary: null,
  })
  // Default-mock: version gate returns compatible.
  mockedVersionGate.mockReturnValue(true)
})

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('runCompilePipeline — simulator path', () => {
  it('runs preprocess → XML → ST → strucpp → arduino-compile and returns the firmware binary', async () => {
    const port = makePort()
    const { events, emit } = captureEvents()

    const result = await runCompilePipeline(makeArgs(), port, emit)

    expect(result.success).toBe(true)
    expect(result.binary).toBeInstanceOf(Uint8Array)
    expect(result.uploaded).toBe(false)
    expect(port.transpileToSt).toHaveBeenCalledTimes(1)
    // The pipeline hands the transpiler the (preprocessed) project IR and a
    // log callback; the port impl owns xml2st-vs-JSON backend selection and any
    // format-specific flags internally (see transpiler-mode.ts). The pipeline
    // stays format-agnostic — it only passes { projectData }.
    expect(port.transpileToSt).toHaveBeenCalledWith(
      expect.objectContaining({ projectData: expect.anything() }),
      expect.any(Function),
    )
    expect(port.compileArduino).toHaveBeenCalledTimes(1)
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
    expect(port.uploadArduinoBoard).not.toHaveBeenCalled()
    expect(events.map((e) => e.stage)).toContain('done')
  })

  it('calls compileArduino with the assembled file map + arduino-cli argv', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    await runCompilePipeline(
      makeArgs({
        firmwareSkeleton: { 'examples/Baremetal/Baremetal.ino': 'INO' },
      }),
      port,
      emit,
    )
    const [callArgs] = port.compileArduino.mock.calls[0]
    expect(callArgs.files['examples/Baremetal/Baremetal.ino']).toBe('INO')
    expect(callArgs.files['src/defines.h']).toContain('PROGRAM_MD5')
    expect(callArgs.argv).toEqual(['compile', '-b', 'arduino:avr:mega'])
  })

  it('calls installArduinoCore + installArduinoLib before compileArduino (no-op semantics for web)', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    // Jest's invocationCallOrder is global, monotonically increasing —
    // smaller value = called earlier.  This is the canonical way to
    // assert mock call ordering in jest.
    const coreOrder = port.installArduinoCore.mock.invocationCallOrder[0]
    const libOrder = port.installArduinoLib.mock.invocationCallOrder[0]
    const compileOrder = port.compileArduino.mock.invocationCallOrder[0]
    expect(coreOrder).toBeLessThan(compileOrder)
    expect(libOrder).toBeLessThan(compileOrder)
  })

  it('compileOnly returns success without invoking uploadArduinoBoard', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(makeArgs({ isSimulator: false, compileOnly: true }), port, emit)
    expect(result.success).toBe(true)
    expect(port.uploadArduinoBoard).not.toHaveBeenCalled()
  })
})

describe('runCompilePipeline — blank FBD variable guard', () => {
  const fbdPouWithEmptyVar = {
    type: 'program',
    data: {
      name: 'main',
      language: 'fbd',
      variables: [],
      documentation: '',
      body: {
        language: 'fbd',
        value: {
          name: 'main',
          rung: {
            comment: '',
            nodes: [
              {
                id: 'blk',
                type: 'block',
                position: { x: 0, y: 0 },
                draggable: true,
                selectable: true,
                data: { variant: { name: 'blink_py' }, variable: { name: 'BLINK_PY0' } },
              },
              {
                id: 'n1',
                type: 'output-variable',
                position: { x: 16, y: 32 },
                draggable: true,
                selectable: true,
                data: { variable: { name: '' } },
              },
            ],
            edges: [{ id: 'e1', source: 'blk', sourceHandle: 'blink_out', target: 'n1', targetHandle: 'in' }],
          },
        },
      },
    },
  }

  it('bails at the validate stage before XML generation when an FBD variable is unnamed', async () => {
    const port = makePort()
    const { events, emit } = captureEvents()

    const projectData = {
      ...projectDataFixture,
      pous: [fbdPouWithEmptyVar],
    } as unknown as PLCProjectData

    const result = await runCompilePipeline(makeArgs({ projectData }), port, emit)

    expect(result.success).toBe(false)
    // Validation runs before the transpile step.
    expect(port.transpileToSt).not.toHaveBeenCalled()
    // The user-facing error names the POU and the kind of block.
    const validateError = events.find((e) => e.stage === 'validate' && e.level === 'error')
    expect(validateError?.message).toContain('POU "main"')
    expect(validateError?.message).toContain('output variable block has no name')
    // Identifies what the block is wired to rather than raw coordinates.
    expect(validateError?.message).toContain('connected to "blink_out" of "BLINK_PY0"')
    expect(events.some((e) => e.message === 'Stopping compilation process.')).toBe(true)
  })
})

describe('runCompilePipeline — arduino direct path', () => {
  it('uploads to the physical board when isSimulator=false and not compileOnly', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        boardRuntime: 'arduino-cli',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(true)
    expect(port.uploadArduinoBoard).toHaveBeenCalledTimes(1)
  })

  it('runs the upload step on the arduino-cli path without a deviceContext (serial port comes from communicationPort)', async () => {
    // `deviceContext` is the editor-https / web-orchestrator
    // discriminator used by the runtime-v3/v4 transports — by the
    // time the pipeline reaches the Arduino-cli upload step, those
    // runtime branches have already returned, so deviceContext is
    // always undefined here.  Gating Arduino uploads on it was the
    // bug that surfaced as "uploads silently skipped" after the
    // VPP migration; the serial port for arduino-cli uploads comes
    // from `communicationPort`, not deviceContext.
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(makeArgs({ isSimulator: false, boardRuntime: 'arduino-cli' }), port, emit)
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(true)
    expect(port.uploadArduinoBoard).toHaveBeenCalledTimes(1)
  })

  it('returns success=false when uploadArduinoBoard reports failure', async () => {
    // arduino-direct upload path: deviceContext present, board picked,
    // but the port's upload fails (e.g. serial port busy).  The
    // pipeline must surface the failure with structured errors rather
    // than reporting a successful compile.
    const port = makePort({
      uploadArduinoBoard: jest.fn().mockResolvedValue({
        ok: false,
        errors: [{ message: 'avrdude: serial port busy', line: 0, column: 0, severity: 'error' }],
      }),
    })
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        boardRuntime: 'arduino-cli',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
    expect(port.uploadArduinoBoard).toHaveBeenCalledTimes(1)
    expect(events.some((e) => /Failed to upload to Arduino board/.test(e.message))).toBe(true)
  })
})

describe('runCompilePipeline — runtime v4 path', () => {
  it('composes the v4 bundle and uploads when deviceContext is present + runtime is compatible', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(true)
    expect(port.checkRuntimeVersion).toHaveBeenCalledTimes(1)
    expect(port.uploadRuntimeV4).toHaveBeenCalledTimes(1)
    // Arduino-cli compile is NOT invoked on the v4 path.
    expect(port.compileArduino).not.toHaveBeenCalled()
  })

  it('aborts when checkRuntimeVersion reports an incompatible runtime', async () => {
    mockedVersionGate.mockReturnValueOnce(false)
    const port = makePort({
      checkRuntimeVersion: jest.fn().mockResolvedValue({ ok: true, version: '4.0.5' }),
    })
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
    expect(events.some((e) => /too old|upgrade/i.test(e.message))).toBe(true)
  })

  it('compileOnly on v4 returns success without invoking checkRuntimeVersion or uploadRuntimeV4', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        compileOnly: true,
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(false)
    expect(port.checkRuntimeVersion).not.toHaveBeenCalled()
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
  })

  it('returns warning + success=true when deviceContext is missing on v4', async () => {
    const port = makePort()
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(false)
    expect(events.some((e) => e.level === 'warning' && /not configured/i.test(e.message))).toBe(true)
  })

  it('invokes packageVppPlugin on v4 after composeRuntimeV4Bundle, before uploadRuntimeV4', async () => {
    // The pre-refactor compileProgram called handleVendorPluginPackaging
    // unconditionally on the v4 path between bundle compose and upload;
    // the handler self-gated on whether the board is from a VPP package.
    // Mirror that ordering through the port.
    const callOrder: string[] = []
    const port = makePort({
      packageVppPlugin: jest.fn().mockImplementation(async () => {
        callOrder.push('vpp')
        return { files: {} }
      }),
      uploadRuntimeV4: jest.fn().mockImplementation(async () => {
        callOrder.push('upload')
        return { ok: true }
      }),
    })
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        boardTarget: 'SLM-RP4',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(port.packageVppPlugin).toHaveBeenCalledWith({ boardTarget: 'SLM-RP4' }, expect.any(Function))
    expect(callOrder).toEqual(['vpp', 'upload'])
  })

  it('merges packageVppPlugin files into the bundle passed to uploadRuntimeV4', async () => {
    const port = makePort({
      packageVppPlugin: jest.fn().mockResolvedValue({
        files: {
          'vpp_plugins.conf': 'slm_rp4_plugin,./build/vpp/libslm_rp4_plugin.so,1,1,./build/vpp/slm_rp4_plugin.json,\n',
          'conf/slm_rp4_plugin.json': '{"vendor":"slm","modules":[]}',
          'vpp_plugin/Makefile': 'all:\n\tgcc -c plugin.c\n',
          'vpp_plugin/checksum.sha256': 'cafef00d\n',
        },
      }),
    })
    const { emit } = captureEvents()
    await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        boardTarget: 'SLM-RP4',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    const uploadedBundle = (port.uploadRuntimeV4 as jest.Mock).mock.calls[0][0].bundle as Record<string, string>
    expect(uploadedBundle['vpp_plugins.conf']).toMatch(/^slm_rp4_plugin,/)
    expect(uploadedBundle['conf/slm_rp4_plugin.json']).toContain('"vendor":"slm"')
    expect(uploadedBundle['vpp_plugin/Makefile']).toContain('gcc -c plugin.c')
    expect(uploadedBundle['vpp_plugin/checksum.sha256']).toBe('cafef00d\n')
  })

  it('emits a log entry reporting the number of VPP plugin files merged into the bundle', async () => {
    // Pins the log line at pipeline.ts:466 that runs when VPP
    // packaging returns a non-empty file map.  Acts as a regression
    // guard for the "Merged N VPP plugin file(s) into bundle" UX —
    // without this assertion the count never gets exercised.
    const port = makePort({
      packageVppPlugin: jest.fn().mockResolvedValue({
        files: {
          'vpp_plugins.conf': 'slm,./build/vpp/libslm.so,1,1,./build/vpp/slm.json,\n',
          'conf/slm.json': '{}',
        },
      }),
    })
    const { events, emit } = captureEvents()
    await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(events.some((e) => /Merged 2 VPP plugin file\(s\) into bundle/.test(e.message))).toBe(true)
  })

  it('passes the project task instances through to generateRuntimeConfs in the expected shape', async () => {
    // Covers the `instances.map(inst => ({name, task, program}))`
    // lambda at pipeline.ts:410-417 — the v4 path's instance
    // remapping that feeds `generateRuntimeConfs`.  An empty default
    // fixture leaves the lambda body uncovered; this test populates
    // a real instance and asserts the remapped shape on the way out.
    const port = makePort()
    const { emit } = captureEvents()
    await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
        projectData: {
          ...projectDataFixture,
          configuration: {
            resource: {
              tasks: [],
              instances: [{ name: 'main0', task: 'MainTask', program: 'main' }],
              globalVariables: [],
            },
          },
        } as never,
      }),
      port,
      emit,
    )
    expect(mockedConfs).toHaveBeenCalledTimes(1)
    const passedInstances = mockedConfs.mock.calls[0][0].instances
    expect(passedInstances).toEqual([{ name: 'main0', task: 'MainTask', program: 'main' }])
  })

  it('aborts the v4 upload when packageVppPlugin reports errors', async () => {
    const port = makePort({
      packageVppPlugin: jest.fn().mockResolvedValue({
        files: {},
        errors: [{ message: 'VPP packaging exploded', line: 0, column: 0, severity: 'error' }],
      }),
    })
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
    expect(events.some((e) => /VPP plugin packaging failed/i.test(e.message))).toBe(true)
  })
})

describe('runCompilePipeline — runtime v3 path', () => {
  it('uploads via uploadRuntimeV3 (skips arduino-cli compile)', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV3: true,
        boardRuntime: 'arduino-cli',
        boardTarget: 'OpenPLC Runtime v3',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(true)
    expect(port.uploadRuntimeV3).toHaveBeenCalledTimes(1)
    expect(port.compileArduino).not.toHaveBeenCalled()
  })

  it('compileOnly on v3 returns success without invoking uploadRuntimeV3', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV3: true,
        boardRuntime: 'arduino-cli',
        boardTarget: 'OpenPLC Runtime v3',
        compileOnly: true,
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(false)
    expect(port.uploadRuntimeV3).not.toHaveBeenCalled()
  })

  it('warns + skips upload when v3 deviceContext is missing', async () => {
    const port = makePort()
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV3: true,
        boardRuntime: 'arduino-cli',
        boardTarget: 'OpenPLC Runtime v3',
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(result.uploaded).toBe(false)
    expect(port.uploadRuntimeV3).not.toHaveBeenCalled()
    expect(events.some((e) => e.level === 'warning' && /v3 not configured/i.test(e.message))).toBe(true)
  })

  it('returns success=false when uploadRuntimeV3 reports failure', async () => {
    const port = makePort({
      uploadRuntimeV3: jest.fn().mockResolvedValue({ ok: false }),
    })
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV3: true,
        boardRuntime: 'arduino-cli',
        boardTarget: 'OpenPLC Runtime v3',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
  })
})

describe('runCompilePipeline — strucpp informational outputs', () => {
  it('emits splitterFallbackMessage when strucpp reports one', async () => {
    mockedStrucpp.mockReturnValueOnce({
      success: true,
      files: [{ name: 'debug-map.json', content: '{}' }],
      errors: [],
      warnings: [],
      md5Hash: 'a'.repeat(32),
      splitterFallbackMessage: 'Falling back to monolithic compile (POU offsets unavailable).',
      debugMapSummary: null,
    })
    const port = makePort()
    const { events, emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    expect(
      events.some((e) => e.stage === 'st' && /Falling back to monolithic/.test(e.message) && e.level === 'info'),
    ).toBe(true)
  })

  it('emits debugMapSummary when strucpp reports one', async () => {
    mockedStrucpp.mockReturnValueOnce({
      success: true,
      files: [{ name: 'debug-map.json', content: '{}' }],
      errors: [],
      warnings: [],
      md5Hash: 'a'.repeat(32),
      splitterFallbackMessage: null,
      debugMapSummary: 'Debug map: 42 leaves in 3 arrays',
    })
    const port = makePort()
    const { events, emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    expect(events.some((e) => e.stage === 'st' && /Debug map: 42/.test(e.message))).toBe(true)
  })

  it('forwards strucpp warnings as level=warning events', async () => {
    mockedStrucpp.mockReturnValueOnce({
      success: true,
      files: [{ name: 'debug-map.json', content: '{}' }],
      errors: [],
      warnings: [
        { formatted: 'unused variable foo', raw: {} as never },
        { formatted: 'shadowed identifier bar', raw: {} as never },
      ],
      md5Hash: 'a'.repeat(32),
      splitterFallbackMessage: null,
      debugMapSummary: null,
    })
    const port = makePort()
    const { events, emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    const warningEvents = events.filter((e) => e.level === 'warning')
    expect(warningEvents.map((e) => e.message)).toEqual(
      expect.arrayContaining(['unused variable foo', 'shadowed identifier bar']),
    )
  })

  it('emits an "unknown warning" placeholder when a strucpp warning has no formatted text', async () => {
    mockedStrucpp.mockReturnValueOnce({
      success: true,
      files: [{ name: 'debug-map.json', content: '{}' }],
      errors: [],
      // `?? `-fallback fires on nullish values (undefined/null), not
      // empty strings — pass undefined to exercise the unknown-warning
      // path.
      warnings: [{ formatted: undefined as never, raw: {} as never }],
      md5Hash: 'a'.repeat(32),
      splitterFallbackMessage: null,
      debugMapSummary: null,
    })
    const port = makePort()
    const { events, emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    expect(events.some((e) => e.level === 'warning' && /unknown warning/.test(e.message))).toBe(true)
  })
})

describe('runCompilePipeline — boardEntry shape variants', () => {
  it('handles a boardEntry with no platform field (deriveArduinoCoreFromPlatform → empty)', async () => {
    // When platform isn't set on the entry, the pipeline shouldn't
    // crash — installArduinoCore is still called (with coreId='') and
    // the no-op return resolves cleanly.
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        boardEntry: { platform: '', core: '' },
      }),
      port,
      emit,
    )
    expect(result.success).toBe(true)
    expect(port.installArduinoCore).toHaveBeenCalledWith(expect.objectContaining({ coreId: '' }), expect.any(Function))
  })

  it('derives the core id from `platform` (e.g. arduino:avr:mega → arduino:avr)', async () => {
    const port = makePort()
    const { emit } = captureEvents()
    await runCompilePipeline(
      makeArgs({
        boardEntry: { platform: 'arduino:avr:mega', core: 'arduino:avr' },
      }),
      port,
      emit,
    )
    expect(port.installArduinoCore).toHaveBeenCalledWith(
      expect.objectContaining({ coreId: 'arduino:avr' }),
      expect.any(Function),
    )
  })
})

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('runCompilePipeline — failure propagation', () => {
  it('returns success=false when transpileToSt reports failure', async () => {
    const port = makePort({
      transpileToSt: jest.fn().mockResolvedValue({
        ok: false,
        errors: [{ message: 'bad xml', line: 1, column: 1, severity: 'error' }],
      }),
    })
    const { emit } = captureEvents()
    const result = await runCompilePipeline(makeArgs(), port, emit)
    expect(result.success).toBe(false)
    expect(port.compileArduino).not.toHaveBeenCalled()
  })

  it('returns success=false when strucpp reports failure', async () => {
    mockedStrucpp.mockReturnValueOnce({
      success: false,
      files: [],
      errors: [
        {
          formatted: 'unknown symbol foo',
          raw: { message: 'unknown symbol foo', line: 1, column: 1, severity: 'error' } as never,
        },
      ],
      warnings: [],
      md5Hash: '',
      splitterFallbackMessage: null,
      debugMapSummary: null,
    })
    const port = makePort()
    const { emit } = captureEvents()
    const result = await runCompilePipeline(makeArgs(), port, emit)
    expect(result.success).toBe(false)
    expect(port.compileArduino).not.toHaveBeenCalled()
  })

  it('returns success=false when compileArduino reports failure', async () => {
    const port = makePort({
      compileArduino: jest.fn().mockResolvedValue({
        ok: false,
        errors: [{ message: 'linker error', line: 1, column: 1, severity: 'error' }],
      }),
    })
    const { emit } = captureEvents()
    const result = await runCompilePipeline(makeArgs(), port, emit)
    expect(result.success).toBe(false)
  })

  it('returns success=false when a simulator build produces no .hex binary', async () => {
    // Simulator targets require the .hex artefact in memory (the loader can't
    // find it on disk). A compile that reports ok but omits `binary` must fail
    // with a precise error rather than silently succeeding.
    const port = makePort({ compileArduino: jest.fn().mockResolvedValue({ ok: true }) })
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(makeArgs(), port, emit)
    expect(result.success).toBe(false)
    expect(events.some((e) => e.stage === 'arduino-compile' && /did not produce a \.hex/.test(e.message))).toBe(true)
  })

  it('returns success=false when uploadRuntimeV4 reports failure', async () => {
    const port = makePort({
      uploadRuntimeV4: jest.fn().mockResolvedValue({ ok: false, errors: [] }),
    })
    const { emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
  })

  it('returns success=false when installArduinoCore reports failure', async () => {
    const port = makePort({
      installArduinoCore: jest.fn().mockResolvedValue({ ok: false }),
    })
    const { emit } = captureEvents()
    const result = await runCompilePipeline(makeArgs(), port, emit)
    expect(result.success).toBe(false)
    expect(port.compileArduino).not.toHaveBeenCalled()
  })

  it('continues with a warning when installArduinoLib reports failure (does not bail)', async () => {
    // Library install is opportunistic — the user's target lib may
    // already be available from a non-managed source (sketchbook,
    // system install) and arduino-cli compile is the source of
    // truth for whether a required header can be resolved.  An
    // adapter returning `{ ok: false }` SHOULD emit a warning and
    // let the pipeline proceed; the build only fails later if the
    // missing header genuinely can't be found at compile time.
    const port = makePort({
      installArduinoLib: jest.fn().mockResolvedValue({ ok: false }),
    })
    const { emit, events } = captureEvents()
    const result = await runCompilePipeline(makeArgs(), port, emit)
    // Pipeline proceeded past lib-install — compileArduino fires.
    expect(port.compileArduino).toHaveBeenCalled()
    // A warning fired during the lib-install stage explaining the
    // soft pass-through.
    expect(events.some((e) => e.stage === 'lib-install' && e.level === 'warning')).toBe(true)
    // Success/failure is now determined downstream — explicitly not
    // asserted here because the test fixture's compileArduino mock
    // controls it.  Just confirm the bail-on-lib-install is gone.
    expect(typeof result.success).toBe('boolean')
  })

  it('returns success=false when generateRuntimeConfs throws (OPC-UA / EtherCAT failure)', async () => {
    // Pipeline wraps the v4 conf-generation step in a try/catch so a
    // failed EtherCAT or OPC-UA validator surfaces as a clean
    // `success: false` rather than crashing the IPC channel.  Mock
    // `generateRuntimeConfs` to throw so we exercise the catch path
    // deterministically — the underlying validators have their own
    // exhaustive throw-case suites (validate-ethercat-config.test.ts,
    // generate-confs.test.ts).
    mockedStrucpp.mockReturnValueOnce({
      success: true,
      files: [{ name: 'debug-map.json', content: '{}' }],
      errors: [],
      warnings: [],
      md5Hash: 'a'.repeat(32),
      splitterFallbackMessage: null,
      debugMapSummary: null,
    })
    mockedConfs.mockImplementationOnce(() => {
      throw new Error('EtherCAT validator: vendor id missing on slave #0')
    })
    const port = makePort()
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
    // The original throw message rides through the error event so
    // the user can see which validator complained.
    expect(events.some((e) => /EtherCAT validator/.test(e.message))).toBe(true)
    // And we never reached the upload step.
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

describe('runCompilePipeline — side effects', () => {
  it('calls cacheDebugData with the strucpp MD5 + debug-map.json content', async () => {
    const cacheDebugData = jest.fn()
    const port = makePort()
    const { emit } = captureEvents()
    await runCompilePipeline(makeArgs({ cacheDebugData }), port, emit)
    expect(cacheDebugData).toHaveBeenCalledWith('a'.repeat(32), '{}')
  })

  it('emits a done event with level=info on successful completion', async () => {
    const port = makePort()
    const { events, emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    const done = events.find((e) => e.stage === 'done')
    expect(done).toBeDefined()
    expect(done?.level).toBe('info')
  })

  it('emits per-error events with structured compileError payloads on transpile failure', async () => {
    const port = makePort({
      transpileToSt: jest.fn().mockResolvedValue({
        ok: false,
        errors: [
          { message: 'bad syntax', line: 5, column: 3, severity: 'error' },
          { message: 'undefined symbol', line: 7, column: 2, severity: 'error' },
        ],
      }),
    })
    const { events, emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    const errorEvents = events.filter((e) => e.compileError !== undefined)
    expect(errorEvents).toHaveLength(2)
  })

  it("forwards generateRuntimeConfs's log callback to emit at the 'confs' stage", async () => {
    // Covers the `log: (message, level) => emit({...})` lambda at
    // pipeline.ts:417.  Atomic conf generators surface validation
    // diagnostics through this callback (warnings about dropped
    // OPC-UA refs, info about EtherCAT vendor lookups, etc.); we
    // need to verify the pipeline wires the callback into the emit
    // channel so those diagnostics reach the console panel.
    mockedConfs.mockImplementationOnce((input) => {
      input.log('dropped variable foo because bar', 'error')
      input.log('opcua found 5 nodes', 'info')
      return { modbusSlave: '', modbusMaster: '', s7Comm: '', opcUa: null, ethercat: '' }
    })
    const port = makePort()
    const { events, emit } = captureEvents()
    await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    const confsEvents = events.filter((e) => e.stage === 'confs')
    expect(confsEvents.some((e) => e.message === 'dropped variable foo because bar' && e.level === 'error')).toBe(true)
    expect(confsEvents.some((e) => e.message === 'opcua found 5 nodes' && e.level === 'info')).toBe(true)
  })

  it('outer try/catch wraps unhandled exceptions in an error event (Error instance)', async () => {
    // Covers the runCompilePipeline (outer) catch at pipeline.ts:258-267
    // — the bail path for any throw the inner orchestrator didn't
    // already convert to a structured failure.  Force a port method to
    // throw and assert we get the canonical "Unhandled pipeline error"
    // event + a clean `success: false` rather than an unhandled
    // rejection that hangs the IPC channel.
    const port = makePort({
      computeMd5: jest.fn().mockImplementation(() => {
        throw new Error('crypto subsystem unavailable')
      }),
    })
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
    expect(events.some((e) => /Unhandled pipeline error: crypto subsystem unavailable/.test(e.message))).toBe(true)
    expect(events.some((e) => e.message === 'Stopping compilation process.')).toBe(true)
  })

  it('outer try/catch wraps unhandled non-Error throws by stringifying them', async () => {
    // Same catch as above, but the thrown value is NOT an Error
    // instance — exercises the `String(error)` branch in the catch.
    const port = makePort({
      computeMd5: jest.fn().mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain string throw'
      }),
    })
    const { events, emit } = captureEvents()
    const result = await runCompilePipeline(
      makeArgs({
        isSimulator: false,
        isRuntimeV4: true,
        boardRuntime: 'openplc-compiler',
        deviceContext: deviceContextFixture,
      }),
      port,
      emit,
    )
    expect(result.success).toBe(false)
    expect(events.some((e) => /Unhandled pipeline error: plain string throw/.test(e.message))).toBe(true)
  })

  it('port methods can stream log lines through the PlatformLog callback they receive', async () => {
    // Covers the `(message, level) => emit({stage, message, level})`
    // lambda makePlatformLog returns (pipeline.ts:209).  Port methods
    // receive that callback as their second arg and call it whenever
    // they want a log line on the console panel.  Tests that mock
    // ports with `vi.fn()` never invoke the callback, leaving the
    // lambda body uncovered — this test pins the wiring explicitly.
    const port = makePort({
      transpileToSt: jest.fn().mockImplementation(async (_args, log) => {
        log('xml2st spawned subprocess', 'info')
        log('xml2st: parsed 5 POUs', 'info')
        return { ok: true, programSt: 'PROGRAM main\nEND_PROGRAM' }
      }),
    })
    const { events, emit } = captureEvents()
    await runCompilePipeline(makeArgs(), port, emit)
    const stEvents = events.filter((e) => e.stage === 'st')
    expect(stEvents.some((e) => e.message === 'xml2st spawned subprocess' && e.level === 'info')).toBe(true)
    expect(stEvents.some((e) => e.message === 'xml2st: parsed 5 POUs' && e.level === 'info')).toBe(true)
  })
})
