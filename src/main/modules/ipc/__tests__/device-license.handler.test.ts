/**
 * The two licensing IPC handlers, over a fake held link.
 *
 * What is worth testing HERE (as opposed to in `license-flow`, which owns the
 * decision logic) is the wiring: that the handlers pick the channel licensing
 * rides for the session — the held CONTROL link on baremetal, the debug
 * WebSocket on a REST-controlled runtime (v4), acquired per call and released
 * afterwards — that a missing link is reported as `check-failed` and never as
 * "not licensed", that the anchor is read fresh, that the compound sequence is
 * guarded, and that device traffic is noted so the liveness poll does not
 * declare a healthy link lost mid-sequence.
 */

import MainProcessBridge from '../main'

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
jest.mock('../../../../backend/editor/utils', () => ({ getOpenProjectPath: jest.fn(), getProjectPath: jest.fn() }))
jest.mock('../../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => ({ stop: jest.fn() })),
}))

jest.mock('../../../../backend/editor/license/license-flow', () => ({
  inspectDeviceLicense: jest.fn(),
  resolveDeviceLicense: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const licenseFlow = require('../../../../backend/editor/license/license-flow') as {
  inspectDeviceLicense: jest.Mock
  resolveDeviceLicense: jest.Mock
}

const REQUEST = { packageId: 'com.openplc.espressif-licensed' }
const ANCHOR = Uint8Array.from([0, 177, 140, 237])

function createBridge() {
  return new MainProcessBridge({
    ipcMain: {},
    mainWindow: { isDestroyed: jest.fn(() => false), isMaximized: jest.fn(() => false) },
    projectService: {},
    store: { get: jest.fn(() => undefined) },
    menuBuilder: {},
    pouService: {},
    compilerModule: {},
    hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
  } as never)
}

/** Install a fake held CONTROL client on the bridge's session manager. */
function holdClient(
  bridge: ReturnType<typeof createBridge>,
  client: { getBoardId: jest.Mock; readLicense?: jest.Mock; writeLicense?: jest.Mock },
) {
  const session = (bridge as unknown as { deviceSession: { getClient: () => unknown; noteTraffic: () => void } })
    .deviceSession
  jest.spyOn(session, 'getClient').mockReturnValue(client)
  return jest.spyOn(session, 'noteTraffic')
}

function boardIdClient(overrides: Partial<{ getBoardId: jest.Mock }> = {}) {
  return {
    getBoardId: jest.fn(() => Promise.resolve({ success: true, boardId: ANCHOR })),
    readLicense: jest.fn(),
    writeLicense: jest.fn(),
    ...overrides,
  }
}

/**
 * Install a fake REST-controlled session (runtime v4): no control client, a REST
 * address, and a debug channel that hands out `client` — or refuses with
 * `acquireError`. Mirrors what `openRestSession` + `acquireDebugChannel` set up.
 */
function holdRestSession(
  bridge: ReturnType<typeof createBridge>,
  client: Record<string, jest.Mock> | null,
  options: { acquireError?: string } = {},
) {
  const session = (
    bridge as unknown as {
      deviceSession: {
        getRestAddress: () => string | null
        acquireDebugChannel: (reason: string) => Promise<unknown>
        releaseDebugChannel: (reason: string) => void
        isConnected: () => boolean
      }
    }
  ).deviceSession
  jest.spyOn(session, 'getRestAddress').mockReturnValue('192.168.0.50')
  jest.spyOn(session, 'isConnected').mockReturnValue(true)
  const acquire = jest.spyOn(session, 'acquireDebugChannel')
  if (options.acquireError) {
    acquire.mockResolvedValue({ error: options.acquireError })
  } else {
    acquire.mockResolvedValue({ client })
  }
  const release = jest.spyOn(session, 'releaseDebugChannel')
  return { acquire, release }
}

beforeEach(() => {
  licenseFlow.inspectDeviceLicense.mockReset()
  licenseFlow.resolveDeviceLicense.mockReset()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('device:read-license', () => {
  it('reads the anchor off the held link and hands it to the inspect flow', async () => {
    const bridge = createBridge()
    const client = boardIdClient()
    const noteTraffic = holdClient(bridge, client)
    licenseFlow.inspectDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'already-stored' },
    })

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(client.getBoardId).toHaveBeenCalledTimes(1)
    expect(licenseFlow.inspectDeviceLicense).toHaveBeenCalledWith(client, { ...REQUEST, anchor: ANCHOR })
    expect(result).toEqual({ deviceId: 'abc', outcome: { state: 'licensed', how: 'already-stored' } })
    // The board-id read is device traffic; not noting it lets the liveness poll
    // fall due behind it and declare a healthy link lost.
    expect(noteTraffic).toHaveBeenCalled()
  })

  it('reports check-failed — never "not licensed" — when no link is held', async () => {
    const bridge = createBridge()
    // No client installed: getClient() returns null.

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome.state).toBe('check-failed')
    expect(licenseFlow.inspectDeviceLicense).not.toHaveBeenCalled()
  })

  it('reports check-failed when the device will not answer the board-id read', async () => {
    const bridge = createBridge()
    const client = boardIdClient({
      getBoardId: jest.fn(() => Promise.resolve({ success: false, error: 'Request timeout' })),
    })
    holdClient(bridge, client)

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'Request timeout' })
    expect(licenseFlow.inspectDeviceLicense).not.toHaveBeenCalled()
  })

  it('passes an empty anchor through rather than inventing one', async () => {
    // A board answering id_len = 0 is a real reply; the flow is the layer that
    // knows it cannot be licensed, and it must get the chance to say so.
    const bridge = createBridge()
    const client = boardIdClient({ getBoardId: jest.fn(() => Promise.resolve({ success: true })) })
    holdClient(bridge, client)
    licenseFlow.inspectDeviceLicense.mockResolvedValue({ outcome: { state: 'check-failed', error: 'no unique id' } })

    await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(licenseFlow.inspectDeviceLicense).toHaveBeenCalledWith(client, {
      ...REQUEST,
      anchor: new Uint8Array(0),
    })
  })

  it('turns an unexpected throw into check-failed instead of rejecting the IPC call', async () => {
    const bridge = createBridge()
    holdClient(bridge, boardIdClient())
    licenseFlow.inspectDeviceLicense.mockRejectedValue(new Error('port closed'))

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'port closed' })
  })
})

