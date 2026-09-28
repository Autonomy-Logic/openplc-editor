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

const webContentsListeners = new Map<string, Array<(...args: unknown[]) => void>>()

const mainWindow = {
  isDestroyed: jest.fn(() => false),
  isMaximized: jest.fn(() => false),
  destroy: jest.fn(),
  webContents: {
    reload: jest.fn(),
    send: jest.fn(),
    isCrashed: jest.fn(() => false),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      webContentsListeners.set(event, [...(webContentsListeners.get(event) ?? []), handler])
    }),
  },
}

let bridge: MainProcessBridge

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

function emitWebContents(event: string, ...args: unknown[]): void {
  const handlers = webContentsListeners.get(event)
  if (!handlers?.length) throw new Error(`nothing listens on webContents "${event}"`)
  for (const handler of handlers) handler(...args)
}

beforeEach(() => {
  listeners.clear()
  webContentsListeners.clear()
  jest.clearAllMocks()
  mainWindow.webContents.isCrashed.mockReturnValue(false)
  bridge = createBridge()
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

/** Whether the renderer can show the quit prompt right now; the coordinator's canPrompt reads this. */
describe('canPromptQuit', () => {
  it('is false until the renderer says its prompt listener is ready', () => {
    expect(bridge.canPromptQuit()).toBe(false)
  })

  it('is true once app:quit-ready arrives', () => {
    emit('app:quit-ready')

    expect(bridge.canPromptQuit()).toBe(true)
  })

  it('is false again after app:quit-unready', () => {
    emit('app:quit-ready')
    emit('app:quit-unready')

    expect(bridge.canPromptQuit()).toBe(false)
  })

  it('is false while the renderer is crashed, even after it was ready', () => {
    emit('app:quit-ready')
    mainWindow.webContents.isCrashed.mockReturnValue(true)

    expect(bridge.canPromptQuit()).toBe(false)
  })

  it('resets when the renderer process goes away', () => {
    emit('app:quit-ready')

    emitWebContents('render-process-gone', {}, { reason: 'crashed' })
    mainWindow.webContents.isCrashed.mockReturnValue(false)

    expect(bridge.canPromptQuit()).toBe(false)
  })

  it('resets when the main frame starts a new navigation (reload)', () => {
    emit('app:quit-ready')

    emitWebContents('did-start-navigation', { isMainFrame: true, isSameDocument: false })

    expect(bridge.canPromptQuit()).toBe(false)
  })

  it('survives in-page and subframe navigations', () => {
    emit('app:quit-ready')

    emitWebContents('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    emitWebContents('did-start-navigation', { isMainFrame: false, isSameDocument: false })

    expect(bridge.canPromptQuit()).toBe(true)
  })

  it('becomes true again when the reloaded renderer reports ready', () => {
    emit('app:quit-ready')
    emitWebContents('did-start-navigation', { isMainFrame: true, isSameDocument: false })

    emit('app:quit-ready')

    expect(bridge.canPromptQuit()).toBe(true)
  })
})

/** The renderer's beforeunload blocks uninvited unloads; only a reload the user confirmed may pass it. */
describe('confirmed reload', () => {
  const unloadEvent = () => ({ preventDefault: jest.fn() })

  it('leaves an uninvited unload to the renderer guard', () => {
    const event = unloadEvent()

    emitWebContents('will-prevent-unload', event)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('lets the reload requested over window:reload past the guard', () => {
    emit('window:reload')
    const event = unloadEvent()

    emitWebContents('will-prevent-unload', event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mainWindow.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('arms the bypass before reloading', () => {
    mainWindow.webContents.reload.mockImplementationOnce(() => {
      const event = unloadEvent()
      emitWebContents('will-prevent-unload', event)
      expect(event.preventDefault).toHaveBeenCalled()
    })

    emit('window:reload')

    expect(mainWindow.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('is spent once the reload navigation starts', () => {
    emit('window:reload')
    emitWebContents('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    const later = unloadEvent()

    emitWebContents('will-prevent-unload', later)

    expect(later.preventDefault).not.toHaveBeenCalled()
  })
})
