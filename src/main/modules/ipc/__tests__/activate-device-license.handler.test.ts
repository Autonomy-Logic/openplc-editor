/**
 * The `device:activate-license` IPC handler.
 *
 * WHY THIS FILE EXISTS (A20/T12). The handler had NO test: coverage stopped at
 * `toLegacyActivationOutcome`, the pure function, and never touched the code that
 * calls it. That is exactly where the type drift lived — the handler's declared
 * return type omitted `licenseStatus`, `activation` and `devicePublicKey`, the
 * three fields ADR-0002 and the badge work added, and `tsc` stayed silent because
 * the body returns `{ probedAt, ...toLegacyActivationOutcome(result) }` and a
 * SPREAD is not subject to excess-property checking. Nothing failed, so nothing
 * warned the next person who "tidies up" the handler by naming the fields its
 * type lists — the exact move that broke the activity bar. On this channel it
 * costs `devicePublicKey`: a runtime-v4 purchase then binds no key, the device
 * stays unbound forever, and the backend serves it WITHOUT proof of possession.
 *
 * WHY NOT IN `main.spec.ts`, where the bridge harness already lives: on Windows
 * jest collects NO `*.spec.ts` file at all. `testMatch`'s first pattern loses the
 * separator before `?(*.)` when `<rootDir>` is expanded with backslashes, so it
 * degrades to `src/**?(*.)+(spec|test).(ts|tsx)`, which matches nothing — only the
 * `__tests__` pattern survives. `main.spec.ts`, `store.spec.ts` and
 * `compiler-module.spec.ts` therefore never run here (they presumably do on Linux
 * CI). A test that cannot be executed on the machine writing it is not evidence,
 * so this lives under `__tests__`, where both platforms agree.
 */
import type { IpcMainInvokeEvent } from 'electron'

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

// The licensing collaborators are mocked so this file asserts what the HANDLER
// does — pick a transport, retry the connect, delegate, release the port, shape
// the response. `probeAndRecover` has its own tests; re-testing it through here
// would only hide which layer broke. `toLegacyActivationOutcome` is deliberately
// NOT stubbed: it is the real function, so the response asserted below is the
// response the renderer actually receives.
const mockBuildLicenseTransport = jest.fn()
const mockConnectWithRetries = jest.fn()
const mockProbeAndRecover = jest.fn()

jest.mock('../../../../backend/editor/license/license-transport-factory', () => ({
  buildLicenseTransport: (...args: unknown[]) => mockBuildLicenseTransport(...args),
}))
jest.mock('../../../../backend/editor/license/license-probe', () => ({
  connectWithRetries: (...args: unknown[]) => mockConnectWithRetries(...args),
  readBoardIdWithRetries: jest.fn(),
}))
jest.mock('../../../../backend/editor/license/device-connect', () => {
  const real = jest.requireActual('../../../../backend/editor/license/device-connect') as Record<string, unknown>
  return { ...real, probeAndRecover: (...args: unknown[]) => mockProbeAndRecover(...args) }
})

import MainProcessBridge from '../main'

const WS_PARAMS = { connectionType: 'websocket' as const, host: '192.168.0.128', token: 'jwt' }
const OPTS = { packageId: 'com.openplc.raspberry-pi-licensed', keyId: 'raspberry-pi-licensed-2026' }
const DEVICE_ID = '7146518f9842adacfadc731ee7f546e5'
const DEVICE_PUBLIC_KEY = '1af309c4605fbe25be6e84f571d4299f98d45e811860450689b317ef14f128f0'

function makeBridge() {
  return new MainProcessBridge({
    ipcMain: {},
    mainWindow: { isDestroyed: () => false, isMaximized: () => false },
    projectService: {},
    store: { get: jest.fn(() => undefined) },
    menuBuilder: {},
    pouService: {},
    compilerModule: {},
    hardwareModule: {},
  } as never)
}

describe('MainProcessBridge.handleActivateDeviceLicense', () => {
  let client: { disconnect: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    client = { disconnect: jest.fn() }
    mockBuildLicenseTransport.mockReturnValue({ client })
    mockConnectWithRetries.mockResolvedValue(undefined)
  })

  // The assertion the missing test was: the three ADR-0002 / badge fields reach
  // the renderer. A handler rewritten from its own declared type dropped them.
  it('carries licenseStatus, activation and devicePublicKey out to the renderer', async () => {
    mockProbeAndRecover.mockResolvedValue({
      status: 'connected-with-firmware',
      anchorHex: '38363235383037623061383361653764',
      deviceId: DEVICE_ID,
      devicePublicKey: DEVICE_PUBLIC_KEY,
      licenseStatus: 'unlicensed',
      activation: 'demo',
      proofOfPossession: 'unproven',
    })

    const result = await makeBridge().handleActivateDeviceLicense({} as IpcMainInvokeEvent, WS_PARAMS, OPTS)

    expect(result).toMatchObject({
      success: true,
      outcome: 'demo',
      deviceId: DEVICE_ID,
      devicePublicKey: DEVICE_PUBLIC_KEY,
      licenseStatus: 'unlicensed',
      activation: 'demo',
      proofOfPossession: 'unproven',
    })
    expect(typeof result.probedAt).toBe('string')
  })

  it('delegates to probeAndRecover over the transport it built, as a licensable target', async () => {
    mockProbeAndRecover.mockResolvedValue({ status: 'connected-with-firmware', activation: 'already-licensed' })

    await makeBridge().handleActivateDeviceLicense({} as IpcMainInvokeEvent, WS_PARAMS, OPTS)

    expect(mockBuildLicenseTransport).toHaveBeenCalledWith(WS_PARAMS, expect.any(Number))
    expect(mockProbeAndRecover).toHaveBeenCalledWith(client, {
      isLicensable: true,
      packageId: OPTS.packageId,
      keyId: OPTS.keyId,
    })
  })

  // The port has to come back: the debugger opens its own session on demand later.
  it('releases the transient transport even when the probe throws', async () => {
    mockProbeAndRecover.mockRejectedValue(new Error('serial exploded'))

    await expect(makeBridge().handleActivateDeviceLicense({} as IpcMainInvokeEvent, WS_PARAMS, OPTS)).rejects.toThrow(
      'serial exploded',
    )
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  it('releases the transient transport on the success path too', async () => {
    mockProbeAndRecover.mockResolvedValue({ status: 'connected-with-firmware', activation: 'activated' })

    await makeBridge().handleActivateDeviceLicense({} as IpcMainInvokeEvent, WS_PARAMS, OPTS)

    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  // Best-effort by contract: this runs right after an upload, so an activation
  // hiccup must not break the build flow with a rejected promise.
  it('reports a transport it could not build without throwing', async () => {
    mockBuildLicenseTransport.mockReturnValue({ error: 'websocket needs a token' })

    const result = await makeBridge().handleActivateDeviceLicense({} as IpcMainInvokeEvent, WS_PARAMS, OPTS)

    expect(result).toMatchObject({ success: false, outcome: 'error', error: 'websocket needs a token' })
    expect(mockProbeAndRecover).not.toHaveBeenCalled()
  })

  it('reports a connect that never came up without throwing', async () => {
    mockConnectWithRetries.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await makeBridge().handleActivateDeviceLicense({} as IpcMainInvokeEvent, WS_PARAMS, OPTS)

    expect(result).toMatchObject({ success: false, outcome: 'error' })
    expect(result.error).toContain('ECONNREFUSED')
    expect(mockProbeAndRecover).not.toHaveBeenCalled()
  })
})