describe('device:refresh-license', () => {
  it('runs the full flow over the held link and notes the traffic', async () => {
    const bridge = createBridge()
    const client = boardIdClient()
    const noteTraffic = holdClient(bridge, client)
    licenseFlow.resolveDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'activated' },
    })

    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(licenseFlow.resolveDeviceLicense).toHaveBeenCalledWith(client, { ...REQUEST, anchor: ANCHOR })
    expect(result.outcome).toEqual({ state: 'licensed', how: 'activated' })
    // Once for the anchor read, once after the sequence: the sequence spans an
    // HTTP round trip, which is long enough for the poll to fall due inside it.
    expect(noteTraffic.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('refuses a second concurrent sequence rather than interleaving it', async () => {
    // The frame mutex cannot see a SEQUENCE: two refreshes would each send atomic
    // frames while interleaving a read and a write of the same license, one
    // reading back the other's blob and drawing a conclusion about it.
    const bridge = createBridge()
    holdClient(bridge, boardIdClient())

    let release: (() => void) | undefined
    let entered = false
    licenseFlow.resolveDeviceLicense.mockImplementation(() => {
      entered = true
      return new Promise((resolve) => {
        release = () => resolve({ deviceId: 'abc', outcome: { state: 'licensed', how: 'activated' } })
      })
    })

    const first = bridge.handleDeviceRefreshLicense({} as never, REQUEST)
    // Let the first sequence get past its anchor read and INTO the flow before
    // racing it; asserting on a call that has not been reached yet would test the
    // scheduler rather than the guard.
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 0))

    const second = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(second.outcome).toEqual({
      state: 'check-failed',
      error: 'A license check is already running on this device.',
    })
    expect(licenseFlow.resolveDeviceLicense).toHaveBeenCalledTimes(1)

    release?.()
    await expect(first).resolves.toMatchObject({ outcome: { state: 'licensed' } })
  })

  it('clears the sequence guard after a failure, so a retry is possible', async () => {
    const bridge = createBridge()
    holdClient(bridge, boardIdClient())
    licenseFlow.resolveDeviceLicense.mockRejectedValueOnce(new Error('port closed'))

    const failed = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)
    expect(failed.outcome).toEqual({ state: 'check-failed', error: 'port closed' })

    // A guard left set by a throw would strand the device: every later attempt
    // would answer "already running" with nothing actually running.
    licenseFlow.resolveDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'unlicensed', entitlementChecked: true },
    })
    const retried = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(retried.outcome).toEqual({ state: 'unlicensed', entitlementChecked: true })
  })

  it('reports check-failed when no link is held', async () => {
    const bridge = createBridge()

    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(result.outcome.state).toBe('check-failed')
    expect(licenseFlow.resolveDeviceLicense).not.toHaveBeenCalled()
  })

  it('does not consume the sequence guard when there is no link to run on', async () => {
    const bridge = createBridge()

    await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    // The guard is taken AFTER the channel check, so a disconnected device does
    // not leave it set for the next attempt.
    holdClient(bridge, boardIdClient())
    licenseFlow.resolveDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'activated' },
    })
    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'licensed', how: 'activated' })
  })
})

