import {
  createEditorCompilerAdapter,
  portPouToIpcPou,
  toIpcProjectData,
  inferStage,
} from '../compiler-adapter'
import type { CompilerPort } from '../../../providers/platform/ports/compiler-port'
import type { CompileProgressEvent, PLCProjectData } from '../../../providers/platform/ports/types'

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
      instances: [{ name: 'main0', taskName: 'MainTask', pouName: 'main' }],
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

/** Flush microtask queue so async bridge calls complete and callbacks are registered. */
const flushMicrotasks = () => new Promise<void>((resolve) => process.nextTick(resolve))

beforeEach(() => {
  compileCallback = null
  debugCallback = null

  window.bridge = {
    getAvailableBoards: jest.fn().mockResolvedValue(boardsMap),
    runCompileProgram: jest.fn().mockImplementation((_args: unknown[], cb: (data: Record<string, unknown>) => void) => {
      compileCallback = cb
    }),
    runDebugCompilation: jest.fn().mockImplementation((_args: unknown[], cb: (data: Record<string, unknown>) => void) => {
      debugCallback = cb
    }),
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

  it('detects C stage', () => {
    expect(inferStage('Running iec2c compiler')).toBe('c')
    expect(inferStage('Generating C code')).toBe('c')
    expect(inferStage('Generating c code output')).toBe('c')
  })

  it('detects glue stage', () => {
    expect(inferStage('Generating glue variables')).toBe('glue')
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
        ['/path/to/project', 'Arduino Mega', 'arduino:avr:mega', true, expect.any(Object), null, null],
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

    it('ignores callback data without message or closePort', async () => {
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
      expect(progressEvents).toHaveLength(1) // only 'done'
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
})
