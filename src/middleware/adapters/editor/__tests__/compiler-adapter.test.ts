import type { CompilerPort } from '../../../shared/ports/compiler-port'
import type { CompileProgressEvent, PLCProjectData } from '../../../shared/ports/types'
import {
  createEditorCompilerAdapter,
  decodeMessage,
  inferStage,
  portPouToIpcPou,
  toIpcProjectData,
} from '../compiler-adapter'

const mockProjectData: PLCProjectData = {
  dataTypes: [],
  pous: [
    {
      name: 'main',
      pouType: 'program',
      interface: {
        variables: [
          {
            name: 'x',
            class: 'local',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
        ],
      },
      body: { language: 'st', value: 'x := TRUE;' },
      documentation: 'Main program',
    },
    {
      name: 'add_ints',
      pouType: 'function',
      interface: {
        returnType: 'INT',
        variables: [],
      },
      body: { language: 'st', value: 'add_ints := a + b;' },
    },
  ],
  configurations: {
    resource: {
      tasks: [{ name: 'MainTask', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
      instances: [{ name: 'main0', task: 'MainTask', program: 'main' }],
      globalVariables: [],
    },
  },
}

const boardsMap = new Map([
  [
    'Arduino Mega',
    {
      compiler: 'arduino-cli' as const,
      core: 'arduino:avr:mega',
      preview: 'mega.png',
      specs: {},
    },
  ],
])

let compileCallback: ((data: Record<string, unknown>) => void) | null = null
let debugCallback: ((data: Record<string, unknown>) => void) | null = null
let libraryCallback: ((data: Record<string, unknown>) => void) | null = null

/** Flush microtask queue so async bridge calls complete and callbacks are registered. */
const flushMicrotasks = () => new Promise<void>((resolve) => process.nextTick(resolve))

beforeEach(() => {
  compileCallback = null
  debugCallback = null
  libraryCallback = null

  window.bridge = {
    getAvailableBoards: jest.fn().mockResolvedValue(boardsMap),
    runCompileProgram: jest.fn().mockImplementation((_args: unknown[], cb: (data: Record<string, unknown>) => void) => {
      compileCallback = cb
    }),
    runDebugCompilation: jest
      .fn()
      .mockImplementation((_args: unknown[], cb: (data: Record<string, unknown>) => void) => {
        debugCallback = cb
      }),
    runCompileLibrary: jest.fn().mockImplementation((_args: unknown[], cb: (data: Record<string, unknown>) => void) => {
      libraryCallback = cb
    }),
    loadAllLibraries: jest.fn().mockResolvedValue([]),
    exportProjectXml: jest.fn().mockResolvedValue({ success: true, message: 'Exported successfully' }),
  } as unknown as typeof window.bridge
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('portPouToIpcPou', () => {
  it('converts a program POU to IPC format', () => {
    const pou = mockProjectData.pous[0]
    const result = portPouToIpcPou(pou)

    expect(result.type).toBe('program')
    expect(result.data.name).toBe('main')
    expect(result.data.variables).toHaveLength(1)
    expect(result.data.body).toEqual({ language: 'st', value: 'x := TRUE;' })
    expect(result.data.documentation).toBe('Main program')
  })

  it('converts a function POU with return type', () => {
    const pou = mockProjectData.pous[1]
    const result = portPouToIpcPou(pou)

    expect(result.type).toBe('function')
    expect(result.data.name).toBe('add_ints')
    expect(result.data.returnType).toBe('INT')
    expect(result.data.variables).toEqual([])
  })

  it('handles POU without interface', () => {
    const result = portPouToIpcPou({
      name: 'bare',
      pouType: 'program',
      body: { language: 'st', value: '' },
    })

    expect(result.data.variables).toEqual([])
    expect(result.data.returnType).toBeUndefined()
    expect(result.data.documentation).toBe('')
  })
})

describe('toIpcProjectData', () => {
  it('converts PLCProjectData to IPC format', () => {
    const result = toIpcProjectData(mockProjectData)

    expect(result.dataTypes).toBe(mockProjectData.dataTypes)
    expect(result.pous).toHaveLength(2)
    expect(result.pous[0].type).toBe('program')
    expect(result.pous[0].data.name).toBe('main')
    expect(result.configuration).toBe(mockProjectData.configurations)
  })

  it('includes originalCppPous when present', () => {
    const dataWithCpp = {
      ...mockProjectData,
      originalCppPous: [{ name: 'cpp_pou', code: 'void setup(){}', variables: [] }],
    }
    const result = toIpcProjectData(dataWithCpp)

    expect(result.originalCppPous).toEqual([{ name: 'cpp_pou', code: 'void setup(){}', variables: [] }])
  })
})

describe('inferStage', () => {
  it('detects XML stage', () => {
    expect(inferStage('Generating XML from project')).toBe('xml')
    expect(inferStage('Creating xml file')).toBe('xml')
  })

  it('detects ST stage', () => {
    expect(inferStage('Transpiling to structured text')).toBe('st')
    expect(inferStage('Processing .st file')).toBe('st')
    expect(inferStage('Transpiling program')).toBe('st')
  })

  it('detects C/C++ stage', () => {
    expect(inferStage('Compiling Structured Text to C++ with STruC++')).toBe('c')
    expect(inferStage('Generating C code')).toBe('c')
    expect(inferStage('C++ files generated at: /tmp/build')).toBe('c')
  })

  it('detects arduino stage', () => {
    expect(inferStage('Running Arduino CLI')).toBe('arduino')
    expect(inferStage('Compiling firmware')).toBe('arduino')
    expect(inferStage('Uploading to board')).toBe('arduino')
  })

  it('defaults to st for unknown messages', () => {
    expect(inferStage('Something unrelated')).toBe('st')
  })
})

describe('createEditorCompilerAdapter', () => {
  let adapter: CompilerPort

  beforeEach(() => {
    adapter = createEditorCompilerAdapter()
  })

  describe('compileProgram', () => {
    it('calls runCompileProgram with correct IPC args', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path/to/project',
          compileOnly: true,
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()

      compileCallback!({ message: 'Generating XML from project', logLevel: 'info' })
      compileCallback!({ message: 'Compiling firmware', logLevel: 'info' })
      compileCallback!({ closePort: true })

      const result = await promise

      expect(window.bridge.getAvailableBoards).toHaveBeenCalled()
      expect(window.bridge.runCompileProgram).toHaveBeenCalledWith(
        // Args layout (verbatim, in order):
        //   projectPath, boardTarget, boardCore, compileOnly,
        //   projectData, runtimeIpAddress, runtimeJwtToken,
        //   cleanBuild, communicationPort, vendorScreenData.
        // `vendorScreenData` is the 10th slot — threaded through to
        // the shared compile pipeline for `vpp_config.h` emission on
        // arduino-cli VPP boards (Arduino Opta, P1AM).  `null` when
        // the caller didn't supply one (non-VPP build).
        [
          '/path/to/project',
          'Arduino Mega',
          'arduino:avr:mega',
          true,
          expect.any(Object),
          null,
          null,
          false,
          null,
          null,
        ],
        expect.any(Function),
      )
      expect(result).toEqual({ success: true, message: 'Compilation complete', hexPath: undefined })
      expect(progressEvents).toHaveLength(3)
      expect(progressEvents[0].stage).toBe('xml')
      expect(progressEvents[2].stage).toBe('done')
    })

    it('uses null for board core when board not found', async () => {
      ;(window.bridge.getAvailableBoards as jest.Mock).mockResolvedValue(new Map())

      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Unknown Board',
          projectPath: '/path',
        },
        () => {},
      )

      await flushMicrotasks()
      compileCallback!({ closePort: true })
      await promise

      expect(window.bridge.runCompileProgram).toHaveBeenCalledWith(
        expect.arrayContaining(['/path', 'Unknown Board', null, false]),
        expect.any(Function),
      )
    })

    it('returns error result when error messages received', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()
      compileCallback!({ message: 'Compilation failed: missing file', logLevel: 'error' })
      compileCallback!({ closePort: true })

      const result = await promise

      expect(result).toEqual({ success: false, error: 'Compilation failed: missing file' })
      expect(progressEvents.some((e) => e.stage === 'error')).toBe(true)
      expect(progressEvents.some((e) => e.stage === 'done' && e.message === 'Compilation complete')).toBe(false)
    })

    it('ignores duplicate closePort events after an error', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()
      compileCallback!({ message: 'Board not found', logLevel: 'error' })
      compileCallback!({ closePort: true })
      compileCallback!({ closePort: true })

      const result = await promise

      expect(result).toEqual({ success: false, error: 'Board not found' })
      expect(progressEvents).toEqual([{ stage: 'error', message: 'Board not found', level: 'error' }])
    })

    it('captures simulatorFirmwarePath as hexPath', async () => {
      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        () => {},
      )

      await flushMicrotasks()
      compileCallback!({ simulatorFirmwarePath: '/tmp/firmware.hex' })
      compileCallback!({ closePort: true })

      const result = await promise
      expect(result).toEqual({
        success: true,
        message: 'Compilation complete',
        hexPath: '/tmp/firmware.hex',
      })
    })

    it('handles non-string message data', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()
      compileCallback!({ message: 42 })
      compileCallback!({ closePort: true })

      await promise
      expect(progressEvents[0].message).toBe('42')
    })

    it('defaults compileOnly to false when not provided', async () => {
      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        () => {},
      )

      await flushMicrotasks()
      compileCallback!({ closePort: true })
      await promise

      const args = (window.bridge.runCompileProgram as jest.Mock).mock.calls[0][0]
      expect(args[3]).toBe(false)
    })

    it('forwards plcStatus progress events even without a message', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileProgram(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()
      compileCallback!({ plcStatus: 'RUNNING' })
      compileCallback!({ closePort: true })

      await promise
      expect(progressEvents).toHaveLength(2) // plcStatus + done
      expect(progressEvents[0]).toEqual({ stage: 'arduino', message: '', plcStatus: 'RUNNING' })
      expect(progressEvents[1].stage).toBe('done')
    })
  })

  describe('compileForDebug', () => {
    it('calls runDebugCompilation with correct args', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileForDebug(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path/to/project',
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()
      debugCallback!({ message: 'Generating XML', logLevel: 'info' })
      debugCallback!({ closePort: true })

      const result = await promise

      expect(window.bridge.runDebugCompilation).toHaveBeenCalledWith(
        ['/path/to/project', 'Arduino Mega', expect.any(Object)],
        expect.any(Function),
      )
      expect(result).toEqual({ success: true })
      expect(progressEvents).toHaveLength(2)
      expect(progressEvents[1].stage).toBe('done')
    })

    it('returns error when compilation fails', async () => {
      const promise = adapter.compileForDebug(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        () => {},
      )

      await flushMicrotasks()
      debugCallback!({ message: 'iec2c: syntax error', logLevel: 'error' })
      debugCallback!({ closePort: true })

      const result = await promise
      expect(result).toEqual({ success: false, error: 'iec2c: syntax error' })
    })

    it('handles multiple error messages and uses the last one', async () => {
      const promise = adapter.compileForDebug(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        () => {},
      )

      await flushMicrotasks()
      debugCallback!({ message: 'First error', logLevel: 'error' })
      debugCallback!({ message: 'Final error', logLevel: 'error' })
      debugCallback!({ closePort: true })

      const result = await promise
      expect(result).toEqual({ success: false, error: 'Final error' })
    })

    it('defaults logLevel to info when not provided', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileForDebug(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()
      debugCallback!({ message: 'some info' })
      debugCallback!({ closePort: true })

      await promise
      // When logLevel is not provided, ?? 'info' kicks in
      expect(progressEvents[0].level).toBe('info')
    })

    it('ignores callback data with no message and no closePort', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileForDebug(
        {
          projectData: mockProjectData,
          boardTarget: 'Arduino Mega',
          projectPath: '/path',
        },
        (event) => progressEvents.push(event),
      )

      await flushMicrotasks()
      // Send data that has neither closePort nor message — both if-branches are false
      debugCallback!({ someOtherField: 'irrelevant' })
      debugCallback!({ closePort: true })

      const result = await promise
      expect(result).toEqual({ success: true })
      // Only the 'done' event should be recorded, not the irrelevant one
      expect(progressEvents).toHaveLength(1)
      expect(progressEvents[0].stage).toBe('done')
    })
  })

  describe('exportProjectXml', () => {
    it('calls bridge exportProjectXml and returns success', async () => {
      const result = await adapter.exportProjectXml({
        projectData: mockProjectData,
        projectPath: '/path/to/project',
        format: 'old-editor',
      })

      expect(window.bridge.exportProjectXml).toHaveBeenCalledWith(
        '/path/to/project',
        expect.objectContaining({
          dataTypes: [],
          configuration: mockProjectData.configurations,
        }),
        'old-editor',
      )
      expect(result).toEqual({ success: true, message: 'Exported successfully' })
    })

    it('returns error when export fails', async () => {
      ;(window.bridge.exportProjectXml as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Export failed: disk full',
      })

      const result = await adapter.exportProjectXml({
        projectData: mockProjectData,
        projectPath: '/path',
        format: 'codesys',
      })

      expect(result).toEqual({ success: false, error: 'Export failed: disk full' })
    })
  })

  describe('library-cpp-block injection', () => {
    it("grafts each enabled library archive's cppBlocks into the project before preprocessing", async () => {
      // Project enables a library called `motor_lib` that ships a
      // C++ FB called `Driver`.  The bridge returns the archive with
      // its cppBlocks; the adapter must inject a synthesized
      // `motor_lib__Driver` POU into the project's POU list before
      // it builds the IPC payload, so the program build's
      // c_blocks.h/code.cpp generation picks up the C++ source.
      const projectWithLib: PLCProjectData = {
        ...mockProjectData,
        libraries: [{ name: 'motor_lib', version: '1.0.0' }],
      }
      ;(window.bridge.loadAllLibraries as jest.Mock).mockResolvedValue([
        {
          manifest: { name: 'motor_lib' },
          cppBlocks: [
            {
              name: 'Driver',
              code: 'void setup() {}\nvoid loop() {}',
              variables: [
                {
                  name: 'pwm',
                  class: 'input',
                  type: { definition: 'base-type', value: 'INT' },
                  location: '',
                  documentation: '',
                },
              ],
            },
          ],
        },
      ])

      const promise = adapter.compileProgram(
        { projectData: projectWithLib, boardTarget: 'Arduino Mega', projectPath: '/p' },
        () => {},
      )
      await flushMicrotasks()
      compileCallback!({ closePort: true })
      await promise

      // The IPC payload's POU list should contain the synthesized
      // `motor_lib__Driver` POU AFTER preprocessing has turned its
      // cpp body into an ST stub.  preprocessPous also stamps an
      // `originalCppPous` entry alongside.
      const ipcArgs = (window.bridge.runCompileProgram as jest.Mock).mock.calls[0][0] as unknown[]
      const ipcProjectData = ipcArgs[4] as {
        pous: Array<{ data: { name: string } }>
        originalCppPous?: Array<{ name: string }>
      }
      const pouNames = ipcProjectData.pous.map((p) => p.data.name)
      expect(pouNames).toContain('motor_lib__Driver')
      expect(ipcProjectData.originalCppPous?.map((p) => p.name)).toContain('motor_lib__Driver')
    })

    it("skips library cppBlocks that are not on the project's enabled list", async () => {
      const projectWithLib: PLCProjectData = {
        ...mockProjectData,
        libraries: [{ name: 'enabled_lib', version: '1.0.0' }],
      }
      ;(window.bridge.loadAllLibraries as jest.Mock).mockResolvedValue([
        {
          manifest: { name: 'enabled_lib' },
          cppBlocks: [{ name: 'OK', code: 'void setup(){}void loop(){}', variables: [] }],
        },
        {
          // Not enabled — must not leak into the project.
          manifest: { name: 'other_lib' },
          cppBlocks: [{ name: 'Leak', code: 'void setup(){}void loop(){}', variables: [] }],
        },
      ])

      const promise = adapter.compileProgram(
        { projectData: projectWithLib, boardTarget: 'Arduino Mega', projectPath: '/p' },
        () => {},
      )
      await flushMicrotasks()
      compileCallback!({ closePort: true })
      await promise

      const ipcArgs = (window.bridge.runCompileProgram as jest.Mock).mock.calls[0][0] as unknown[]
      const ipcProjectData = ipcArgs[4] as { pous: Array<{ data: { name: string } }> }
      const pouNames = ipcProjectData.pous.map((p) => p.data.name)
      expect(pouNames).toContain('enabled_lib__OK')
      expect(pouNames).not.toContain('other_lib__Leak')
    })
  })

  describe('compileLibrary', () => {
    it('posts project path + IPC data to runCompileLibrary and resolves the structured result', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileLibrary!({ projectData: mockProjectData, projectPath: '/lib/project' }, (event) =>
        progressEvents.push(event),
      )

      await flushMicrotasks()

      libraryCallback!({ message: 'Starting library build...', logLevel: 'info' })
      libraryCallback!({
        libraryBuildResult: {
          success: true,
          stlibPath: '/lib/project/build/demo_lib.stlib',
          libraryName: 'demo_lib',
        },
      })
      libraryCallback!({ closePort: true })

      const result = await promise

      // Args: [projectPath, ipcDataForBuild, ipcDataForVerify, cleanBuild]
      expect(window.bridge.runCompileLibrary).toHaveBeenCalledWith(
        [
          '/lib/project',
          expect.objectContaining({ pous: expect.any(Array) }),
          expect.objectContaining({ pous: expect.any(Array) }),
          false,
        ],
        expect.any(Function),
      )
      expect(result).toEqual({
        success: true,
        stlibPath: '/lib/project/build/demo_lib.stlib',
        libraryName: 'demo_lib',
      })

      // The adapter does NOT emit a synthetic done event on close.
      // The backend already posts "Library built successfully: <path>"
      // through the message stream, and re-emitting on close would
      // double-print the success line.  Only the forwarded log
      // message should appear.
      expect(progressEvents).toHaveLength(1)
      expect(progressEvents[0].message).toBe('Starting library build...')
    })

    it('forwards error log entries and resolves the failure result', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileLibrary!({ projectData: mockProjectData, projectPath: '/lib/project' }, (event) =>
        progressEvents.push(event),
      )

      await flushMicrotasks()

      libraryCallback!({ message: 'manifest.namespace is invalid', logLevel: 'error' })
      libraryCallback!({
        libraryBuildResult: {
          success: false,
          error: 'manifest.namespace is invalid',
        },
      })
      libraryCallback!({ closePort: true })

      const result = await promise

      expect(result.success).toBe(false)
      expect(result.error).toBe('manifest.namespace is invalid')
      expect(progressEvents.some((e) => e.stage === 'error')).toBe(true)
      expect(progressEvents[progressEvents.length - 1].stage).toBe('error')
    })

    it('resolves with a fallback error when the port closes without a structured result', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileLibrary!({ projectData: mockProjectData, projectPath: '/lib/project' }, (event) =>
        progressEvents.push(event),
      )

      await flushMicrotasks()
      // No libraryBuildResult — port closes unexpectedly.
      libraryCallback!({ closePort: true })

      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/closed unexpectedly/i)
    })

    it('captures the last error message when no structured result arrives', async () => {
      const promise = adapter.compileLibrary!({ projectData: mockProjectData, projectPath: '/lib/project' }, () => {})

      await flushMicrotasks()
      libraryCallback!({ message: 'something went wrong', logLevel: 'error' })
      libraryCallback!({ closePort: true })

      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('something went wrong')
    })

    it('routes non-error log messages through inferStage', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileLibrary!({ projectData: mockProjectData, projectPath: '/lib/project' }, (event) =>
        progressEvents.push(event),
      )

      await flushMicrotasks()
      libraryCallback!({ message: 'Generating XML from JSON', logLevel: 'info' })
      libraryCallback!({ libraryBuildResult: { success: true, stlibPath: '/x.stlib' } })
      libraryCallback!({ closePort: true })

      await promise
      expect(progressEvents[0].stage).toBe('xml')
      expect(progressEvents[0].level).toBe('info')
    })

    it('propagates the cleanBuild flag through to the bridge', async () => {
      const promise = adapter.compileLibrary!(
        { projectData: mockProjectData, projectPath: '/lib/project', cleanBuild: true },
        () => {},
      )

      await flushMicrotasks()
      libraryCallback!({ libraryBuildResult: { success: true, stlibPath: '/x.stlib' } })
      libraryCallback!({ closePort: true })
      await promise

      expect(window.bridge.runCompileLibrary).toHaveBeenCalledWith(
        ['/lib/project', expect.any(Object), expect.any(Object), true],
        expect.any(Function),
      )
    })

    it('defaults non-error log levels to info when logLevel is missing', async () => {
      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileLibrary!({ projectData: mockProjectData, projectPath: '/lib/project' }, (event) =>
        progressEvents.push(event),
      )

      await flushMicrotasks()
      libraryCallback!({ message: 'progress with no logLevel' })
      libraryCallback!({ libraryBuildResult: { success: true, stlibPath: '/x.stlib' } })
      libraryCallback!({ closePort: true })

      await promise
      const firstLogEvent = progressEvents.find((e) => e.stage !== 'done')
      expect(firstLogEvent?.level).toBe('info')
    })

    it('forwards build-pass preprocessor logs through onProgress', async () => {
      // A C++ POU triggers a `Found C++ POU…` log line from
      // `preprocessPous`'s build pass — the only path that drives the
      // onProgress callback inside compileLibrary's preprocess step.
      const cppLibraryData: PLCProjectData = {
        dataTypes: [],
        pous: [
          {
            name: 'good_cpp',
            pouType: 'function-block',
            interface: { variables: [] },
            body: { language: 'cpp', value: 'void setup(){}\nvoid loop(){}' },
          },
        ],
        configurations: {
          resource: { tasks: [], instances: [], globalVariables: [] },
        },
      }

      const progressEvents: CompileProgressEvent[] = []
      const promise = adapter.compileLibrary!({ projectData: cppLibraryData, projectPath: '/lib/project' }, (event) =>
        progressEvents.push(event),
      )

      await flushMicrotasks()
      libraryCallback!({ libraryBuildResult: { success: true, stlibPath: '/x.stlib' } })
      libraryCallback!({ closePort: true })

      await promise

      expect(progressEvents.some((e) => e.stage === 'st')).toBe(true)
    })

    it('aborts with a validation error when the build-pass preprocessor rejects a POU', async () => {
      const badCppLibraryData: PLCProjectData = {
        dataTypes: [],
        pous: [
          {
            name: 'bad_cpp',
            pouType: 'function-block',
            interface: { variables: [] },
            body: { language: 'cpp', value: '// no setup or loop' },
          },
        ],
        configurations: {
          resource: { tasks: [], instances: [], globalVariables: [] },
        },
      }

      const result = await adapter.compileLibrary!(
        { projectData: badCppLibraryData, projectPath: '/lib/project' },
        () => {},
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('POU validation failed')
      // Must short-circuit BEFORE invoking the IPC bridge.
      expect(window.bridge.runCompileLibrary).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// decodeMessage — Uint8Array and Buffer object branches (lines 79, 82-85)
// ---------------------------------------------------------------------------

describe('decodeMessage', () => {
  // jsdom does not provide TextDecoder by default; polyfill it so decodeMessage can work.
  const origTextDecoder = globalThis.TextDecoder

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TextDecoder: TD } = require('util')
    globalThis.TextDecoder = TD
  })

  afterAll(() => {
    globalThis.TextDecoder = origTextDecoder
  })

  it('decodes a Uint8Array to string', () => {
    // Create a Uint8Array using jsdom's global constructor so instanceof check passes.
    // "Hi" = [72, 105]
    const bytes = new Uint8Array([72, 105])
    expect(decodeMessage(bytes)).toBe('Hi')
  })

  it('decodes an ArrayBuffer to string', () => {
    // Create an ArrayBuffer using jsdom's global constructor.
    const bytes = new Uint8Array([72, 105])
    expect(decodeMessage(bytes.buffer)).toBe('Hi')
  })

  it('decodes an Electron serialized Buffer object { type: "Buffer", data: number[] }', () => {
    const fakeBuffer = { type: 'Buffer', data: [72, 101, 108, 108, 111] } // "Hello"
    expect(decodeMessage(fakeBuffer)).toBe('Hello')
  })

  it('falls through to String() for object with type but not Buffer', () => {
    const obj = { type: 'SomethingElse', data: [1, 2, 3] }
    expect(decodeMessage(obj)).toBe(String(obj))
  })

  it('falls through to String() for object with type=Buffer but non-array data', () => {
    const obj = { type: 'Buffer', data: 'not-an-array' }
    expect(decodeMessage(obj)).toBe(String(obj))
  })
})

