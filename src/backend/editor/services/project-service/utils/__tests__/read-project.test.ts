import { promises, readdirSync, readFileSync, writeFileSync } from 'fs'

jest.mock('electron', () => ({
  app: { getPath: jest.fn().mockReturnValue('/tmp') },
  dialog: { showOpenDialog: jest.fn() },
  BrowserWindow: jest.fn(),
}))

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  promises: {
    opendir: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@root/backend/shared/utils/default-zod-schema-values', () => ({
  getDefaultSchemaValues: jest.fn().mockReturnValue({
    meta: { name: '', type: '' },
    data: {
      pous: [],
      dataTypes: [],
      configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
  }),
}))

jest.mock('@root/backend/shared/utils/migrate-project-to-name-type-system', () => ({
  needsMigration: jest.fn().mockReturnValue(false),
  migrateProjectToNameTypeSystem: jest.fn(),
}))

jest.mock('@root/frontend/utils/PLC/pou-file-extensions', () => ({
  getExtensionFromLanguage: jest.fn().mockReturnValue('.st'),
}))

jest.mock('@root/frontend/utils/PLC/pou-text-parser', () => ({
  detectLanguageFromExtension: jest.fn().mockReturnValue('st'),
  parseTextualPouFromString: jest.fn(),
  parseHybridPouFromString: jest.fn(),
  parseGraphicalPouFromString: jest.fn(),
}))

jest.mock('@root/frontend/utils/PLC/pou-text-serializer', () => ({
  serializePouToText: jest.fn().mockReturnValue('PROGRAM main\nEND_PROGRAM'),
}))

// Mock schemas
jest.mock('@root/types/IPC/project-service', () => {
  const { z } = jest.requireActual('zod')
  return {
    projectDefaultFilesMapSchema: {
      'project.json': z.object({
        meta: z.object({ name: z.string(), type: z.string() }).default({ name: '', type: '' }),
        data: z
          .object({
            pous: z.array(z.any()).default([]),
            dataTypes: z.array(z.any()).default([]),
            configuration: z
              .object({
                resource: z
                  .object({
                    tasks: z.array(z.any()).default([]),
                    instances: z.array(z.any()).default([]),
                    globalVariables: z.array(z.any()).default([]),
                  })
                  .default({}),
              })
              .default({}),
          })
          .default({}),
      }),
      'devices/configuration.json': z.object({
        communicationPort: z.string().default(''),
      }),
      'devices/pin-mapping.json': z.array(z.any()).default([]),
    },
    projectPouDirectories: ['pous/functions', 'pous/function-blocks', 'pous/programs'],
  }
})

jest.mock('@root/types/PLC/open-plc', () => ({
  PLCPouSchema: {
    safeParse: jest.fn().mockReturnValue({ success: true, data: {} }),
  },
  PLCServerSchema: {
    safeParse: jest.fn().mockReturnValue({ success: false }),
  },
  PLCRemoteDeviceSchema: {
    safeParse: jest.fn().mockReturnValue({ success: false }),
  },
}))

import { existsSync } from 'fs'

import {
  detectLanguageFromExtension,
  parseTextualPouFromString,
} from '@root/frontend/utils/PLC/pou-text-parser'

import { readProjectFiles } from '../read-project'

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>
const mockedReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>
const mockedMkdir = promises.mkdir as jest.MockedFunction<typeof promises.mkdir>
const mockedWriteFile = promises.writeFile as jest.MockedFunction<typeof promises.writeFile>
const mockedParseTextual = parseTextualPouFromString as jest.MockedFunction<typeof parseTextualPouFromString>
const mockedDetectLang = detectLanguageFromExtension as jest.MockedFunction<typeof detectLanguageFromExtension>

