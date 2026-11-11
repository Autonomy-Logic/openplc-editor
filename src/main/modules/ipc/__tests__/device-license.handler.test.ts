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

import { serializeLicenseBlob } from '../../../../backend/shared/debug/license-blob'
import { deriveDeviceId } from '../../../../backend/shared/license/device-identity'
import MainProcessBridge from '../main'

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp') },
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
jest.mock('../../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => ({ stop: jest.fn() })),
}))

jest.mock('../../../../backend/shared/license/license-flow', () => {
  const actual = jest.requireActual<typeof import('../../../../backend/shared/license/license-flow')>(
    '../../../../backend/shared/license/license-flow',
  )
  return {
    ...actual,
    inspectDeviceLicense: jest.fn(),
    resolveDeviceLicense: jest.fn(),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const licenseFlow = require('../../../../backend/shared/license/license-flow') as {
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
  client: { getDeviceId: jest.Mock; readLicense?: jest.Mock; writeLicense?: jest.Mock },
) {
  const session = (bridge as unknown as { deviceSession: { getClient: () => unknown; noteTraffic: () => void } })
    .deviceSession
  jest.spyOn(session, 'getClient').mockReturnValue(client)
  return jest.spyOn(session, 'noteTraffic')
}

/** Baremetal: the board reports its raw ID sources. */
function deviceIdClient(overrides: Partial<{ getDeviceId: jest.Mock }> = {}) {
  return {
    getDeviceId: jest.fn(() => Promise.resolve({ success: true, sources: [{ kind: 'hardware', bytes: ANCHOR }] })),
    readLicense: jest.fn(),
    writeLicense: jest.fn(),
    ...overrides,
  }
}

/**
 * runtime-v4 half: `getAnchor` and NO `getDeviceId`, which is what the
 * WebSocket transport actually looks like.
 *
 * This double is the thing that keeps runtime-v4 licensing alive. When the REST
 * block used `deviceIdClient()`, it exercised the baremetal branch under a
 * runtime-v4 name, and `isLicenseChannel` could go on demanding `getDeviceId` —
 * refusing every real WebSocket channel — with every test green.
 */
function anchorClient(overrides: Partial<{ getAnchor: jest.Mock }> = {}) {
  return {
    getAnchor: jest.fn(() => Promise.resolve({ success: true, anchor: ANCHOR })),
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
    const client = deviceIdClient()
    const noteTraffic = holdClient(bridge, client)
    licenseFlow.inspectDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'already-stored' },
    })

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(client.getDeviceId).toHaveBeenCalledTimes(1)
    expect(licenseFlow.inspectDeviceLicense).toHaveBeenCalledWith(client, {
      ...REQUEST,
      identity: { kind: 'anchor', anchor: ANCHOR },
    })
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

  it('reports check-failed when the device will not answer the identity read', async () => {
    const bridge = createBridge()
    const client = deviceIdClient({
      getDeviceId: jest.fn(() => Promise.resolve({ success: false, error: 'Request timeout' })),
    })
    holdClient(bridge, client)

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'Request timeout' })
    expect(licenseFlow.inspectDeviceLicense).not.toHaveBeenCalled()
  })

  it('passes an empty identity through rather than inventing one', async () => {
    // A board answering count 0 is a real reply; the flow is the layer that
    // knows it cannot be licensed, and it must get the chance to say so.
    const bridge = createBridge()
    const client = deviceIdClient({ getDeviceId: jest.fn(() => Promise.resolve({ success: true })) })
    holdClient(bridge, client)
    licenseFlow.inspectDeviceLicense.mockResolvedValue({ outcome: { state: 'check-failed', error: 'no unique id' } })

    await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(licenseFlow.inspectDeviceLicense).toHaveBeenCalledWith(client, {
      ...REQUEST,
      identity: { kind: 'anchor', anchor: new Uint8Array(0) },
    })
  })

  it('turns an unexpected throw into check-failed instead of rejecting the IPC call', async () => {
    const bridge = createBridge()
    holdClient(bridge, deviceIdClient())
    licenseFlow.inspectDeviceLicense.mockRejectedValue(new Error('port closed'))

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'port closed' })
  })
})