// ---------------------------------------------------------------------------
// compileProgram — preprocessPous validation failure (lines 118, 123)
// ---------------------------------------------------------------------------

describe('compileProgram with invalid C++ POU', () => {
  it('returns validation error when C++ code has no setup/loop', async () => {
    const cppProjectData: PLCProjectData = {
      dataTypes: [],
      pous: [
        {
          name: 'bad_cpp',
          pouType: 'program',
          interface: { variables: [] },
          body: { language: 'cpp', value: '// no setup or loop function' },
        },
      ],
      configurations: {
        resource: { tasks: [], instances: [], globalVariables: [] },
      },
    }

    const adapter = createEditorCompilerAdapter()
    const progressEvents: CompileProgressEvent[] = []

    const result = await adapter.compileProgram(
      {
        projectData: cppProjectData,
        boardTarget: 'Arduino Mega',
        projectPath: '/path',
      },
      (event) => progressEvents.push(event),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('POU validation failed')
  })

  it('forwards preprocessor log messages to onProgress', async () => {
    const cppProjectData: PLCProjectData = {
      dataTypes: [],
      pous: [
        {
          name: 'bad_cpp',
          pouType: 'program',
          interface: { variables: [] },
          body: { language: 'cpp', value: '// missing setup and loop' },
        },
      ],
      configurations: {
        resource: { tasks: [], instances: [], globalVariables: [] },
      },
    }

    const adapter = createEditorCompilerAdapter()
    const progressEvents: CompileProgressEvent[] = []

    await adapter.compileProgram(
      {
        projectData: cppProjectData,
        boardTarget: 'Arduino Mega',
        projectPath: '/path',
      },
      (event) => progressEvents.push(event),
    )

    // preprocessPous logs info/error messages that go through the onProgress callback
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.some((e) => e.stage === 'st')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// compileForDebug — preprocessPous validation failure (lines 198, 203)
// ---------------------------------------------------------------------------

describe('compileForDebug with invalid C++ POU', () => {
  let debugCallback: ((data: Record<string, unknown>) => void) | null

  beforeEach(() => {
    debugCallback = null
    window.bridge.runDebugCompilation = jest
      .fn()
      .mockImplementation((_args: unknown[], cb: (data: Record<string, unknown>) => void) => {
        debugCallback = cb
      })
  })

  it('returns validation error when C++ code is invalid', async () => {
    const cppProjectData: PLCProjectData = {
      dataTypes: [],
      pous: [
        {
          name: 'bad_debug_cpp',
          pouType: 'program',
          interface: { variables: [] },
          body: { language: 'cpp', value: '// no setup or loop' },
        },
      ],
      configurations: {
        resource: { tasks: [], instances: [], globalVariables: [] },
      },
    }

    const adapter = createEditorCompilerAdapter()
    const progressEvents: CompileProgressEvent[] = []

    const result = await adapter.compileForDebug(
      {
        projectData: cppProjectData,
        boardTarget: 'Arduino Mega',
        projectPath: '/path',
      },
      (event) => progressEvents.push(event),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('POU validation failed.')
    // The bridge should NOT have been called because validation failed early
    expect(window.bridge.runDebugCompilation).not.toHaveBeenCalled()
    void debugCallback // suppress unused warning
  })

  it('forwards preprocessor log messages to onProgress for debug', async () => {
    const cppProjectData: PLCProjectData = {
      dataTypes: [],
      pous: [
        {
          name: 'cpp_debug',
          pouType: 'program',
          interface: { variables: [] },
          body: { language: 'cpp', value: '// missing setup/loop' },
        },
      ],
      configurations: {
        resource: { tasks: [], instances: [], globalVariables: [] },
      },
    }

    const adapter = createEditorCompilerAdapter()
    const progressEvents: CompileProgressEvent[] = []

    await adapter.compileForDebug(
      {
        projectData: cppProjectData,
        boardTarget: 'Arduino Mega',
        projectPath: '/path',
      },
      (event) => progressEvents.push(event),
    )

    expect(progressEvents.length).toBeGreaterThan(0)
  })
})
