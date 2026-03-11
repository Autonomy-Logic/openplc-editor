import { createEditorProjectAdapter } from '../project-adapter'
import type { ProjectPort } from '../../../frontend/providers/platform/ports/project-port'

const mockIpcProjectResponse = {
  success: true,
  data: {
    meta: { path: '/home/user/projects/my-project' },
    content: {
      project: {
        meta: { name: 'my-project', type: 'plc-project' },
        data: {
          dataTypes: [],
          pous: [],
          configuration: {
            resource: { tasks: [], instances: [], globalVariables: [] },
          },
        },
      },
      pous: [
        {
          type: 'program',
          data: {
            name: 'main',
            variables: [{ name: 'x', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' }],
            body: { language: 'st', value: 'x := TRUE;' },
            documentation: 'Main program',
          },
        },
        {
          type: 'function',
          data: {
            name: 'add_ints',
            variables: [],
            returnType: 'INT',
            body: { language: 'st', value: 'add_ints := a + b;' },
            documentation: '',
          },
        },
      ],
      deviceConfiguration: {
        deviceBoard: 'Arduino Uno',
        communicationPort: '/dev/ttyUSB0',
        compileOnly: false,
        communicationConfiguration: {
          modbusRTU: { rtuInterface: '', rtuBaudRate: '115200', rtuSlaveId: null, rtuRS485ENPin: null },
          modbusTCP: {
            tcpInterface: 'eth0',
            tcpMacAddress: null,
            tcpStaticHostConfiguration: { ipAddress: '', dns: '', gateway: '', subnet: '' },
          },
          communicationPreferences: { enabledRTU: false, enabledTCP: false, enabledDHCP: true },
        },
      },
      devicePinMapping: [{ pin: '2', pinType: 'digitalInput', address: '%IX0.0' }],
    },
  },
}

const mockErrorResponse = {
  success: false,
  error: { title: 'Error', description: 'Something went wrong', error: new Error('fail') },
}

const mockSaveResponse = { success: true, reason: { title: '', description: '' } }
const mockSaveErrorResponse = { success: false, reason: { title: 'Save Error', description: 'Disk full' } }

const mockPouResponse = { success: true, data: { filePath: '/path/to/pou.st', pou: {} } }
const mockPouErrorResponse = {
  success: false,
  error: { title: 'POU Error', description: 'File already exists', error: null },
}

const mockRecentProjects = [
  { name: 'Project 1', path: '/path/to/project1', lastOpenedAt: '2026-03-10', createdAt: '2026-03-01' },
]

beforeEach(() => {
  window.bridge = {
    createProject: jest.fn().mockResolvedValue(mockIpcProjectResponse),
    openProject: jest.fn().mockResolvedValue(mockIpcProjectResponse),
    openProjectByPath: jest.fn().mockResolvedValue(mockIpcProjectResponse),
    saveProject: jest.fn().mockResolvedValue(mockSaveResponse),
    saveFile: jest.fn().mockResolvedValue({ success: true }),
    createPouFile: jest.fn().mockResolvedValue(mockPouResponse),
    deletePouFile: jest.fn().mockResolvedValue({ success: true }),
    renamePouFile: jest.fn().mockResolvedValue(mockPouResponse),
    pathPicker: jest.fn().mockResolvedValue({ success: true, path: '/picked/path' }),
    retrieveRecent: jest.fn().mockResolvedValue(mockRecentProjects),
    fileReadContent: jest.fn().mockResolvedValue({ success: true, content: 'file content' }),
    fileWatchStart: jest.fn().mockResolvedValue({ success: true }),
    fileWatchStop: jest.fn().mockResolvedValue({ success: true }),
    fileWatchStopAll: jest.fn().mockResolvedValue({ success: true }),
    onFileExternalChange: jest.fn().mockImplementation((cb: unknown) => {
      return () => {}
    }),
  } as unknown as typeof window.bridge
})

describe('createEditorProjectAdapter', () => {
  let adapter: ProjectPort

  beforeEach(() => {
    adapter = createEditorProjectAdapter()
  })

  describe('createProject', () => {
    it('delegates to window.bridge.createProject with mapped params', async () => {
      const result = await adapter.createProject({ name: 'test', type: 'plc-project', path: '/tmp' })

      expect(window.bridge.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test', type: 'plc-project', path: '/tmp', language: 'il' }),
      )
      expect(result.success).toBe(true)
    })

    it('maps successful response to ProjectResponse format', async () => {
      const result = await adapter.createProject({ name: 'test', type: 'plc-project', path: '/tmp' })

      expect(result.success).toBe(true)
      expect(result.data?.meta).toEqual({
        name: 'my-project',
        type: 'plc-project',
        path: '/home/user/projects/my-project',
      })
    })

    it('maps POUs from discriminated union to flat format', async () => {
      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.data?.projectData.pous).toHaveLength(2)
      expect(result.data?.projectData.pous[0]).toEqual({
        name: 'main',
        pouType: 'program',
        interface: {
          returnType: undefined,
          variables: [{ name: 'x', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' }],
        },
        body: { language: 'st', value: 'x := TRUE;' },
        documentation: 'Main program',
      })
    })

    it('maps function POU with return type', async () => {
      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.data?.projectData.pous[1]).toEqual({
        name: 'add_ints',
        pouType: 'function',
        interface: { returnType: 'INT', variables: [] },
        body: { language: 'st', value: 'add_ints := a + b;' },
        documentation: undefined,
      })
    })

    it('maps configuration to configurations field', async () => {
      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.data?.projectData.configurations).toEqual({
        resource: { tasks: [], instances: [], globalVariables: [] },
      })
    })

    it('includes device configuration and pin mapping', async () => {
      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.data?.deviceConfiguration?.deviceBoard).toBe('Arduino Uno')
      expect(result.data?.devicePinMapping).toHaveLength(1)
    })

    it('returns error when bridge reports failure', async () => {
      ;(window.bridge.createProject as jest.Mock).mockResolvedValue(mockErrorResponse)

      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.success).toBe(false)
      expect(result.error?.title).toBe('Error')
      expect(result.error?.description).toBe('Something went wrong')
    })

    it('uses empty string for path when not provided', async () => {
      await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(window.bridge.createProject).toHaveBeenCalledWith(expect.objectContaining({ path: '' }))
    })
  })

  describe('openProject', () => {
    it('delegates to window.bridge.openProject', async () => {
      const result = await adapter.openProject()

      expect(window.bridge.openProject).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
      expect(result.data?.meta.name).toBe('my-project')
    })

    it('returns error on failure', async () => {
      ;(window.bridge.openProject as jest.Mock).mockResolvedValue(mockErrorResponse)

      const result = await adapter.openProject()

      expect(result.success).toBe(false)
    })
  })

  describe('openProjectByPath', () => {
    it('delegates to window.bridge.openProjectByPath with the path', async () => {
      const result = await adapter.openProjectByPath('/path/to/project')

      expect(window.bridge.openProjectByPath).toHaveBeenCalledWith('/path/to/project')
      expect(result.success).toBe(true)
    })
  })

  describe('saveProject', () => {
    const saveParams = {
      projectPath: '/home/user/projects/my-project',
      projectData: {
        dataTypes: [],
        pous: [
          {
            name: 'main',
            pouType: 'program' as const,
            body: { language: 'st' as const, value: 'x := TRUE;' },
            documentation: 'test',
          },
        ],
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
      deviceConfiguration: {
        deviceBoard: 'Arduino Uno',
        communicationPort: '',
        compileOnly: false,
        communicationConfiguration: {
          modbusRTU: { rtuInterface: '', rtuBaudRate: '115200', rtuSlaveId: null, rtuRS485ENPin: null },
          modbusTCP: {
            tcpInterface: '',
            tcpMacAddress: null,
            tcpStaticHostConfiguration: { ipAddress: '', dns: '', gateway: '', subnet: '' },
          },
          communicationPreferences: { enabledRTU: false, enabledTCP: false, enabledDHCP: true },
        },
      },
      devicePinMapping: [],
    }

    it('delegates to window.bridge.saveProject with mapped data', async () => {
      const result = await adapter.saveProject(saveParams)

      expect(window.bridge.saveProject).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true })
    })

    it('converts flat POUs to discriminated union format', async () => {
      await adapter.saveProject(saveParams)

      const callArg = (window.bridge.saveProject as jest.Mock).mock.calls[0][0]
      expect(callArg.content.pous[0]).toEqual(
        expect.objectContaining({ type: 'program', data: expect.objectContaining({ name: 'main' }) }),
      )
    })

    it('maps configurations back to configuration (singular)', async () => {
      await adapter.saveProject(saveParams)

      const callArg = (window.bridge.saveProject as jest.Mock).mock.calls[0][0]
      expect(callArg.content.projectData.data.configuration).toEqual(saveParams.projectData.configurations)
    })

    it('returns error message on save failure', async () => {
      ;(window.bridge.saveProject as jest.Mock).mockResolvedValue(mockSaveErrorResponse)

      const result = await adapter.saveProject(saveParams)

      expect(result).toEqual({ success: false, error: 'Disk full' })
    })
  })

  describe('saveFile', () => {
    it('delegates to window.bridge.saveFile', async () => {
      const result = await adapter.saveFile('/path/to/file.st', 'content')

      expect(window.bridge.saveFile).toHaveBeenCalledWith('/path/to/file.st', 'content')
      expect(result).toEqual({ success: true })
    })
  })

  describe('createPou', () => {
    it('delegates to window.bridge.createPouFile with editor format', async () => {
      const result = await adapter.createPou({ name: 'test_prog', pouType: 'program', language: 'st' })

      expect(window.bridge.createPouFile).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true, data: mockPouResponse.data })
    })

    it('returns error on failure', async () => {
      ;(window.bridge.createPouFile as jest.Mock).mockResolvedValue(mockPouErrorResponse)

      const result = await adapter.createPou({ name: 'test', pouType: 'program', language: 'st' })

      expect(result).toEqual({ success: false, error: 'File already exists' })
    })
  })

  describe('deletePou', () => {
    it('delegates to window.bridge.deletePouFile', async () => {
      const result = await adapter.deletePou('/path/to/pou.st')

      expect(window.bridge.deletePouFile).toHaveBeenCalledWith('/path/to/pou.st')
      expect(result).toEqual({ success: true })
    })

    it('returns error on failure', async () => {
      ;(window.bridge.deletePouFile as jest.Mock).mockResolvedValue(mockPouErrorResponse)

      const result = await adapter.deletePou('/path/to/pou.st')

      expect(result).toEqual({ success: false, error: 'File already exists' })
    })
  })

  describe('renamePou', () => {
    it('delegates to window.bridge.renamePouFile', async () => {
      const result = await adapter.renamePou({ filePath: '/path/to/old.st', newFileName: 'new_name' })

      expect(window.bridge.renamePouFile).toHaveBeenCalledWith({ filePath: '/path/to/old.st', newFileName: 'new_name', fileContent: undefined })
      expect(result).toEqual({ success: true, data: mockPouResponse.data })
    })
  })

  describe('pickPath', () => {
    it('delegates to window.bridge.pathPicker', async () => {
      const result = await adapter.pickPath()

      expect(window.bridge.pathPicker).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true, path: '/picked/path' })
    })
  })

  describe('getRecentProjects', () => {
    it('delegates to window.bridge.retrieveRecent', async () => {
      const result = await adapter.getRecentProjects()

      expect(window.bridge.retrieveRecent).toHaveBeenCalledTimes(1)
      expect(result).toEqual(mockRecentProjects)
    })
  })

  describe('readFileContent', () => {
    it('delegates to window.bridge.fileReadContent', async () => {
      const result = await adapter.readFileContent('/path/to/file.st')

      expect(window.bridge.fileReadContent).toHaveBeenCalledWith('/path/to/file.st')
      expect(result).toEqual({ success: true, content: 'file content' })
    })
  })

  describe('watchFile', () => {
    it('delegates to window.bridge.fileWatchStart', async () => {
      const result = await adapter.watchFile!('/path/to/file.st')

      expect(window.bridge.fileWatchStart).toHaveBeenCalledWith('/path/to/file.st')
      expect(result).toEqual({ success: true })
    })
  })

  describe('unwatchFile', () => {
    it('delegates to window.bridge.fileWatchStop', async () => {
      const result = await adapter.unwatchFile!('/path/to/file.st')

      expect(window.bridge.fileWatchStop).toHaveBeenCalledWith('/path/to/file.st')
      expect(result).toEqual({ success: true })
    })
  })

  describe('unwatchAll', () => {
    it('delegates to window.bridge.fileWatchStopAll', async () => {
      const result = await adapter.unwatchAll!()

      expect(window.bridge.fileWatchStopAll).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true })
    })
  })

  describe('onFileExternalChange', () => {
    it('subscribes via window.bridge.onFileExternalChange and returns unsubscribe', () => {
      const callback = jest.fn()
      const unsubscribe = adapter.onFileExternalChange!(callback)

      expect(window.bridge.onFileExternalChange).toHaveBeenCalledTimes(1)
      expect(typeof unsubscribe).toBe('function')
    })

    it('unwraps the IPC event and passes filePath to callback', () => {
      let bridgeCallback: (event: unknown, data: { filePath: string }) => void = () => {}
      ;(window.bridge.onFileExternalChange as jest.Mock).mockImplementation(
        (cb: (event: unknown, data: { filePath: string }) => void) => {
          bridgeCallback = cb
          return () => {}
        },
      )

      const callback = jest.fn()
      adapter.onFileExternalChange!(callback)

      bridgeCallback({}, { filePath: '/changed/file.st' })

      expect(callback).toHaveBeenCalledWith('/changed/file.st')
    })
  })
})
