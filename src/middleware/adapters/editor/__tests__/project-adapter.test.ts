import type { ProjectPort } from '../../../shared/ports/project-port'
import { createEditorProjectAdapter, mapIpcPouToPortPou, mapPortPouToIpcPou } from '../project-adapter'

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
            variables: [
              { name: 'x', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' },
            ],
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
      },
      devicePinMapping: [{ pin: '2', pinType: 'digitalInput', address: '%IX0.0' }],
    },
  },
}

const mockErrorResponse = {
  success: false,
  error: { title: 'Error', description: 'Something went wrong', error: new Error('fail') },
}

const mockSaveResponse = { success: true }
const mockSaveErrorResponse = { success: false, error: 'Disk full' }

const mockPouResponse = { success: true, data: { filePath: '/path/to/pou.st', pou: {} } }
const mockPouErrorResponse = {
  success: false,
  error: { title: 'POU Error', description: 'File already exists', error: null },
}

const mockRecentProjects = [
  { name: 'Project 1', path: '/path/to/project1', lastOpenedAt: '2026-03-10', createdAt: '2026-03-01' },
]

const mockRawProjectFiles = {
  success: true,
  data: {
    projectPath: '/home/user/projects/my-project',
    projectJson: JSON.stringify({
      meta: { name: 'my-project', type: 'plc-project', author: '', version: '1.0' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
    }),
    deviceConfig: JSON.stringify({
      deviceBoard: 'Arduino Uno',
      communicationPort: '/dev/ttyUSB0',
      compileOnly: false,
    }),
    pinMapping: JSON.stringify([{ pin: '2', pinType: 'digitalInput', address: '%IX0.0' }]),
    pouFiles: [
      {
        relativePath: 'pous/programs/main.st',
        content: 'PROGRAM main\nVAR\n  x : BOOL;\nEND_VAR\n\nx := TRUE;\nEND_PROGRAM',
      },
      {
        relativePath: 'pous/functions/add_ints.st',
        content: 'FUNCTION add_ints : INT\nVAR\nEND_VAR\n\nadd_ints := a + b;\nEND_FUNCTION',
      },
    ],
    serverFiles: [],
    remoteDeviceFiles: [],
  },
}

beforeEach(() => {
  window.bridge = {
    createProject: jest.fn().mockResolvedValue(mockIpcProjectResponse),
    readProjectFiles: jest.fn().mockResolvedValue(mockRawProjectFiles),
    writeProjectFiles: jest.fn().mockResolvedValue(mockSaveResponse),
    saveFile: jest.fn().mockResolvedValue({ success: true }),
    createPouFile: jest.fn().mockResolvedValue(mockPouResponse),
    deletePouFile: jest.fn().mockResolvedValue({ success: true }),
    renamePouFile: jest.fn().mockResolvedValue(mockPouResponse),
    pathPicker: jest.fn().mockResolvedValue({ success: true, path: '/picked/path' }),
    openPathPicker: jest.fn().mockResolvedValue({ success: true, path: '/picked/path' }),
    retrieveRecent: jest.fn().mockResolvedValue(mockRecentProjects),
    removeProjectFromRecent: jest.fn().mockResolvedValue({ success: true }),
    deleteProject: jest.fn().mockResolvedValue({ success: true }),
    fileReadContent: jest.fn().mockResolvedValue({ success: true, content: 'file content' }),
    fileWatchStart: jest.fn().mockResolvedValue({ success: true }),
    fileWatchStop: jest.fn().mockResolvedValue({ success: true }),
    fileWatchStopAll: jest.fn().mockResolvedValue({ success: true }),
    onFileExternalChange: jest.fn().mockImplementation((_cb: unknown) => {
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

    it('returns undefined error when bridge reports failure without error object', async () => {
      ;(window.bridge.createProject as jest.Mock).mockResolvedValue({ success: false })

      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.success).toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('uses fallback meta when project.meta is null', async () => {
      const responseWithoutMeta = {
        ...mockIpcProjectResponse,
        data: {
          ...mockIpcProjectResponse.data,
          content: {
            ...mockIpcProjectResponse.data.content,
            project: {
              ...mockIpcProjectResponse.data.content.project,
              meta: null,
            },
          },
        },
      }
      ;(window.bridge.createProject as jest.Mock).mockResolvedValue(responseWithoutMeta)

      const result = await adapter.createProject({ name: 'fallback-name', type: 'plc-library' })

      expect(result.success).toBe(true)
      expect(result.data?.meta.name).toBe('fallback-name')
      expect(result.data?.meta.type).toBe('plc-library')
    })

    it('uses empty defaults when both project.meta and fallback are missing fields', async () => {
      const responseWithEmptyMeta = {
        ...mockIpcProjectResponse,
        data: {
          ...mockIpcProjectResponse.data,
          content: {
            ...mockIpcProjectResponse.data.content,
            project: {
              ...mockIpcProjectResponse.data.content.project,
              meta: { name: undefined, type: undefined },
            },
          },
        },
      }
      ;(window.bridge.createProject as jest.Mock).mockResolvedValue(responseWithEmptyMeta)

      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.success).toBe(true)
      // projectMeta is { name: undefined, type: undefined }, so ?? kicks in
      expect(result.data?.meta.name).toBe('')
      expect(result.data?.meta.type).toBe('plc-project')
    })

    it('uses empty string for path when not provided', async () => {
      await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(window.bridge.createProject).toHaveBeenCalledWith(expect.objectContaining({ path: '' }))
    })

    it('threads libraryManifest from the IPC content level into projectData', async () => {
      const manifestJson = '{ "name": "my-lib", "version": "0.1.0", "namespace": "my_lib" }\n'
      ;(window.bridge.createProject as jest.Mock).mockResolvedValueOnce({
        ...mockIpcProjectResponse,
        data: {
          ...mockIpcProjectResponse.data,
          content: {
            ...mockIpcProjectResponse.data.content,
            libraryManifest: manifestJson,
          },
        },
      })

      const result = await adapter.createProject({ name: 'my-lib', type: 'plc-library' })

      expect(result.success).toBe(true)
      expect(result.data?.projectData.libraryManifest).toBe(manifestJson)
    })

    it('omits libraryManifest when the IPC response does not carry one (PLC projects)', async () => {
      const result = await adapter.createProject({ name: 'test', type: 'plc-project' })

      expect(result.success).toBe(true)
      expect(result.data?.projectData.libraryManifest).toBeUndefined()
    })
  })

  describe('openProject', () => {
    it('uses pathPicker then readProjectFiles and parses result', async () => {
      const result = await adapter.openProject()

      expect(window.bridge.openPathPicker).toHaveBeenCalledTimes(1)
      expect(window.bridge.readProjectFiles).toHaveBeenCalledWith('/picked/path')
      expect(result.success).toBe(true)
      expect(result.data?.meta.name).toBe('my-project')
    })

    it('returns error when pathPicker fails', async () => {
      ;(window.bridge.openPathPicker as jest.Mock).mockResolvedValue({ success: false })

      const result = await adapter.openProject()

      expect(result.success).toBe(false)
    })

    it('returns error when readProjectFiles fails', async () => {
      ;(window.bridge.readProjectFiles as jest.Mock).mockResolvedValue({
        success: false,
        error: { title: 'Error', description: 'Could not read files' },
      })

      const result = await adapter.openProject()

      expect(result.success).toBe(false)
    })
  })

  describe('openProjectByPath', () => {
    it('delegates to readProjectFiles and parses result', async () => {
      const result = await adapter.openProjectByPath('/path/to/project')

      expect(window.bridge.readProjectFiles).toHaveBeenCalledWith('/path/to/project')
      expect(result.success).toBe(true)
      expect(result.data?.meta.name).toBe('my-project')
    })

    it('returns error when readProjectFiles fails', async () => {
      ;(window.bridge.readProjectFiles as jest.Mock).mockResolvedValue({
        success: false,
        error: { title: 'Not Found', description: 'Path does not exist' },
      })

      const result = await adapter.openProjectByPath('/bad/path')

      expect(result.success).toBe(false)
      expect(result.error).toEqual({ title: 'Not Found', description: 'Path does not exist' })
    })
  })

  describe('readProjectFiles', () => {
    it('delegates to window.bridge.readProjectFiles', async () => {
      const result = await adapter.readProjectFiles('/home/user/projects/my-project')

      expect(window.bridge.readProjectFiles).toHaveBeenCalledWith('/home/user/projects/my-project')
      expect(result.success).toBe(true)
      expect(result.data?.projectPath).toBe('/home/user/projects/my-project')
    })
  })

  describe('saveProject', () => {
    const writeFiles = {
      projectPath: '/home/user/projects/my-project',
      projectJson: '{"meta":{"name":"my-project","type":"plc-project"},"data":{}}',
      deviceConfig: '{}',
      pinMapping: '[]',
      pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'PROGRAM main\nEND_PROGRAM' }],
      serverFiles: [],
      remoteDeviceFiles: [],
      deletions: [],
    }

    it('delegates pre-serialized files to window.bridge.writeProjectFiles', async () => {
      const result = await adapter.saveProject(writeFiles)

      expect(window.bridge.writeProjectFiles).toHaveBeenCalledWith(writeFiles)
      expect(result).toEqual({ success: true })
    })

    it('returns error message on save failure', async () => {
      ;(window.bridge.writeProjectFiles as jest.Mock).mockResolvedValue(mockSaveErrorResponse)

      const result = await adapter.saveProject(writeFiles)

      expect(result).toEqual({ success: false, error: 'Disk full' })
    })

    it('returns fallback error message when save fails without error string', async () => {
      ;(window.bridge.writeProjectFiles as jest.Mock).mockResolvedValue({ success: false })

      const result = await adapter.saveProject(writeFiles)

      expect(result).toEqual({ success: false, error: 'Save failed' })
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

  describe('removeRecentProject', () => {
    it('delegates to window.bridge.removeProjectFromRecent with the project path', async () => {
      const result = await adapter.removeRecentProject('/p/some-project')
      expect(window.bridge.removeProjectFromRecent).toHaveBeenCalledWith('/p/some-project')
      expect(result).toEqual({ success: true })
    })

    it('passes the failure shape through unchanged', async () => {
      ;(window.bridge.removeProjectFromRecent as jest.Mock).mockResolvedValue({ success: false, error: 'EBUSY' })
      const result = await adapter.removeRecentProject('/p/some-project')
      expect(result).toEqual({ success: false, error: 'EBUSY' })
    })
  })

  describe('deleteProject', () => {
    it('delegates to window.bridge.deleteProject with the project path', async () => {
      const result = await adapter.deleteProject('/p/some-project')
      expect(window.bridge.deleteProject).toHaveBeenCalledWith('/p/some-project')
      expect(result).toEqual({ success: true })
    })

    it('passes the failure shape through unchanged (e.g. safety gate tripped)', async () => {
      // The bridge surfaces the project-service's `project.json`-missing
      // branch as { success: false, error: '...' } — the adapter is a
      // thin pass-through so the renderer sees the same shape.
      ;(window.bridge.deleteProject as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Path "..." does not contain a project.json. Removed the entry from the recent list.',
      })
      const result = await adapter.deleteProject('/p/some-project')
      expect(result.success).toBe(false)
      expect(result.error).toContain('does not contain a project.json')
    })
  })

  describe('renamePou', () => {
    it('delegates to window.bridge.renamePouFile', async () => {
      const result = await adapter.renamePou({ filePath: '/path/to/old.st', newFileName: 'new_name' })

      expect(window.bridge.renamePouFile).toHaveBeenCalledWith({
        filePath: '/path/to/old.st',
        newFileName: 'new_name',
        fileContent: undefined,
      })
      expect(result).toEqual({ success: true, data: mockPouResponse.data })
    })

    it('returns error on failure', async () => {
      ;(window.bridge.renamePouFile as jest.Mock).mockResolvedValue(mockPouErrorResponse)

      const result = await adapter.renamePou({ filePath: '/path/to/old.st', newFileName: 'bad' })

      expect(result).toEqual({ success: false, error: 'File already exists' })
    })
  })

  describe('renameProject', () => {
    it('no-ops over IPC and echoes the requested name', async () => {
      const result = await adapter.renameProject('proj-1', 'New Name')
      expect(result).toEqual({ success: true, name: 'New Name' })
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

// ---------------------------------------------------------------------------
// mapPortPouToIpcPou — branch coverage for returnType and documentation
// ---------------------------------------------------------------------------

describe('mapPortPouToIpcPou', () => {
  it('includes returnType when interface has one', () => {
    const result = mapPortPouToIpcPou({
      name: 'my_func',
      pouType: 'function',
      interface: { returnType: 'INT', variables: [] },
      body: { language: 'st', value: '' },
      documentation: 'Some docs',
    })

    expect(result.data.returnType).toBe('INT')
    expect(result.data.documentation).toBe('Some docs')
  })

  it('omits returnType when interface has none', () => {
    const result = mapPortPouToIpcPou({
      name: 'my_prog',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
    })

    expect(result.data.returnType).toBeUndefined()
    expect(result.data.documentation).toBe('')
  })
})

// ---------------------------------------------------------------------------
// mapIpcPouToPortPou — branch coverage for documentation
// ---------------------------------------------------------------------------

describe('mapIpcPouToPortPou', () => {
  it('returns documentation as undefined when empty string', () => {
    const result = mapIpcPouToPortPou({
      type: 'program',
      data: {
        name: 'main',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    })

    expect(result.documentation).toBeUndefined()
  })

  it('returns documentation when non-empty', () => {
    const result = mapIpcPouToPortPou({
      type: 'program',
      data: {
        name: 'main',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: 'Test documentation',
      },
    })

    expect(result.documentation).toBe('Test documentation')
  })
})
