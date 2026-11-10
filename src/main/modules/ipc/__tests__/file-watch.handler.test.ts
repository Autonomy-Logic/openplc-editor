import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import MainProcessBridge from '../main'

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp'), quit: jest.fn() },
  dialog: {},
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  shell: { openExternal: jest.fn() },
}))

jest.mock('@root/backend/editor/ethercat', () => ({ EsiProjectFiles: jest.fn() }))
jest.mock('@root/backend/editor/library-manager/desktop-catalog-transport', () => ({
  createDesktopCatalogTransport: jest.fn(() => ({})),
}))
jest.mock('@root/backend/editor/utils/runtime-https-config', () => ({ getRuntimeHttpsOptions: jest.fn(() => ({})) }))
jest.mock('@root/backend/shared/ethercat/esi-parser-main', () => ({ parseESIDeviceFull: jest.fn() }))
jest.mock('@root/backend/shared/library/public-catalog-client', () => ({ listPublicLibraries: jest.fn() }))
jest.mock('../../../../backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn(() => ({ loadEnabledArchives: jest.fn(() => ({ archives: [], missing: [] })) })),
}))
jest.mock('../../../../backend/editor/package-manager', () => ({ PackageManagerModule: jest.fn(() => ({})) }))
jest.mock('../../../../backend/editor/services', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('../../../../backend/editor/utils', () => ({ getOpenProjectPath: jest.fn(), getProjectPath: jest.fn() }))

type Handler = (...args: unknown[]) => unknown

const handles = new Map<string, Handler>()

interface WriteObserver {
  onFileWritten(absolutePath: string): void
}

const projectService = {
  readRawProjectFiles: jest.fn(() => Promise.resolve({ success: true })),
  updateProjectHistory: jest.fn(() => Promise.resolve()),
  openProjectByPath: jest.fn(() => Promise.resolve({ success: true, data: { meta: { path: '' } } })),
  writeProjectFiles: jest.fn((_files: unknown, _observer?: WriteObserver) => Promise.resolve({ success: true })),
  saveFile: jest.fn(() => Promise.resolve({ success: true })),
}

let workDir: string
let projectRoot: string
let mainPath: string
let bridge: MainProcessBridge

function createBridge(): MainProcessBridge {
  handles.clear()
  const created = new MainProcessBridge({
    ipcMain: {
      on: jest.fn(),
      handle: jest.fn((channel: string, handler: Handler) => handles.set(channel, handler)),
      removeHandler: jest.fn(),
      removeAllListeners: jest.fn(),
    },
    mainWindow: {
      isDestroyed: jest.fn(() => false),
      webContents: { send: jest.fn(), on: jest.fn(), isCrashed: jest.fn(() => false) },
    },
    projectService,
    store: { get: jest.fn(() => undefined) },
    menuBuilder: { buildMenu: jest.fn(() => Promise.resolve()), setProjectOpen: jest.fn(() => Promise.resolve()) },
    pouService: {},
    compilerModule: {},
    hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
    quitCoordinator: {},
  } as never)
  created.setupMainIpcListener()
  return created
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handles.get(channel)
  if (!handler) throw new Error(`nothing handles "${channel}"`)
  return handler({}, ...args)
}

beforeEach(async () => {
  jest.clearAllMocks()
  workDir = mkdtempSync(join(tmpdir(), 'dope-829-watch-'))
  projectRoot = join(workDir, 'project')
  mkdirSync(join(projectRoot, 'pous', 'programs'), { recursive: true })
  mainPath = join(projectRoot, 'pous', 'programs', 'main.st')
  writeFileSync(mainPath, 'PROGRAM main\nEND_PROGRAM')
  writeFileSync(join(projectRoot, 'project.json'), '{}')
  projectService.openProjectByPath.mockImplementation(() =>
    Promise.resolve({ success: true, data: { meta: { path: projectRoot } } }),
  )
  bridge = createBridge()
  await invoke('project:open-by-path', projectRoot)
})

afterEach(() => {
  bridge.fileWatchRegistry.stopAll()
  rmSync(workDir, { recursive: true, force: true })
})

describe('the project write records its own files with the watch registry', () => {
  it('hands writeProjectFiles an observer that reaches the registry', async () => {
    const recordOwnWrite = jest.spyOn(bridge.fileWatchRegistry, 'recordOwnWrite')
    projectService.writeProjectFiles.mockImplementation((_files: unknown, observer?: WriteObserver) => {
      observer?.onFileWritten(mainPath)
      return Promise.resolve({ success: true })
    })

    await invoke('project:write-files', { projectPath: projectRoot })

    expect(recordOwnWrite).toHaveBeenCalledWith(mainPath)
  })

  it('records a single-file save with the registry', async () => {
    const recordOwnWrite = jest.spyOn(bridge.fileWatchRegistry, 'recordOwnWrite')

    await invoke('project:save-file', mainPath, 'PROGRAM main\nEND_PROGRAM')

    expect(recordOwnWrite).toHaveBeenCalledWith(mainPath)
  })

  it('does not record a single-file save that failed', async () => {
    const recordOwnWrite = jest.spyOn(bridge.fileWatchRegistry, 'recordOwnWrite')
    projectService.saveFile.mockResolvedValueOnce({ success: false })

    await invoke('project:save-file', mainPath, 'PROGRAM main\nEND_PROGRAM')

    expect(recordOwnWrite).not.toHaveBeenCalled()
  })
})

describe('file:watch-start', () => {
  it('watches a file inside the open project', async () => {
    await expect(invoke('file:watch-start', mainPath)).resolves.toEqual({ success: true })
  })

  it('refuses a path outside the project directory', async () => {
    const outside = join(workDir, 'outside.st')
    writeFileSync(outside, 'PROGRAM outside\nEND_PROGRAM')

    await expect(invoke('file:watch-start', outside)).resolves.toEqual({
      success: false,
      error: 'Path is outside the project directory',
    })
  })
})
