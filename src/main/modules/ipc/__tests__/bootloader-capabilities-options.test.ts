import { BrowserWindow, ipcMain } from 'electron'

import type {
  BootloaderApiResult,
  BootloaderCapabilities,
} from '../../../../backend/editor/runtime/bootloader-api-client'
import { BootloaderApiClient } from '../../../../backend/editor/runtime/bootloader-api-client'
import { CompilerModule } from '../../../../backend/editor/compiler'
import { HardwareModule } from '../../../../backend/editor/hardware'
import { PouService, ProjectService } from '../../../../backend/editor/services'
import MenuBuilder from '../../../menu'
import MainProcessBridge from '../main'

type IpcListener = (...args: unknown[]) => unknown

const mockHandlers = new Map<string, IpcListener>()

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp') },
  dialog: {},
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  shell: { openExternal: jest.fn() },
  BrowserWindow: jest.fn(),
  ipcMain: {
    handle: (channel: string, listener: IpcListener) => mockHandlers.set(channel, listener),
    removeHandler: (channel: string) => mockHandlers.delete(channel),
    on: jest.fn(),
  },
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
  PouService: jest.fn(),
  ProjectService: jest.fn(),
}))
jest.mock('../../../../backend/editor/compiler', () => ({ CompilerModule: jest.fn() }))
jest.mock('../../../../backend/editor/hardware', () => ({ HardwareModule: jest.fn() }))
jest.mock('../../../menu', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../store', () => ({ store: { get: jest.fn(), set: jest.fn(), delete: jest.fn() } }))
jest.mock('../../../../backend/editor/utils', () => ({ getOpenProjectPath: jest.fn(), getProjectPath: jest.fn() }))
jest.mock('../../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => ({ stop: jest.fn() })),
}))

const CHANNEL = 'bootloader:get-capabilities'
const IP = '192.168.1.50'
const NO_BOOTLOADER: BootloaderApiResult<BootloaderCapabilities> = {
  success: false,
  error: 'No response from the bootloader',
}

const bridge = new MainProcessBridge({
  ipcMain,
  mainWindow: null,
  projectService: new ProjectService(),
  pouService: new PouService(),
  store: {
    last_projects: [],
    theme: 'light',
    window: { bounds: { width: 0, height: 0, x: 0, y: 0 } },
    auto_update_check: false,
  },
  menuBuilder: new MenuBuilder(new BrowserWindow()),
  compilerModule: new CompilerModule(),
  hardwareModule: new HardwareModule(),
  quitCoordinator: {
    handleBeforeQuit: jest.fn(),
    handleWindowClose: jest.fn(),
    requestQuit: jest.fn(),
    confirmQuit: jest.fn(),
  },
})
bridge.setupMainIpcListener()

const getCapabilities = jest.spyOn(BootloaderApiClient.prototype, 'getCapabilities')

function invokeHandler(...args: unknown[]): unknown {
  const listener = mockHandlers.get(CHANNEL)
  if (listener === undefined) throw new Error(`No handler registered for ${CHANNEL}`)
  return listener({}, ...args)
}

function forwardedAddress(): unknown {
  return getCapabilities.mock.calls.at(-1)?.at(0)
}

function forwardedTimeoutMs(): unknown {
  const options: unknown = getCapabilities.mock.calls.at(-1)?.at(1)
  if (typeof options !== 'object' || options === null || !('timeoutMs' in options)) return undefined
  return options.timeoutMs
}

beforeEach(() => {
  getCapabilities.mockReset()
  getCapabilities.mockResolvedValue(NO_BOOTLOADER)
})

afterAll(() => {
  getCapabilities.mockRestore()
})

describe('the bootloader:get-capabilities main handler', () => {
  it.each([500, 2500, 8000])('passes a timeout of %p ms on to the bootloader client', async (timeoutMs) => {
    await invokeHandler(IP, { timeoutMs })

    expect(forwardedAddress()).toBe(IP)
    expect(forwardedTimeoutMs()).toBe(timeoutMs)
  })

  it('returns what the bootloader client returns', async () => {
    await expect(invokeHandler(IP, { timeoutMs: 2500 })).resolves.toEqual(NO_BOOTLOADER)
  })

  it.each([
    ['no options', undefined],
    ['null', null],
    ['a bare number', 2500],
    ['a string', '2500'],
    ['an array', [2500]],
    ['an object without timeoutMs', {}],
    ['a string timeout', { timeoutMs: '2500' }],
    ['a fractional timeout', { timeoutMs: 2500.5 }],
    ['NaN', { timeoutMs: Number.NaN }],
    ['Infinity', { timeoutMs: Number.POSITIVE_INFINITY }],
    ['a timeout below 500', { timeoutMs: 499 }],
    ['a timeout of 100', { timeoutMs: 100 }],
    ['a timeout above 8000', { timeoutMs: 8001 }],
    ['a timeout of 9000', { timeoutMs: 9000 }],
  ])('ignores %s and leaves the default timeout', async (_label, options) => {
    await invokeHandler(IP, options)

    expect(forwardedAddress()).toBe(IP)
    expect(forwardedTimeoutMs()).toBeUndefined()
  })
})