describe('device:refresh-license', () => {
  it('runs the full flow over the held link and notes the traffic', async () => {
    const bridge = createBridge()
    const client = deviceIdClient()
    const noteTraffic = holdClient(bridge, client)
    licenseFlow.resolveDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'activated' },
    })

    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(licenseFlow.resolveDeviceLicense).toHaveBeenCalledWith(
      client,
      { ...REQUEST, identity: { kind: 'anchor', anchor: ANCHOR } },
      expect.any(Function),
    )
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
    holdClient(bridge, deviceIdClient())

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
    holdClient(bridge, deviceIdClient())
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
    holdClient(bridge, deviceIdClient())
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
    const wsClient = anchorClient()
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
    expect(licenseFlow.inspectDeviceLicense).toHaveBeenCalledWith(wsClient, {
      ...REQUEST,
      // The runtime's raw serial reaches the flow as an anchor to derive from.
      identity: { kind: 'anchor', anchor: ANCHOR },
    })
    expect(result.outcome).toEqual({ state: 'licensed', how: 'already-stored' })
    expect(release).toHaveBeenCalledWith(expect.stringMatching(/^read license#\d+$/))
  })

  it('routes refresh-license over the debug channel', async () => {
    const bridge = createBridge()
    const wsClient = anchorClient()
    const { release } = holdRestSession(bridge, wsClient)
    licenseFlow.resolveDeviceLicense.mockResolvedValue({
      deviceId: 'abc',
      outcome: { state: 'licensed', how: 'activated' },
    })

    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(licenseFlow.resolveDeviceLicense).toHaveBeenCalledWith(
      wsClient,
      { ...REQUEST, identity: { kind: 'anchor', anchor: ANCHOR } },
      expect.any(Function),
    )
    expect(result.outcome).toEqual({ state: 'licensed', how: 'activated' })
    expect(release).toHaveBeenCalledWith(expect.stringMatching(/^refresh license#\d+$/))
  })

  it('reports check-failed when the debug channel cannot carry the license FCs', async () => {
    // A medium without the license methods (they are optional on the channel
    // contract) must be refused BEFORE anything is asked of it — and still
    // released, or the channel could never close.
    const bridge = createBridge()
    const partial = { getAnchor: jest.fn(), writeLicense: jest.fn() } // no readLicense
    const { release } = holdRestSession(bridge, partial)

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({
      state: 'check-failed',
      error: 'This connection cannot carry the licensing protocol.',
      // Permanent for this kind of session, so the UI must not offer a retry.
      retryable: false,
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

  it('maps an anchor-less target (0x85 on 0x48) to a terminal, non-retryable check-failed', async () => {
    // The target itself said "no hardware anchor to license against" — a
    // property of the device, not a transient failure, so no retry nag.
    //
    // It is NOT the 'unsupported' outcome, which means "this firmware has no
    // licence STORAGE" and whose entire message is "this hardware supports it,
    // rebuild and upload". Routing an identity-less host there told the user
    // their x86 box would work if they rebuilt — false, and unactionable.
    const bridge = createBridge()
    const wsClient = anchorClient({
      getAnchor: jest.fn(() => Promise.resolve({ success: false, unsupported: true, error: 'LIC_UNSUPPORTED' })),
    })
    holdRestSession(bridge, wsClient)

    const result = await bridge.handleDeviceReadLicense({} as never, REQUEST)

    expect(result.outcome.state).toBe('check-failed')
    if (result.outcome.state === 'check-failed') {
      expect(result.outcome.retryable).toBe(false)
      expect(result.outcome.error).toMatch(/no hardware identity a license can be issued for/)
      // The storage wording must not follow this condition anywhere.
      expect(result.outcome.error).not.toMatch(/storage|rebuild/i)
    }
    expect(licenseFlow.inspectDeviceLicense).not.toHaveBeenCalled()
  })

  it('reports check-failed when the runtime does not answer the anchor read (pre-licensing runtime)', async () => {
    // A runtime that predates the license FCs answers 0x48 with an error. The
    // flow must never run — a device id derived from nothing licenses nobody.
    const bridge = createBridge()
    const wsClient = anchorClient({
      getAnchor: jest.fn(() => Promise.resolve({ success: false, error: 'Unknown function code' })),
    })
    holdRestSession(bridge, wsClient)

    const result = await bridge.handleDeviceRefreshLicense({} as never, REQUEST)

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'Unknown function code' })
    expect(licenseFlow.resolveDeviceLicense).not.toHaveBeenCalled()
  })
})

describe('licence backup across an upload (baremetal)', () => {
  const PORT = '/dev/cu.usbmodem1'
  const GENERATED = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i)
  let BLOB: Uint8Array

  beforeAll(async () => {
    BLOB = serializeLicenseBlob({
      magic: 0,
      fmtVersion: 1,
      keyId: 7,
      deviceId: Uint8Array.from(Buffer.from(await deriveDeviceId(GENERATED), 'hex')),
      productId: new Uint8Array(8).fill(0x33),
      signature: new Uint8Array(64).fill(0x55),
      crc32: 0,
    })
  })

  function holdLink(bridge: ReturnType<typeof createBridge>, link: { transport: string; descriptor: string } | null) {
    const session = (
      bridge as unknown as {
        deviceSession: { getLink: () => unknown; releaseSerialPort: (port: string | null | undefined) => boolean }
      }
    ).deviceSession
    jest.spyOn(session, 'getLink').mockReturnValue(link)
    jest.spyOn(session, 'releaseSerialPort').mockReturnValue(true)
  }

  /** Run a build whose compile flow ends with `success` on its port. */
  async function build(bridge: ReturnType<typeof createBridge>, success: boolean) {
    const port = { postMessage: jest.fn(), close: jest.fn(), start: jest.fn() }
    ;(bridge as unknown as { compilerModule: unknown }).compilerModule = {
      compileProgram: (_args: unknown, channel: { postMessage: (message: unknown) => void }) => {
        channel.postMessage({ logLevel: 'info', message: 'done' })
        channel.postMessage({ closePort: true, success })
        return Promise.resolve()
      },
    }
    bridge.handleRunCompileProgram({ ports: [port] } as never, [] as never)
    await Promise.resolve()
    expect(port.postMessage).toHaveBeenLastCalledWith({ closePort: true, success }, undefined)
  }

  /** The renderer's reconnect after the upload; no candidates, so only the entry bookkeeping runs. */
  async function connect(bridge: ReturnType<typeof createBridge>) {
    await bridge.handleDeviceConnect({} as never, [])
  }

  /** The board before the upload: generated ID and a licence bound to it. */
  function licensedBoard() {
    return {
      getDeviceId: jest.fn(() =>
        Promise.resolve({ success: true, sources: [{ kind: 'generated', bytes: GENERATED }] }),
      ),
      readLicense: jest.fn(() => Promise.resolve({ success: true, status: 0x7e, blob: BLOB })),
      writeLicense: jest.fn(),
    }
  }

  /** The board after an upload that erased everything; it stores whatever ID it is given. */
  function wipedBoard() {
    let id: Uint8Array | null = null
    return {
      getDeviceId: jest.fn(() =>
        Promise.resolve({ success: true, sources: id ? [{ kind: 'generated', bytes: id }] : [] }),
      ),
      provisionBoardId: jest.fn((next: Uint8Array) => {
        id = next
        return Promise.resolve({ success: true, status: 0x7e })
      }),
      readLicense: jest.fn(() => Promise.resolve({ success: true, status: 0x83, empty: true })),
      writeLicense: jest.fn(() => Promise.resolve({ success: true, status: 0x7e })),
    }
  }

  /** Release the port holding a licensed board, as the build does before an upload. */
  async function release(bridge: ReturnType<typeof createBridge>) {
    holdLink(bridge, { transport: 'rtu', descriptor: PORT })
    holdClient(bridge, licensedBoard())
    expect(await bridge.handleDeviceReleaseSerialPort({} as never, PORT)).toEqual({ released: true })
  }

  /** Refresh on a wiped board on the held link; returns the board. */
  async function refreshWiped(bridge: ReturnType<typeof createBridge>) {
    const board = wipedBoard()
    holdClient(bridge, board)
    await bridge.handleDeviceRefreshLicense({} as never, REQUEST)
    return board
  }

  function expectFreshId(board: ReturnType<typeof wipedBoard>) {
    expect(board.provisionBoardId).toHaveBeenCalledTimes(1)
    expect(board.provisionBoardId.mock.calls[0][0]).not.toEqual(GENERATED)
    expect(board.writeLicense).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    licenseFlow.resolveDeviceLicense.mockResolvedValue({ outcome: { state: 'licensed', how: 'already-stored' } })
  })

  it('writes the same board ID and licence back on the reconnect after a successful upload, once', async () => {
    const bridge = createBridge()
    await release(bridge)
    await build(bridge, true)
    await connect(bridge)

    const after = await refreshWiped(bridge)

    expect(after.provisionBoardId).toHaveBeenCalledWith(GENERATED)
    expect(after.writeLicense).toHaveBeenCalledWith(BLOB)
    expect(licenseFlow.resolveDeviceLicense).toHaveBeenCalledWith(
      after,
      { ...REQUEST, identity: { kind: 'anchor', anchor: GENERATED } },
      expect.any(Function),
    )

    expectFreshId(await refreshWiped(bridge))
  })

  it('drops the backup when the build or upload fails', async () => {
    const bridge = createBridge()
    await release(bridge)
    await build(bridge, false)
    await connect(bridge)

    expectFreshId(await refreshWiped(bridge))
  })

  it('drops the backup on Disconnect', async () => {
    const bridge = createBridge()
    await release(bridge)
    await build(bridge, true)
    await bridge.handleDeviceDisconnect()
    await connect(bridge)

    expectFreshId(await refreshWiped(bridge))
  })

  it('drops the backup on a connect that does not follow a finished upload', async () => {
    const bridge = createBridge()
    await release(bridge)
    await connect(bridge)
    await build(bridge, true)
    await connect(bridge)

    expectFreshId(await refreshWiped(bridge))
  })

  it('drops the backup on a second connect after the upload', async () => {
    const bridge = createBridge()
    await release(bridge)
    await build(bridge, true)
    await connect(bridge)
    await connect(bridge)

    expectFreshId(await refreshWiped(bridge))
  })

  it('does not apply the backup to a link on another port', async () => {
    const bridge = createBridge()
    await release(bridge)
    await build(bridge, true)
    await connect(bridge)
    holdLink(bridge, { transport: 'rtu', descriptor: '/dev/cu.other' })

    expectFreshId(await refreshWiped(bridge))
  })

  it('takes no backup when the held link is not the serial port being released', async () => {
    const bridge = createBridge()
    const board = licensedBoard()
    holdLink(bridge, { transport: 'tcp', descriptor: '192.168.0.10:502' })
    holdClient(bridge, board)

    await bridge.handleDeviceReleaseSerialPort({} as never, PORT)

    expect(board.getDeviceId).not.toHaveBeenCalled()
    expect(board.readLicense).not.toHaveBeenCalled()
  })
})
