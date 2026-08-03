/**
 * The on-demand licensing IPC handlers: `device:read-board-id`,
 * `device:read-license`, `device:refresh-license`.
 *
 * WHAT IS BEING PINNED. These three exist so the licensing function codes can be
 * called at ANY point while a device is connected. Before them the FCs were
 * reachable only at connect time, or over a transient transport that opened its
 * own port -- which on a serial target could not even open, because the held
 * connection already owned it.
 *
 * So the assertions that matter are: they operate over the HELD client (never
 * building a new transport), they refuse cleanly when nothing is held, and the
 * compound sequence refuses to run twice at once. The held state is established
 * through the real `device:connect` handler rather than by reaching into a private
 * field, so the wiring is part of what is tested.
 *
 * Lives under `__tests__` for the reason recorded in
 * `activate-device-license.handler.test.ts`: on Windows jest collects no
 * `*.spec.ts` file at all, so a test written as a spec here cannot be run on the
 * machine writing it.
 */
jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp') },
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
jest.mock('../../../../backend/editor/utils', () => ({
  getOpenProjectPath: jest.fn(),
  getProjectPath: jest.fn(),
  getPlcopenExportSavePath: jest.fn(),
  getPlcopenImportFilePath: jest.fn(),
}))
jest.mock('../../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => ({ stop: jest.fn() })),
}))

// `probeAndRecover` and the board-id read are stubbed so this file asserts what
// the HANDLERS do -- use the held client, refuse when there is none, serialize the
// compound sequence. Their own behaviour has its own tests, and re-testing it
// through here would only hide which layer broke. `verifyStoredLicenseBlob` is
// deliberately NOT stubbed: it is the real function, so "present but wrong blob"
// below is judged by the code that judges it in production.
const mockBuildLicenseTransport = jest.fn()
const mockConnectWithRetries = jest.fn()
const mockProbeAndRecover = jest.fn()
const mockReadBoardIdWithRetries = jest.fn()

jest.mock('../../../../backend/editor/license/license-transport-factory', () => ({
  buildLicenseTransport: (...args: unknown[]) => mockBuildLicenseTransport(...args),
}))
jest.mock('../../../../backend/editor/license/license-probe', () => ({
  connectWithRetries: (...args: unknown[]) => mockConnectWithRetries(...args),
  readBoardIdWithRetries: (...args: unknown[]) => mockReadBoardIdWithRetries(...args),
}))
jest.mock('../../../../backend/editor/license/device-connect', () => {
  const real = jest.requireActual('../../../../backend/editor/license/device-connect') as Record<string, unknown>
  return { ...real, probeAndRecover: (...args: unknown[]) => mockProbeAndRecover(...args) }
})

import type { IpcMainInvokeEvent } from 'electron'

import MainProcessBridge from '../main'

/** The ESP8266 anchor measured on the bench: esptool MAC 5c:cf:7f:b1:8c:ed, whose
 *  low three bytes are the chip id, laid out by ArduinoUniqueID as 4 big-endian
 *  bytes. */
const ANCHOR = [0x00, 0xb1, 0x8c, 0xed]
/**
 * `sha256("openplc-dev-v1|" || ANCHOR)[:16]`, computed independently rather than
 * by calling the code under test -- otherwise this asserts nothing about the value
 * the renderer is handed.
 *
 * The DOMAIN matters and cost a wrong first draft here: `7b3ea3f4c33fe6f1af31...`
 * is the same anchor under `openplc-dev-v3|`, from a redesign that was discarded.
 * This branch derives under v1, and mixing the two silently binds a licence to an
 * id the hardware never presents.
 */
const DEVICE_ID = '659a3520540f803625ddc34081e893d3'
const RTU_PARAMS = { connectionType: 'rtu' as const, port: 'COM5' }
const EVENT = {} as IpcMainInvokeEvent

type BridgeDeps = ConstructorParameters<typeof MainProcessBridge>[0]

function makeBridge(): MainProcessBridge {
  const deps = { ipcMain: {}, mainWindow: { webContents: { send: jest.fn() } } }
  return new MainProcessBridge(deps as unknown as BridgeDeps)
}

/** A bridge with a held client, established through the real connect handler. */
async function connectedBridge(clientOver: Record<string, unknown> = {}) {
  const client = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    getBoardId: jest.fn(),
    readLicense: jest.fn(async () => ({ success: true, status: 0x83, empty: true })),
    writeLicense: jest.fn(async () => ({ success: true })),
    ...clientOver,
  }
  mockBuildLicenseTransport.mockReturnValue({ client })
  mockConnectWithRetries.mockResolvedValue(undefined)
  mockProbeAndRecover.mockResolvedValue({ status: 'connected-with-firmware', deviceId: DEVICE_ID })

  const bridge = makeBridge()
  const result = await bridge.handleDeviceConnect(EVENT, RTU_PARAMS, { isLicensable: true })
  expect(result.status).toBe('connected-with-firmware')
  return { bridge, client }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockReadBoardIdWithRetries.mockResolvedValue({ success: true, anchor: ANCHOR, anchorHex: '00b18ced' })
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('on-demand licensing handlers with nothing connected', () => {
  it('read-board-id refuses with a message naming Connect, not a crash', async () => {
    const res = await makeBridge().handleDeviceReadBoardId()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Connect/)
  })

  it('read-license refuses with a message naming Connect, not a crash', async () => {
    const res = await makeBridge().handleDeviceReadLicense(EVENT, {})
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Connect/)
  })

  it('refresh-license refuses with an error STATUS, matching the connect result shape', async () => {
    // Not `{ success: false }`: this handler returns a DeviceConnectResult and the
    // renderer switches on `status`. The wrong shape here lands a result the badge
    // cannot read.
    const res = await makeBridge().handleDeviceRefreshLicense(EVENT, {})
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/Connect/)
  })
})

