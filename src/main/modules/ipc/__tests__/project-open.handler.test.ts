/**
 * window:project-open tells the menu whether a project is open, so its project-only items
 * (and their accelerators) are off on the start screen. Closing also drops the file-access root.
 */

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

jest.mock('@root/backend/editor/ethercat', () => ({ ESIService: jest.fn() }))
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

const listeners = new Map<string, (...args: unknown[]) => unknown>()

const menuBuilder = { buildMenu: jest.fn(() => Promise.resolve()), setProjectOpen: jest.fn(() => Promise.resolve()) }

function createBridge(): MainProcessBridge {
  const bridge = new MainProcessBridge({
    ipcMain: {
      on: jest.fn((channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler)),
      handle: jest.fn(),
      removeHandler: jest.fn(),
      removeAllListeners: jest.fn(),
    },
    mainWindow: {
      isDestroyed: jest.fn(() => false),
      webContents: { send: jest.fn(), on: jest.fn(), isCrashed: jest.fn(() => false) },
    },
    projectService: {},
    store: { get: jest.fn(() => undefined) },
    menuBuilder,
    pouService: {},
    compilerModule: {},
    hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
    quitCoordinator: {},
  } as never)
  bridge.setupMainIpcListener()
  return bridge
}

function emit(channel: string, ...args: unknown[]): void {
  const handler = listeners.get(channel)
  if (!handler) throw new Error(`nothing listens on "${channel}"`)
  handler({}, ...args)
}

beforeEach(() => {
  listeners.clear()
  jest.clearAllMocks()
  createBridge()
})

describe('window:project-open', () => {
  it.each([true, false])('passes %s to the menu', (open) => {
    emit('window:project-open', open)

    expect(menuBuilder.setProjectOpen).toHaveBeenCalledWith(open)
  })

  it.each([undefined, 'true', 1, null, {}])('ignores a non-boolean payload (%p)', (payload) => {
    emit('window:project-open', payload)

    expect(menuBuilder.setProjectOpen).not.toHaveBeenCalled()
  })
})

describe('file-access root', () => {
  const projectService = {
    readRawProjectFiles: jest.fn(() => Promise.resolve({ success: true })),
    updateProjectHistory: jest.fn(() => Promise.resolve()),
  }
  let workDir: string
  let projectA: string
  let projectB: string
  let bridge: MainProcessBridge

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'dope-668-'))
    projectA = join(workDir, 'a')
    projectB = join(workDir, 'b')
    for (const project of [projectA, projectB]) {
      mkdirSync(project)
      writeFileSync(join(project, 'main.st'), 'PROGRAM main END_PROGRAM')
    }
    listeners.clear()
    bridge = new MainProcessBridge({
      ipcMain: {
        on: jest.fn((channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler)),
        handle: jest.fn(),
        removeHandler: jest.fn(),
        removeAllListeners: jest.fn(),
      },
      mainWindow: {
        isDestroyed: jest.fn(() => false),
        webContents: { send: jest.fn(), on: jest.fn(), isCrashed: jest.fn(() => false) },
      },
      projectService,
      store: { get: jest.fn(() => undefined) },
      menuBuilder,
      pouService: {},
      compilerModule: {},
      hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
      quitCoordinator: {},
    } as never)
    bridge.setupMainIpcListener()
  })

  afterEach(() => rmSync(workDir, { recursive: true, force: true }))

  const readFile = (project: string) => bridge.handleFileReadContent({} as never, join(project, 'main.st'))

  it('follows the project opened last', async () => {
    await bridge.handleReadProjectFiles({} as never, projectA)
    await bridge.handleReadProjectFiles({} as never, projectB)

    expect((await readFile(projectB)).success).toBe(true)
    expect((await readFile(projectA)).success).toBe(false)
  })

  it('refuses every path once the project closes', async () => {
    await bridge.handleReadProjectFiles({} as never, projectB)

    emit('window:project-open', false)

    expect((await readFile(projectB)).success).toBe(false)
  })

  it('accepts the next project opened after a close', async () => {
    await bridge.handleReadProjectFiles({} as never, projectA)
    emit('window:project-open', false)

    await bridge.handleReadProjectFiles({} as never, projectB)

    expect((await readFile(projectB)).success).toBe(true)
  })

  it('rebuilds the menu so Recent shows the history the open changed', async () => {
    menuBuilder.buildMenu.mockClear()

    await bridge.handleReadProjectFiles({} as never, projectB)

    expect(projectService.updateProjectHistory).toHaveBeenCalledWith(projectB)
    expect(menuBuilder.buildMenu).toHaveBeenCalled()
  })

  it('rebuilds the menu after a failed open too', async () => {
    projectService.readRawProjectFiles.mockResolvedValueOnce({ success: false })
    menuBuilder.buildMenu.mockClear()

    await bridge.handleReadProjectFiles({} as never, join(workDir, 'gone'))

    expect(menuBuilder.buildMenu).toHaveBeenCalled()
  })

  it('stops a watcher started in the previous project after the root moves', async () => {
    await bridge.handleReadProjectFiles({} as never, projectA)
    const watched = join(projectA, 'main.st')
    expect((await bridge.handleFileWatchStart({} as never, watched)).success).toBe(true)

    await bridge.handleReadProjectFiles({} as never, projectB)

    expect(bridge.handleFileWatchStop({} as never, watched).success).toBe(true)
    expect(bridge.handleFileWatchStop({} as never, watched).success).toBe(false)
  })

  it('leaves the root on the open project when the history update fails', async () => {
    await bridge.handleReadProjectFiles({} as never, projectA)
    projectService.updateProjectHistory.mockRejectedValueOnce(new Error('disk full'))

    expect((await bridge.handleReadProjectFiles({} as never, projectB)).success).toBe(false)

    expect((await readFile(projectA)).success).toBe(true)
    expect((await readFile(projectB)).success).toBe(false)
  })

  it('keeps the root when the project stays open', async () => {
    await bridge.handleReadProjectFiles({} as never, projectB)

    emit('window:project-open', true)

    expect((await readFile(projectB)).success).toBe(true)
  })
})
