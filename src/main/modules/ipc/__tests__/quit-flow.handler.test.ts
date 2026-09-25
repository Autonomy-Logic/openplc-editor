/**
 * The quit channels hand off to the quit coordinator, so the prompt and the
 * confirmed quit follow one path on every platform.
 */

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

const quitCoordinator = {
  handleBeforeQuit: jest.fn(),
  handleWindowClose: jest.fn(),
  requestQuit: jest.fn(),
  confirmQuit: jest.fn(),
}

const mainWindow = {
  isDestroyed: jest.fn(() => false),
  isMaximized: jest.fn(() => false),
  destroy: jest.fn(),
  webContents: { reload: jest.fn(), send: jest.fn() },
}

function createBridge(): MainProcessBridge {
  const bridge = new MainProcessBridge({
    ipcMain: {
      on: jest.fn((channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler)),
      handle: jest.fn(),
      removeHandler: jest.fn(),
      removeAllListeners: jest.fn(),
    },
    mainWindow,
    projectService: {},
    store: { get: jest.fn(() => undefined) },
    menuBuilder: {},
    pouService: {},
    compilerModule: {},
    hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
    quitCoordinator,
  } as never)
  bridge.setupMainIpcListener()
  return bridge
}

function emit(channel: string): void {
  const handler = listeners.get(channel)
  if (!handler) throw new Error(`nothing listens on "${channel}"`)
  handler({})
}

beforeEach(() => {
  listeners.clear()
  jest.clearAllMocks()
  createBridge()
})

describe('quit channels', () => {
  it('app:request-quit asks the coordinator for the prompt', () => {
    emit('app:request-quit')

    expect(quitCoordinator.requestQuit).toHaveBeenCalledTimes(1)
    expect(quitCoordinator.confirmQuit).not.toHaveBeenCalled()
  })

  it('app:quit confirms through the coordinator', () => {
    emit('app:quit')

    expect(quitCoordinator.confirmQuit).toHaveBeenCalledTimes(1)
  })

  it('app:quit leaves ending the app to the coordinator', () => {
    const { app } = jest.requireMock<{ app: { quit: jest.Mock } }>('electron')

    emit('app:quit')

    expect(app.quit).not.toHaveBeenCalled()
    expect(mainWindow.destroy).not.toHaveBeenCalled()
  })
})
