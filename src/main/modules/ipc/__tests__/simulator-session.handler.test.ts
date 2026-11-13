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

const simulatorModule = {
  loadAndRun: jest.fn<Promise<void>, [Uint8Array]>(),
  stop: jest.fn(),
  isRunning: jest.fn(() => true),
  preparePython: jest.fn<Promise<void>, [number]>(() => Promise.resolve()),
  onStopped: null,
  onLog: null,
}
jest.mock('../../../../backend/editor/simulator/desktop-simulator', () => ({
  createDesktopSimulator: jest.fn(() => simulatorModule),
}))

// The handler reads the module off disk before it starts anything. Stubbing the read
// to succeed lets a test fail the start itself.
const readFile = jest.fn<Promise<Uint8Array>, [string]>()
jest.mock('fs/promises', () => ({ readFile: (...args: [string]) => readFile(...args) }))

type Bridge = MainProcessBridge

function createBridge(send: jest.Mock = jest.fn()): Bridge {
  return new MainProcessBridge({
    ipcMain: {},
    mainWindow: {
      isDestroyed: jest.fn(() => false),
      isMaximized: jest.fn(() => false),
      webContents: { reload: jest.fn(), send, on: jest.fn() },
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
  readFile.mockReset().mockResolvedValue(new Uint8Array([0, 97, 115, 109]))
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
  it('stops the simulator and closes the session when the module does not start', async () => {
    const bridge = createBridge()
    const close = holdLink(bridge, 'simulator')
    simulatorModule.loadAndRun.mockRejectedValue(new Error('The simulator module does not export sim_loop.'))

    const result = await bridge.handleSimulatorLoadFirmware({} as never, '/tmp/simulator.wasm')

    expect(readFile).toHaveBeenCalledTimes(1)
    expect(simulatorModule.loadAndRun).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: false, error: 'The simulator module does not export sim_loop.' })
    expect(simulatorModule.stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('stops the emulator and closes the session when the read fails before it starts', async () => {
    const bridge = createBridge()
    const close = holdLink(bridge, 'simulator')
    readFile.mockRejectedValue(new Error('ENOENT'))

    const result = await bridge.handleSimulatorLoadFirmware({} as never, '/nonexistent/simulator.wasm')

    // Nothing was started, so there is nothing to leak — but the cleanup still
    // has to be harmless, because the catch cannot tell the two apart.
    expect(simulatorModule.loadAndRun).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(simulatorModule.stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('simulator:prepare-python', () => {
  it('prepares the interpreters the renderer asks for, and ignores a count that is not one', async () => {
    const bridge = createBridge()
    simulatorModule.preparePython.mockClear()

    await bridge.handleSimulatorPreparePython({} as never, 2)
    await bridge.handleSimulatorPreparePython({} as never, -1)
    await bridge.handleSimulatorPreparePython({} as never, '3')

    expect(simulatorModule.preparePython.mock.calls).toEqual([[2]])
  })
})

describe('simulator output', () => {
  it('forwards the run output to the window', () => {
    const send = jest.fn()
    createBridge(send)
    const onLog: unknown = Reflect.get(simulatorModule, 'onLog')
    if (typeof onLog !== 'function') throw new Error('the simulator has no onLog')
    onLog('[Block] hi', 'stdout')
    expect(send).toHaveBeenCalledWith('simulator:log', '[Block] hi', 'stdout')
  })
})