describe('handleDeviceReadBoardId', () => {
  it('returns the raw anchor AND the derived deviceId', async () => {
    const { bridge } = await connectedBridge()

    const res = await bridge.handleDeviceReadBoardId()

    // Both, because they are different values: the anchor is the silicon serial,
    // the deviceId is what a licence binds to. The id here is the MEASURED
    // constant, not something re-derived by the code under test.
    expect(res).toEqual({ success: true, anchorHex: '00b18ced', deviceId: DEVICE_ID })
  })

  it('reports a board that does not answer instead of inventing an id', async () => {
    const { bridge } = await connectedBridge()
    mockReadBoardIdWithRetries.mockResolvedValue({ success: false, error: 'no reply' })

    const res = await bridge.handleDeviceReadBoardId()

    expect(res.success).toBe(false)
    expect(res.deviceId).toBeUndefined()
  })

  // An anchorless board answers 0x48 "successfully" with zero bytes on some
  // targets. Deriving from nothing gives every such board the SAME id, which one
  // signed blob would then unlock across the whole population (#42b).
  it('treats a zero-length anchor as a failure, not as an empty id', async () => {
    const { bridge } = await connectedBridge()
    mockReadBoardIdWithRetries.mockResolvedValue({ success: true, anchor: [], anchorHex: '' })

    const res = await bridge.handleDeviceReadBoardId()

    expect(res.success).toBe(false)
    expect(res.deviceId).toBeUndefined()
  })
})

describe('handleDeviceReadLicense', () => {
  it('reports unsupported when the target has no on-device storage', async () => {
    const { bridge } = await connectedBridge({
      readLicense: jest.fn(async () => ({ success: true, status: 0x85, unsupported: true })),
    })

    const res = await bridge.handleDeviceReadLicense(EVENT, {})

    expect(res).toMatchObject({ success: true, licenseStatus: 'unsupported', deviceId: DEVICE_ID })
  })

  it('reports unlicensed when nothing is stored', async () => {
    const { bridge } = await connectedBridge()

    const res = await bridge.handleDeviceReadLicense(EVENT, {})

    expect(res).toMatchObject({ success: true, licenseStatus: 'unlicensed' })
  })

  // The whole reason this is not a status-byte read: 0x7E means only "the device
  // had something to give us". A blob cloned from another board answers 0x7E, and
  // believing that byte is how the badge said "Licensed" while the board ran demo.
  it('refuses to call a present-but-wrong blob licensed, and says why', async () => {
    const { bridge } = await connectedBridge({
      readLicense: jest.fn(async () => ({ success: true, status: 0x7e, blob: new Uint8Array(98) })),
    })

    const res = await bridge.handleDeviceReadLicense(EVENT, {})

    expect(res.licenseStatus).toBe('unlicensed')
    expect(res.reason).toBeDefined()
  })
})

describe('handleDeviceRefreshLicense', () => {
  it('runs probeAndRecover over the HELD client, without building a new transport', async () => {
    const { bridge, client } = await connectedBridge()
    mockBuildLicenseTransport.mockClear()
    mockProbeAndRecover.mockResolvedValue({ status: 'connected-with-firmware', activation: 'activated' })

    const res = await bridge.handleDeviceRefreshLicense(EVENT, { isLicensable: true, packageId: 'com.v.b' })

    expect(res).toMatchObject({ activation: 'activated' })
    expect(mockProbeAndRecover).toHaveBeenCalledWith(client, { isLicensable: true, packageId: 'com.v.b' })
    // The point of the change: no second port open. A transient transport could
    // not have opened COM5 anyway -- the held connection owns it.
    expect(mockBuildLicenseTransport).not.toHaveBeenCalled()
  })

  // The transport serializes individual FRAMES, not sequences. Two concurrent
  // recovers would each see atomic frames while reading and writing one licence
  // out of order, so the second is refused rather than queued.
  it('refuses a second run while the first sequence is still in flight', async () => {
    const { bridge } = await connectedBridge()
    let release: (value: { status: string; activation: string }) => void = () => undefined
    mockProbeAndRecover.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const first = bridge.handleDeviceRefreshLicense(EVENT, {})
    const second = await bridge.handleDeviceRefreshLicense(EVENT, {})

    expect(second.status).toBe('error')
    expect(second.error).toMatch(/already running/)

    release({ status: 'connected-with-firmware', activation: 'demo' })
    await expect(first).resolves.toMatchObject({ activation: 'demo' })
  })

  it('clears the in-flight flag after a rejection, so the next run is not blocked forever', async () => {
    const { bridge } = await connectedBridge()
    mockProbeAndRecover.mockRejectedValueOnce(new Error('serial died'))

    await expect(bridge.handleDeviceRefreshLicense(EVENT, {})).rejects.toThrow('serial died')

    mockProbeAndRecover.mockResolvedValue({ status: 'connected-with-firmware', activation: 'demo' })
    await expect(bridge.handleDeviceRefreshLicense(EVENT, {})).resolves.toMatchObject({ activation: 'demo' })
  })
})
