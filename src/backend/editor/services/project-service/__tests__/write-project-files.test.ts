import type { WriteProjectFiles } from '@root/middleware/shared/ports/project-port'
import { promises } from 'fs'

import { ProjectService } from '../index'

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/userData' },
  BrowserWindow: class {},
  dialog: {},
}))

jest.mock('fs', () => ({
  promises: { mkdir: jest.fn(), writeFile: jest.fn(), unlink: jest.fn() },
  existsSync: jest.fn().mockReturnValue(false),
}))

jest.mock('../utils', () => ({
  createProjectDefaultStructure: jest.fn(),
  readProjectFiles: jest.fn(),
}))

jest.mock('../../../utils', () => ({ fileOrDirectoryExists: jest.fn().mockReturnValue(false) }))

const mkdir = promises.mkdir as jest.Mock
const writeFile = promises.writeFile as jest.Mock

const writtenPaths = () => writeFile.mock.calls.map((call) => String(call[0]).replace(/\\/g, '/'))

const makeFiles = (overrides: Partial<WriteProjectFiles> = {}): WriteProjectFiles => ({
  projectPath: '/projects/demo',
  projectJson: '{"meta":{},"data":{"dataTypes":[]}}',
  deviceConfig: '',
  pinMapping: '',
  pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'PROGRAM main\nEND_PROGRAM' }],
  serverFiles: [],
  remoteDeviceFiles: [],
  dataTypeFiles: [{ relativePath: 'datatypes/Color.dt', content: 'TYPE\n  Color : (Red);\nEND_TYPE\n' }],
  deletions: [],
  ...overrides,
})

describe('ProjectService.writeProjectFiles', () => {
  let service: ProjectService

  beforeEach(() => {
    jest.clearAllMocks()
    mkdir.mockResolvedValue(undefined)
    writeFile.mockResolvedValue(undefined)
    service = new ProjectService({} as ConstructorParameters<typeof ProjectService>[0])
  })

  it('writes project.json only after every content file has landed', async () => {
    let releaseDtWrite = () => {}
    const dtWritePending = new Promise<void>((resolve) => {
      releaseDtWrite = resolve
    })
    writeFile.mockImplementation((path: string) => (String(path).endsWith('.dt') ? dtWritePending : Promise.resolve()))

    const saving = service.writeProjectFiles(makeFiles())
    // Drain the microtask queue so every write that *can* start has started.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The `.dt` write is still in flight, so the index must not exist yet.
    expect(writtenPaths()).toContain('/projects/demo/pous/programs/main.st')
    expect(writtenPaths()).not.toContain('/projects/demo/project.json')

    releaseDtWrite()
    const result = await saving

    expect(result.success).toBe(true)
    const paths = writtenPaths()
    expect(paths.indexOf('/projects/demo/project.json')).toBe(paths.length - 1)
  })

  // project.json is the index that declares `dataTypes: []` once the types
  // live in their own files. Writing it while a `.dt` write fails would lose
  // that type from both places — and the first save of a migrating project is
  // exactly when this fires.
  it('leaves project.json untouched when a .dt write rejects', async () => {
    writeFile.mockImplementation((path: string) =>
      String(path).endsWith('.dt') ? Promise.reject(new Error('ENOSPC')) : Promise.resolve(undefined),
    )

    const result = await service.writeProjectFiles(makeFiles())

    expect(result.success).toBe(false)
    expect(writtenPaths()).not.toContain('/projects/demo/project.json')
  })

  // Returning while a write is still in flight lets a straggler from the
  // failed save land after — and overwrite — a write from the user's retry.
  it('waits for the slow writes before reporting a failure', async () => {
    let releasePou = () => {}
    const pouWritePending = new Promise<void>((resolve) => {
      releasePou = resolve
    })
    writeFile.mockImplementation((path: string) => {
      if (String(path).endsWith('.dt')) return Promise.reject(new Error('ENOSPC'))
      if (String(path).endsWith('.st')) return pouWritePending
      return Promise.resolve(undefined)
    })

    let saveResolved = false
    const saving = service.writeProjectFiles(makeFiles()).then((result) => {
      saveResolved = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The `.dt` write has already rejected. Returning here would hand control
    // back while the POU write is still outstanding.
    expect(saveResolved).toBe(false)

    releasePou()
    const result = await saving

    expect(result.success).toBe(false)
    expect(writtenPaths()).not.toContain('/projects/demo/project.json')
  })

  it('leaves project.json untouched when a POU write rejects', async () => {
    writeFile.mockImplementation((path: string) =>
      String(path).endsWith('.st') ? Promise.reject(new Error('EACCES')) : Promise.resolve(undefined),
    )

    const result = await service.writeProjectFiles(makeFiles())

    expect(result.success).toBe(false)
    expect(writtenPaths()).not.toContain('/projects/demo/project.json')
  })
})
