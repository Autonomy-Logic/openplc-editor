/**
 * window:project-open tells the menu whether a project is open, so its project-only items
 * (and their accelerators) are off on the start screen.
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

const menuBuilder = { buildMenu: jest.fn(), setProjectOpen: jest.fn(() => Promise.resolve()) }

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