describe('licensing over a REST-controlled session (runtime v4)', () => {
  it('routes read-license over the debug channel, and releases it afterwards', async () => {
    // A runtime session holds NO control client — control is REST. The license
    // FCs ride the debug WebSocket instead, acquired for the call and released
    // in a finally, like every other per-command debug caller.
    const bridge = createBridge()
    const wsClient = boardIdClient()
    const { acquire, release } = holdRestSession(bridge, wsClient)
    licenseFlow.inspectDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'already-stored' },
    })

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    // The holder key carries a per-call uniqueness suffix (review 2026-08-20,
    // finding 2): concurrent same-named callers must be two references, or the
    // second's release closes the channel under the first.
    expect(acquire).toHaveBeenCalledWith(expect.stringMatching(/^read license#\d+$/))
    // The flow gets the CHANNEL ITSELF, not a wrapper: its frame mutex must keep
    // serialising this traffic with everyone else's.
    expect(licenseFlow.inspectDeviceLicense).toHaveBeenCalledWith(wsClient, { ...REQUEST, anchor: ANCHOR })
    expect(result.outcome).toEqual({ state: 'licensed', how: 'already-stored' })
    expect(release).toHaveBeenCalledWith(expect.stringMatching(/^read license#\d+$/))
  })

  it('routes refresh-license over the debug channel', async () => {
    const bridge = createBridge()
    const wsClient = boardIdClient()
    const { release } = holdRestSession(bridge, wsClient)
    licenseFlow.resolveDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'activated' },
    })

    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(licenseFlow.resolveDeviceLicense).toHaveBeenCalledWith(wsClient, { ...REQUEST, anchor: ANCHOR })
    expect(result.outcome).toEqual({ state: 'licensed', how: 'activated' })
    expect(release).toHaveBeenCalledWith(expect.stringMatching(/^refresh license#\d+$/))
  })

  it('reports check-failed when the debug channel cannot carry the license FCs', async () => {
    // A medium without the license methods (they are optional on the channel
    // contract) must be refused BEFORE anything is asked of it — and still
    // released, or the channel could never close.
    const bridge = createBridge()
    const partial = { getBoardId: jest.fn(), writeLicense: jest.fn() } // no readLicense
    const { release } = holdRestSession(bridge, partial)

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({
      state: 'check-failed',
      error: 'this connection cannot carry the license protocol',
    })
    expect(licenseFlow.inspectDeviceLicense).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith(expect.stringMatching(/^read license#\d+$/))
  })

  it('reports check-failed — never "not licensed" — when the debug channel will not open', async () => {
    const bridge = createBridge()
    holdRestSession(bridge, null, { acquireError: 'the runtime refused the WebSocket' })

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'the runtime refused the WebSocket' })
    expect(licenseFlow.inspectDeviceLicense).not.toHaveBeenCalled()
  })

  it('reports check-failed when the runtime does not answer the anchor read (pre-licensing runtime)', async () => {
    // A runtime that predates the license FCs answers 0x48 with an error. The
    // flow must never run — a device id derived from nothing licenses nobody.
    const bridge = createBridge()
    const wsClient = boardIdClient({
      getBoardId: jest.fn(() => Promise.resolve({ success: false, error: 'Unknown function code' })),
    })
    holdRestSession(bridge, wsClient)

    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'Unknown function code' })
    expect(licenseFlow.resolveDeviceLicense).not.toHaveBeenCalled()
  })
})
