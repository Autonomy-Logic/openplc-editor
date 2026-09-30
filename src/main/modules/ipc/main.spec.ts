import { nativeTheme } from 'electron'

import MainProcessBridge from './main'

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp') },
  dialog: {},
  nativeTheme: {
    shouldUseDarkColors: false,
    themeSource: 'system',
  },
  shell: { openExternal: jest.fn() },
}))

jest.mock('@root/backend/editor/ethercat', () => ({
  ESIService: jest.fn(),
}))

jest.mock('@root/backend/editor/library-manager/desktop-catalog-transport', () => ({
  createDesktopCatalogTransport: jest.fn(() => ({})),
}))

jest.mock('@root/backend/editor/utils/runtime-https-config', () => ({
  getRuntimeHttpsOptions: jest.fn(() => ({})),
}))

jest.mock('@root/backend/shared/ethercat/esi-parser-main', () => ({
  parseESIDeviceFull: jest.fn(),
}))

jest.mock('@root/backend/shared/library/public-catalog-client', () => ({
  listPublicLibraries: jest.fn(),
}))

jest.mock('../../../backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn(() => ({
    loadEnabledArchives: jest.fn(() => ({ archives: [], missing: [] })),
  })),
}))

jest.mock('../../../backend/editor/package-manager', () => ({
  PackageManagerModule: jest.fn(() => ({})),
}))

jest.mock('../../../backend/editor/services', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}))

jest.mock('../../../backend/editor/utils', () => ({
  getOpenProjectPath: jest.fn(),
  getProjectPath: jest.fn(),
}))

jest.mock('../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => ({ stop: jest.fn() })),
}))

const createBridge = (mainWindow: { isDestroyed: jest.Mock; isMaximized: jest.Mock }, savedTheme?: string) =>
  new MainProcessBridge({
    ipcMain: {},
    mainWindow,
    projectService: {},
    store: { get: jest.fn(() => savedTheme) },
    menuBuilder: {},
    pouService: {},
    compilerModule: {},
    hardwareModule: {},
  } as never)

describe('MainProcessBridge.handleGetSystemInfo', () => {
  beforeEach(() => {
    nativeTheme.themeSource = 'system'
  })

  it('does not read maximized state from a destroyed window', () => {
    const mainWindow = {
      isDestroyed: jest.fn(() => true),
      isMaximized: jest.fn(() => true),
    }
    const bridge = createBridge(mainWindow)

    expect(bridge.handleGetSystemInfo()).toEqual(
      expect.objectContaining({
        isWindowMaximized: false,
      }),
    )
    expect(mainWindow.isDestroyed).toHaveBeenCalledTimes(1)
    expect(mainWindow.isMaximized).not.toHaveBeenCalled()
  })

  it('reads maximized state from a live window', () => {
    const mainWindow = {
      isDestroyed: jest.fn(() => false),
      isMaximized: jest.fn(() => true),
    }
    const bridge = createBridge(mainWindow)

    expect(bridge.handleGetSystemInfo()).toEqual(
      expect.objectContaining({
        isWindowMaximized: true,
      }),
    )
    expect(mainWindow.isDestroyed).toHaveBeenCalledTimes(1)
    expect(mainWindow.isMaximized).toHaveBeenCalledTimes(1)
  })

  it.each(['light', 'dark'] as const)('restores the %s native theme', (savedTheme) => {
    const mainWindow = {
      isDestroyed: jest.fn(() => false),
      isMaximized: jest.fn(() => false),
    }
    const bridge = createBridge(mainWindow, savedTheme)

    bridge.handleGetSystemInfo()

    expect(nativeTheme.themeSource).toBe(savedTheme)
  })

  it.each(['nineties', 'squareteal'] as const)('restores the %s skin on a light native theme', (savedTheme) => {
    const mainWindow = {
      isDestroyed: jest.fn(() => false),
      isMaximized: jest.fn(() => false),
    }
    const bridge = createBridge(mainWindow, savedTheme)

    bridge.handleGetSystemInfo()

    expect(nativeTheme.themeSource).toBe('light')
  })
})
