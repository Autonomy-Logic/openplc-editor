/** @jest-environment node */
import { EventEmitter } from 'events'

const mockApp = Object.assign(new EventEmitter(), {
  isPackaged: false,
  disableHardwareAcceleration: jest.fn(),
  setAppUserModelId: jest.fn(),
  getName: jest.fn(() => 'OpenPLC Editor'),
  whenReady: jest.fn(() => new Promise(() => {})),
  requestSingleInstanceLock: jest.fn(() => true),
})
const mockLoadURL = jest.fn()
const mockResolveHtmlPath = jest.fn(() => 'http://localhost:1313')
const mockWindows: MockWindow[] = []

/** Minimal Electron window used to exercise startup and destruction without a GUI. */
class MockWindow extends EventEmitter {
  destroyed = false
  webContents = { on: jest.fn(), send: jest.fn(), openDevTools: jest.fn(), setWindowOpenHandler: jest.fn() }
  loadURL = mockLoadURL
  loadFile = jest.fn(() => Promise.resolve())
  setIgnoreMouseEvents = jest.fn()
  show = jest.fn()
  maximize = jest.fn()
  minimize = jest.fn()
  getBounds = jest.fn()
  /** Register each created window so tests can distinguish the splash from the editor. */
  constructor() {
    super()
    mockWindows.push(this)
  }
  /** Emit the lifecycle event that clears the application window reference. */
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
  /** Close this test window synchronously. */
  close() {
    this.destroy()
  }
  /** Report whether window operations must stop. */
  isDestroyed() {
    return this.destroyed
  }
}

// Exercise the release-dependent startup path used by the Linux CI runner.
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  release: () => '6.1.0',
}))

jest.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: MockWindow,
  Menu: { setApplicationMenu: jest.fn() },
  ipcMain: {},
  protocol: { registerSchemesAsPrivileged: jest.fn() },
}))
jest.mock('electron-devtools-installer', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('electron-debug', () => ({}))
jest.mock('electron-log', () => ({ transports: { file: {} } }))
jest.mock('../../backend/editor/cli-shim/first-run', () => ({}))
jest.mock('../../backend/editor/compiler', () => ({ CompilerModule: jest.fn() }))
jest.mock('../../backend/editor/package-manager', () => ({ PackageManagerModule: jest.fn() }))
jest.mock('../../backend/editor/edge-edit-sessions', () => ({}))
jest.mock('../../backend/editor/edge-account/edge-account-service', () => ({}))
jest.mock('../../backend/editor/edge-account/oauth-browser-flow', () => ({}))
jest.mock('../../backend/editor/project/cloud-build-workspace', () => ({}))
jest.mock('../modules/vendor-document/serve', () => ({}))
jest.mock('../modules/updater', () => ({ createElectronUpdateService: jest.fn(() => ({ start: jest.fn() })) }))
jest.mock('../../backend/editor/hardware', () => ({ HardwareModule: jest.fn() }))
jest.mock('../../backend/editor/services', () => ({
  UserService: jest.fn(),
  ProjectService: jest.fn(),
  PouService: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('../../backend/editor/utils', () => ({ resolveHtmlPath: mockResolveHtmlPath }))
jest.mock('../menu', () => jest.fn(() => ({ buildMenu: jest.fn() })))
jest.mock('../modules/ipc/main', () => jest.fn(() => ({ setupMainIpcListener: jest.fn() })))
jest.mock('../modules/store', () => ({ store: { get: jest.fn(() => ({})), set: jest.fn() } }))

const originalNodeEnv = process.env.NODE_ENV

beforeEach(async () => {
  jest.resetModules()
  jest.useFakeTimers()
  mockApp.removeAllListeners()
  mockWindows.length = 0
  mockLoadURL.mockReset().mockResolvedValue(undefined)
  mockResolveHtmlPath.mockReset().mockReturnValue('http://localhost:1313')
  process.env.NODE_ENV = 'development'
  await import('../main')
})

afterEach(() => {
  jest.useRealTimers()
  process.env.NODE_ENV = originalNodeEnv
})

it('destroys exhausted windows, closes the splash and allows activation to recover', async () => {
  mockLoadURL.mockRejectedValue(new Error('connection refused'))
  mockApp.emit('activate')
  await jest.runAllTimersAsync()
  expect(mockLoadURL).toHaveBeenCalledTimes(20)
  expect(mockWindows.every((window) => window.destroyed)).toBe(true)
  const main = await import('../main')
  expect(main.mainWindow).toBeNull()
  expect(main.splash).toBeNull()

  mockLoadURL.mockResolvedValue(undefined)
  mockApp.emit('activate')
  await jest.runAllTimersAsync()
  expect(mockWindows).toHaveLength(4)
  expect(mockWindows[3].show).toHaveBeenCalledTimes(1)
})

it('retries URL resolution errors through the same cleanup path', async () => {
  mockResolveHtmlPath.mockImplementation(() => {
    throw new Error('invalid renderer URL')
  })
  mockApp.emit('activate')
  await jest.runAllTimersAsync()
  expect(mockResolveHtmlPath).toHaveBeenCalledTimes(20)
  expect(mockLoadURL).not.toHaveBeenCalled()
  expect(mockWindows.every((window) => window.destroyed)).toBe(true)
})

it('does not reveal or duplicate the window while the renderer is loading', async () => {
  let finishLoad: () => void = () => {}
  mockLoadURL.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishLoad = resolve
      }),
  )
  mockApp.emit('activate')
  await jest.advanceTimersByTimeAsync(0)
  mockApp.emit('activate')
  expect(mockWindows).toHaveLength(2)
  expect(mockWindows[1].show).not.toHaveBeenCalled()
  finishLoad()
  await jest.runAllTimersAsync()
  expect(mockWindows[1].show).toHaveBeenCalledTimes(1)
  expect(mockWindows[0].destroyed).toBe(true)
})

it('stops retrying if the loading window is destroyed', async () => {
  mockLoadURL.mockRejectedValue(new Error('connection refused'))
  mockApp.emit('activate')
  await jest.advanceTimersByTimeAsync(0)
  mockWindows[1].destroy()
  await jest.runAllTimersAsync()
  expect(mockLoadURL).toHaveBeenCalledTimes(1)
})