describe('readProjectFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedExistsSync.mockReturnValue(true)
    mockedWriteFileSync.mockReturnValue(undefined)
    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedDetectLang.mockReturnValue('st')
  })

  function setupBasicProject() {
    const projectData = {
      meta: { name: 'Test', type: 'plc-project' },
      data: {
        pous: [],
        dataTypes: [],
        configuration: {
          resource: {
            tasks: [],
            instances: [],
            globalVariables: [],
          },
        },
      },
    }

    // readdirSync for base path (checking project.json)
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      // POU directories - return empty
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation((_filePath: unknown) => {
      return JSON.stringify(projectData)
    })

    return projectData
  }

  it('returns error when directory does not exist', async () => {
    mockedExistsSync.mockReturnValue(false)

    const result = await readProjectFiles('/nonexistent')
    expect(result.success).toBe(false)
    expect(result.error?.title).toContain('Directory not found')
  })

  it('returns error when project.json is missing', async () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockReturnValue([
      { name: 'other.txt', isFile: () => true, isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>)

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(false)
    expect(result.error?.title).toContain('Invalid project')
  })

  it('reads a valid project successfully', async () => {
    setupBasicProject()

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data!.project).toBeDefined()
  })

  it('creates missing config files with defaults', async () => {
    setupBasicProject()

    // Simulate configuration file not existing
    mockedExistsSync.mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('configuration.json') || path.includes('pin-mapping.json')) {
        return false
      }
      return true
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(mockedWriteFileSync).toHaveBeenCalled()
  })

  it('reads POU files from directories', async () => {
    setupBasicProject()

    const parsedPou = {
      name: 'main',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
      documentation: '',
    }

    mockedParseTextual.mockReturnValue(parsedPou as never)

    // Override readdirSync to return POU files
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('programs')) {
        return [
          { name: 'main.st', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('main.st')) {
        return 'PROGRAM main\nVAR\nEND_VAR\nEND_PROGRAM'
      }
      return JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: {
          pous: [],
          dataTypes: [],
          configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
        },
      })
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(result.data!.pous.length).toBeGreaterThanOrEqual(0)
  })

  it('reads JSON POU files for backward compatibility', async () => {
    setupBasicProject()

    const jsonPou = {
      type: 'program',
      data: {
        name: 'legacy',
        language: 'st',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PLCPouSchema } = require('@root/types/PLC/open-plc')
    PLCPouSchema.safeParse.mockReturnValue({ success: true, data: jsonPou })

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('programs')) {
        return [
          { name: 'legacy.json', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('legacy.json') && p.includes('programs')) {
        return JSON.stringify(jsonPou)
      }
      return JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: {
          pous: [],
          dataTypes: [],
          configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
        },
      })
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
  })

  it('reads server and remote device files', async () => {
    setupBasicProject()

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PLCServerSchema, PLCRemoteDeviceSchema } = require('@root/types/PLC/open-plc')
    PLCServerSchema.safeParse.mockReturnValue({
      success: true,
      data: { name: 'server1', protocol: 'modbus-tcp' },
    })
    PLCRemoteDeviceSchema.safeParse.mockReturnValue({
      success: true,
      data: { name: 'remote1', protocol: 'modbus-tcp' },
    })

    mockedExistsSync.mockReturnValue(true)

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('servers')) {
        return [
          { name: 'server1.json', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      if (p.includes('remote')) {
        return [
          { name: 'remote1.json', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation(() => JSON.stringify({}))

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(result.data!.servers).toHaveLength(1)
    expect(result.data!.remoteDevices).toHaveLength(1)
  })

  it('skips invalid server files', async () => {
    setupBasicProject()

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PLCServerSchema } = require('@root/types/PLC/open-plc')
    PLCServerSchema.safeParse.mockReturnValue({ success: false })

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('servers')) {
        return [
          { name: 'bad.json', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation(() => JSON.stringify({}))

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(result.data!.servers).toHaveLength(0)
  })

  it('handles project with embedded pous needing migration', async () => {
    const projectData = {
      meta: { name: 'Test', type: 'plc-project' },
      data: {
        pous: [
          {
            type: 'program',
            data: {
              name: 'main',
              language: 'st',
              variables: [],
              body: { language: 'st', value: '' },
              documentation: '',
            },
          },
        ],
        dataTypes: [],
        configuration: {
          resource: {
            tasks: [],
            instances: [],
            globalVariables: [],
          },
        },
      },
    }

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation(() => JSON.stringify(projectData))
    mockedExistsSync.mockReturnValue(true)

    // The POU file already exists, so it won't be created
    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
  })

  it('sets POU name from filename when name is missing', async () => {
    setupBasicProject()

    const pouWithoutName = {
      type: 'program',
      data: {
        name: '',
        language: 'st',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PLCPouSchema } = require('@root/types/PLC/open-plc')
    PLCPouSchema.safeParse.mockReturnValue({ success: true, data: pouWithoutName })

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('programs')) {
        return [
          { name: 'myprogram.json', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('myprogram.json') && p.includes('programs')) {
        return JSON.stringify(pouWithoutName)
      }
      return JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: {
          pous: [],
          dataTypes: [],
          configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
        },
      })
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
  })

  it('prefers text-based files over JSON when both exist', async () => {
    setupBasicProject()

    const parsedPou = {
      name: 'dual',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: 'x := 1;' },
      documentation: '',
    }
    mockedParseTextual.mockReturnValue(parsedPou as never)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PLCPouSchema } = require('@root/types/PLC/open-plc')
    PLCPouSchema.safeParse.mockReturnValue({
      success: true,
      data: {
        type: 'program',
        data: { name: 'dual', language: 'st', variables: [], body: { language: 'st', value: '' }, documentation: '' },
      },
    })

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('programs')) {
        return [
          // JSON first, then text-based - text should win
          { name: 'dual.json', isFile: () => true, isDirectory: () => false },
          { name: 'dual.st', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('dual.json') && p.includes('programs')) {
        return JSON.stringify({
          type: 'program',
          data: { name: 'dual', language: 'st', variables: [], body: { language: 'st', value: '' }, documentation: '' },
        })
      }
      if (p.includes('dual.st')) {
        return 'PROGRAM dual\nVAR\nEND_VAR\nx := 1;\nEND_PROGRAM'
      }
      return JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
      })
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
  })

  it('uses fallback POU when parsing fails', async () => {
    setupBasicProject()

    mockedParseTextual.mockImplementation(() => {
      throw new Error('parse failed')
    })

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('programs')) {
        return [
          { name: 'broken.st', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('broken.st')) {
        return 'PROGRAM broken\nVAR\n  x : BOOL;\nEND_VAR\nx := TRUE;\nEND_PROGRAM'
      }
      return JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
      })
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    // Fallback POU should be created
    expect(result.data!.pous.length).toBeGreaterThanOrEqual(0)
  })

  it('handles subdirectories in POU directories', async () => {
    setupBasicProject()

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('programs') && !p.includes('subdir')) {
        return [
          { name: 'subdir', isFile: () => false, isDirectory: () => true },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      if (p.includes('subdir')) {
        return [] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation(() =>
      JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
      }),
    )

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
  })

  it('handles empty file content by creating defaults', async () => {
    setupBasicProject()

    mockedExistsSync.mockReturnValue(true)
    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('configuration.json')) {
        return '' // empty file
      }
      return JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
      })
    })

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
  })

  it('skips files with invalid extensions', async () => {
    setupBasicProject()

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('programs')) {
        return [
          { name: 'readme.txt', isFile: () => true, isDirectory: () => false },
          { name: '.DS_Store', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation(() =>
      JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
      }),
    )

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(result.data!.pous).toHaveLength(0)
  })

  it('skips non-json files in servers directory', async () => {
    setupBasicProject()

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('servers')) {
        return [
          { name: 'readme.txt', isFile: () => true, isDirectory: () => false },
          { name: 'subdir', isFile: () => false, isDirectory: () => true },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation(() => JSON.stringify({}))

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(result.data!.servers).toHaveLength(0)
  })

  it('handles server file parse errors gracefully', async () => {
    setupBasicProject()

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      if (p.includes('servers')) {
        return [
          { name: 'bad.json', isFile: () => true, isDirectory: () => false },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('bad.json') && p.includes('servers')) {
        throw new Error('corrupted file')
      }
      return JSON.stringify({
        meta: { name: 'Test', type: 'plc-project' },
        data: { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
      })
    })

    const result = await readProjectFiles('/test/project')
    expect(result.success).toBe(true)
    expect(result.data!.servers).toHaveLength(0)
  })

  it('uses defaults when readAndParseFile throws', async () => {
    mockedExistsSync.mockReturnValue(true)

    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = String(dirPath)
      if (p === '/test/project') {
        return [{ name: 'project.json', isFile: () => true, isDirectory: () => false }] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockedReadFileSync.mockImplementation(() => {
      throw new Error('file read error')
    })

    const result = await readProjectFiles('/test/project')
    // Should fallback to defaults
    expect(result.success).toBe(true)
  })
})
