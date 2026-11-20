/**
 * Every PLC target compiles the program with STruC++ providing no HMI core, so a program using a widget fails on each
 * of them with STruC++'s diagnostic, before any target toolchain or upload runs. Real STruC++, real libraries.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import type {
  CompilerPlatformPort,
  PlatformDeviceContext,
} from '../../../../middleware/shared/ports/compiler-platform-port'
import { installedWidgetArchives } from '../../hmi/unit/__tests__/fixtures/widget-libraries'
import { loadStrucpp } from '../../library/strucpp-runtime'
import type { DevicePin } from '../../types/PLC/devices'
import type { PLCProjectData } from '../../types/PLC/open-plc'
import { type PipelineProgressEvent, runCompilePipeline, type RunCompilePipelineArgs } from '../pipeline'

const programSt = (vars: string): string =>
  `PROGRAM main\n  VAR\n${vars}  END_VAR\nEND_PROGRAM\n\n` +
  'CONFIGURATION Config0\n' +
  '  RESOURCE Res0 ON PLC\n' +
  '    TASK MainTask(INTERVAL := T#20ms,PRIORITY := 0);\n' +
  '    PROGRAM MainInstance WITH MainTask : main;\n' +
  '  END_RESOURCE\n' +
  'END_CONFIGURATION\n'

/** The bundled libraries a project always builds with: STruC++'s standard ones and the HMI widget libraries. */
function bundledLibraries(): unknown[] {
  const libsDir = join(process.cwd(), 'node_modules', 'strucpp', 'libs')
  const standard = ['iec-standard-fb.stlib', 'additional-function-blocks.stlib'].map((file) =>
    loadStrucpp().loadStlibFromString(readFileSync(join(libsDir, file), 'utf-8')),
  )
  return [...standard, ...installedWidgetArchives()]
}

function makePort(source: string): jest.Mocked<CompilerPlatformPort> {
  const refuse = jest.fn().mockRejectedValue(new Error('a target step ran after STruC++ refused the program'))
  return {
    computeMd5: jest.fn().mockResolvedValue('a'.repeat(32)),
    transpileToSt: jest.fn().mockResolvedValue({ ok: true, programSt: source }),
    compileArduino: refuse,
    compileToWasm: refuse,
    uploadRuntimeV4: refuse,
    uploadArduinoBoard: refuse,
    uploadRuntimeV3: refuse,
    checkRuntimeVersion: jest.fn().mockResolvedValue({ ok: true, version: '4.1.0' }),
    packageVppPlugin: refuse,
    materializeRuntimeV4Bundle: refuse,
    compileWasmModule: refuse,
    readHmiSources: jest.fn().mockResolvedValue({}),
  } as jest.Mocked<CompilerPlatformPort>
}

const projectData = {
  pous: [],
  dataTypes: [],
  configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
  servers: [],
  remoteDevices: [],
} as unknown as PLCProjectData

const deviceContext: PlatformDeviceContext = { kind: 'editor-https', ip: '192.168.1.10', jwt: 'jwt-token' }

const base: RunCompilePipelineArgs = {
  projectData,
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
  firmwareSkeleton: { 'examples/Baremetal/Baremetal.ino': '// sketch', 'src/arduino.cpp': '// hal' },
  strucppRuntimeHeaders: {},
  avrLibStdCppInclude: '/usr/avr/include',
  arduinoCliParallel: false,
  hmi: null,
}

const TARGETS: Array<[string, Partial<RunCompilePipelineArgs>]> = [
  ['the OpenPLC Simulator', {}],
  [
    'Runtime v4',
    {
      boardTarget: 'OpenPLC Runtime v4',
      boardRuntime: 'openplc-v4',
      isSimulator: false,
      isRuntimeV4: true,
      deviceContext,
    },
  ],
  [
    'Runtime v3',
    {
      boardTarget: 'OpenPLC Runtime v3',
      boardRuntime: 'openplc-v3',
      isSimulator: false,
      isRuntimeV3: true,
      deviceContext,
    },
  ],
  ['a baremetal board', { boardTarget: 'Arduino Mega', boardRuntime: 'arduino', isSimulator: false }],
  [
    'a baremetal board, compile only',
    { boardTarget: 'Arduino Mega', boardRuntime: 'arduino', isSimulator: false, compileOnly: true },
  ],
]

describe('PLC builds provide no HMI core', () => {
  it.each(TARGETS)('refuse a program that uses a widget on %s, with the STruC++ diagnostic', async (_, target) => {
    const port = makePort(programSt('    button : HmiButton;\n'))
    const events: PipelineProgressEvent[] = []
    const result = await runCompilePipeline({ ...base, ...target, libraryArchives: bundledLibraries() }, port, (e) =>
      events.push(e),
    )

    expect(result.success).toBe(false)
    const errors = events.filter((e) => e.level === 'error').map((e) => e.message)
    expect(errors).toContainEqual(
      expect.stringMatching(/HMIBUTTON \(library standard-widgets\) needs hmi_core\.h version \d+.*does not provide/),
    )
    expect(port.compileArduino).not.toHaveBeenCalled()
    expect(port.compileToWasm).not.toHaveBeenCalled()
    expect(port.uploadRuntimeV4).not.toHaveBeenCalled()
    expect(port.uploadRuntimeV3).not.toHaveBeenCalled()
    expect(port.uploadArduinoBoard).not.toHaveBeenCalled()
  })

  it('compiles past STruC++ when the program uses only plain POUs of the same libraries', async () => {
    const port = makePort(programSt('    timer : TON;\n'))
    const events: PipelineProgressEvent[] = []
    await runCompilePipeline({ ...base, libraryArchives: bundledLibraries() }, port, (e) => events.push(e))

    expect(events.some((e) => /STruC\+\+ compilation failed|hmi_core/.test(e.message))).toBe(false)
    expect(events.map((e) => e.stage)).toContain('firmware-bundle')
  })
})
