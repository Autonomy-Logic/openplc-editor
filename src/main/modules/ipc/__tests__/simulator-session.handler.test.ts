/**
 * The simulator's session lifecycle, in the main process.
 *
 * What is worth testing HERE is the ownership rule rather than the emulator
 * itself: starting the emulator opens this target's session and stopping it
 * closes it, every stop path routes through the one choke point, and the order
 * is session-then-emulator so the debug client is dropped before the thing it
 * talks to disappears.
 *
 * The paths that used to leak — a window reload and a start that threw — are the
 * reason this file exists: both left a running emulator behind, and the reload
 * also left main holding a session the reloaded renderer knew nothing about.
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

const simulatorModule = { loadAndRun: jest.fn(), stop: jest.fn(), isRunning: jest.fn(() => true) }
jest.mock('../../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => simulatorModule),
}))

type Bridge = MainProcessBridge

function createBridge(): Bridge {
  return new MainProcessBridge({
    ipcMain: {},
    mainWindow: {
      isDestroyed: jest.fn(() => false),
      isMaximized: jest.fn(() => false),
      webContents: { reload: jest.fn(), send: jest.fn() },
    },
    projectService: {},
    store: { get: jest.fn(() => undefined) },
    menuBuilder: {},
    pouService: {},
    compilerModule: {},
    hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
  } as never)
}

/**
 * Pretend the session manager holds a link of the given transport, and record
 * whether it is closed. Returns the recorder for the closing side.
 */
function holdLink(bridge: Bridge, transport: 'simulator' | 'serial') {
  const session = (bridge as unknown as { deviceSession: { getLink: () => unknown; close: () => void } }).deviceSession
  jest.spyOn(session, 'getLink').mockReturnValue({ transport })
  return jest.spyOn(session, 'close').mockImplementation(() => undefined)
}

beforeEach(() => {
  simulatorModule.loadAndRun.mockReset()
  simulatorModule.stop.mockReset()
  simulatorModule.isRunning.mockReset().mockReturnValue(true)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('simulator:stop', () => {
  it('closes the session and stops the emulator', async () => {
    const bridge = createBridge()
    const close = holdLink(bridge, 'simulator')

    await expect(bridge.handleSimulatorStop({} as never)).resolves.toEqual({ success: true })

    expect(close).toHaveBeenCalledTimes(1)
    expect(simulatorModule.stop).toHaveBeenCalledTimes(1)
  })

  it('closes the session BEFORE stopping the emulator', async () => {
    const bridge = createBridge()
    const order: string[] = []
    const session = (bridge as unknown as { deviceSession: { getLink: () => unknown; close: () => void } })
      .deviceSession
    jest.spyOn(session, 'getLink').mockReturnValue({ transport: 'simulator' })
    jest.spyOn(session, 'close').mockImplementation(() => {
      order.push('session-closed')
    })
    simulatorModule.stop.mockImplementation(() => order.push('emulator-stopped'))

    await bridge.handleSimulatorStop({} as never)

    expect(order).toEqual(['session-closed', 'emulator-stopped'])
  })

  it('leaves a non-simulator session alone', async () => {
    const bridge = createBridge()
    const close = holdLink(bridge, 'serial')

    await bridge.handleSimulatorStop({} as never)

    // A cabled board's link is not the emulator's to close, but the emulator
    // still stops.
    expect(close).not.toHaveBeenCalled()
    expect(simulatorModule.stop).toHaveBeenCalledTimes(1)
  })
})

describe('window:reload', () => {
  it('takes the session down with the emulator', () => {
    const bridge = createBridge()
    const close = holdLink(bridge, 'simulator')

    bridge.handleWindowReload()

    // The reload resets the renderer's store to 'disconnected'; a session left
    // open here would be one only the main process still believes in.
    expect(close).toHaveBeenCalledTimes(1)
    expect(simulatorModule.stop).toHaveBeenCalledTimes(1)
  })
})

describe('simulator:load-firmware', () => {
  it('stops the emulator and closes the session when the start throws', async () => {
    const bridge = createBridge()
    const close = holdLink(bridge, 'simulator')

    // An unreadable hex path fails inside the handler's try, standing in for any
    // throw during start — `loadAndRun` marks the emulator running before it
    // finishes wiring, so a throw after that point used to leak one.
    const result = await bridge.handleSimulatorLoadFirmware({} as never, '/nonexistent/simulator.hex')

    expect(result.success).toBe(false)
    expect(simulatorModule.stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
