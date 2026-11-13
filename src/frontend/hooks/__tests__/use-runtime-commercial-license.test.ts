import type { DeviceLicenseReport, DevicePort } from '@root/middleware/shared/ports/device-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { BoardInfo, PackageManifest, RuntimeLicenseMode } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { COMMERCIAL_LICENSE_DISCLAIMER } from '@root/middleware/shared/utils/licensing'
import { act, renderHook } from '@testing-library/react'

import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import {
  boardRuntimeLicense,
  useRuntimeCommercialLicense,
  useRuntimeCommercialLicenseOwner,
} from '../use-runtime-commercial-license'

const ID = `hw2:${'ab'.repeat(32)}`
const RUNTIME_BOARD = 'OpenPLC Runtime v4'
const VPP_BOARD = 'Vendor Board'
const ARDUINO_BOARD = 'Arduino Uno'
const SIMULATOR_BOARD = 'Simulator'
const DEVICE_ID = 'c0'.repeat(16)

const runtimeMock = {
  getHardwareId: jest.fn(),
  syncRuntimeLicenses: jest.fn(),
  getStatus: jest.fn(),
}
const systemMock = {
  getEdgeFrontendUrl: jest.fn(() => 'https://edge.example.com'),
  openExternalLink: jest.fn(),
}
const getManifest = jest.fn()
const refreshLicense = jest.fn<Promise<DeviceLicenseReport>, [{ packageId: string }]>()

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function buildPorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort<RuntimePort>({
      getHardwareId: () => runtimeMock.getHardwareId() as ReturnType<NonNullable<RuntimePort['getHardwareId']>>,
      syncRuntimeLicenses: () =>
        runtimeMock.syncRuntimeLicenses() as ReturnType<NonNullable<RuntimePort['syncRuntimeLicenses']>>,
      getStatus: () => runtimeMock.getStatus() as ReturnType<RuntimePort['getStatus']>,
    }),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort<DevicePort>({ refreshLicense: (request) => refreshLicense(request) }),
    orchestrator: stubPort(),
    system: stubPort({
      getEdgeFrontendUrl: () => systemMock.getEdgeFrontendUrl(),
      openExternalLink: (url: string) => systemMock.openExternalLink(url) as Promise<{ success: boolean }>,
    }),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    packages: stubPort({ getManifest: (id: string) => getManifest(id) as Promise<PackageManifest | null> }),
    capabilities: WEB_CAPABILITIES,
  } as PlatformPorts
}

const board = (vppPackageId?: string): BoardInfo =>
  ({
    compiler: 'openplc-compiler',
    core: 'runtime-v4',
    preview: '',
    specs: {},
    ...(vppPackageId ? { vpp: { packageId: vppPackageId } } : {}),
  }) as BoardInfo

const manifestWith = (runtimeLicense: RuntimeLicenseMode) =>
  ({ package: { id: 'com.example.board', runtimeLicense } }) as unknown as PackageManifest

const baremetal = (compiler: 'arduino-cli' | 'simulator', vppPackageId?: string): BoardInfo =>
  ({
    compiler,
    core: 'arduino:avr',
    preview: '',
    specs: {},
    ...(vppPackageId ? { vpp: { packageId: vppPackageId } } : {}),
  }) as BoardInfo

let store: OpenPLCStore

/** A built-in board on a held serial link. */
function setupBoard(boardName = ARDUINO_BOARD) {
  store = createTestStore()
  const { deviceActions } = store.getState()
  deviceActions.setAvailableOptions({
    availableBoards: new Map([
      [ARDUINO_BOARD, baremetal('arduino-cli', 'com.openplc.arduino')],
      [SIMULATOR_BOARD, baremetal('simulator')],
    ]),
  })
  deviceActions.setDeviceBoard(boardName)
  deviceActions.setDeviceConnectionStatus('connected', '/dev/ttyACM0', 'rtu')
}

function setup(opts: { boardName?: string; license?: 'commercial' | 'gpl' | null } = {}) {
  store = createTestStore()
  const { deviceActions } = store.getState()
  deviceActions.setAvailableOptions({
    availableBoards: new Map([
      [RUNTIME_BOARD, board()],
      [VPP_BOARD, board('com.example.board')],
    ]),
  })
  deviceActions.setDeviceBoard(opts.boardName ?? RUNTIME_BOARD)
  deviceActions.setRuntimeJwtToken('tok')
  deviceActions.setRuntimeConnectionStatus('connected')
  if (opts.license !== undefined) {
    runtimeMock.syncRuntimeLicenses.mockResolvedValue(
      opts.license === null ? { status: 'failed', error: 'no report' } : synced(opts.license),
    )
  }
}

/** What the editor's check of a runtime with hardware ID `ID` ends with. */
function synced(license: 'commercial' | 'gpl', uploads: { orderId: string; stored: boolean }[] = []) {
  return { status: 'synced', hardwareId: ID, license, uploads }
}

function renderOwner() {
  return renderHook(
    () => {
      useRuntimeCommercialLicenseOwner()
      return useRuntimeCommercialLicense()
    },
    { wrapper: createStoreWrapper(store, buildPorts()) },
  )
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve())
}

type DialogData = { message: string; buttons: string[]; onResponse: (index: number) => void }
const dialog = () => store.getState().modals['debugger-message']

beforeEach(() => {
  jest.clearAllMocks()
  runtimeMock.getHardwareId.mockResolvedValue({ success: true, hardwareId: ID, source: 'device' })
  runtimeMock.syncRuntimeLicenses.mockResolvedValue(synced('gpl'))
  systemMock.openExternalLink.mockResolvedValue({ success: true })
  getManifest.mockResolvedValue(null)
  refreshLicense.mockResolvedValue({
    deviceId: DEVICE_ID,
    outcome: { state: 'unlicensed', entitlementChecked: true },
  })
})

describe('useRuntimeCommercialLicenseOwner', () => {
  it('checks the runtime licence on connect and takes the hardware ID from it', async () => {
    setup()
    const { result } = renderOwner()
    await flush()
    expect(runtimeMock.syncRuntimeLicenses).toHaveBeenCalledTimes(1)
    expect(runtimeMock.getHardwareId).not.toHaveBeenCalled()
    expect(result.current.hardwareId).toBe(ID)
    expect(result.current.status).toBe('unlicensed')
    expect(store.getState().runtimeCommercialLicense.hardwareId).toBe(ID)
  })

  it('shows the approved disclaimer once for an unlicensed runtime', async () => {
    setup({ license: 'gpl' })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unlicensed')
    expect(dialog()?.open).toBe(true)
    const data = dialog()?.data as DialogData
    expect(data.message).toBe(COMMERCIAL_LICENSE_DISCLAIMER)
    expect(data.buttons).toEqual(['Buy licences', 'Dismiss'])
  })

  it('keeps a dismissal for the device across reconnects', async () => {
    setup({ license: 'gpl' })
    renderOwner()
    await flush()
    act(() => {
      ;(dialog()?.data as DialogData).onResponse(1)
      store.getState().modalActions.closeModal()
    })
    expect(store.getState().runtimeCommercialLicense.dismissedDisclaimers).toEqual([ID])

    act(() => store.getState().deviceActions.setRuntimeConnectionStatus('disconnected'))
    await flush()
    act(() => store.getState().deviceActions.setRuntimeConnectionStatus('connected'))
    await flush()
    expect(store.getState().runtimeCommercialLicense.status).toBe('unlicensed')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('shows the dialog again on the next connect when it was not dismissed', async () => {
    setup({ license: 'gpl' })
    renderOwner()
    await flush()
    act(() => store.getState().modalActions.closeModal())
    act(() => store.getState().deviceActions.setRuntimeConnectionStatus('disconnected'))
    await flush()
    act(() => store.getState().deviceActions.setRuntimeConnectionStatus('connected'))
    await flush()
    expect(dialog()?.open).toBe(true)
  })

  it('shows nothing for a commercial runtime', async () => {
    setup({ license: 'commercial' })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('licensed')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('shows nothing when the runtime licence could not be checked', async () => {
    setup({ license: null })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unknown')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('licenses a vendor-paid VPP board even when the runtime reports gpl', async () => {
    getManifest.mockResolvedValue(manifestWith('vendor'))
    setup({ boardName: VPP_BOARD, license: 'gpl' })
    const { result } = renderOwner()
    await flush()
    expect(getManifest).toHaveBeenCalledWith('com.example.board')
    expect(result.current.status).toBe('licensed')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('leaves a paid VPP in demo to the VPP purchase flow', async () => {
    getManifest.mockResolvedValue(manifestWith('vpp'))
    setup({ boardName: VPP_BOARD, license: 'gpl' })
    store
      .getState()
      .deviceActions.setDeviceLicenseReport({ outcome: { state: 'unlicensed', entitlementChecked: true } })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('vpp-flow')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('clears the status and ID on disconnect', async () => {
    setup()
    const { result } = renderOwner()
    await flush()
    act(() => store.getState().deviceActions.setRuntimeConnectionStatus('disconnected'))
    await flush()
    expect(result.current.status).toBeNull()
    expect(result.current.hardwareId).toBeNull()
  })

  it('shows no dialog when the licence delivered on connect makes the runtime commercial', async () => {
    setup()
    runtimeMock.syncRuntimeLicenses.mockResolvedValue(synced('commercial', [{ orderId: 'order_1', stored: true }]))
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('licensed')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('waits for the delivery before showing the dialog', async () => {
    let finish: (value: unknown) => void = () => undefined
    setup()
    runtimeMock.syncRuntimeLicenses.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unknown')
    expect(result.current.checking).toBe(true)
    expect(dialog()?.open ?? false).toBe(false)
    await act(async () => finish(synced('gpl')))
    await flush()
    expect(result.current.checking).toBe(false)
    expect(result.current.status).toBe('unlicensed')
    expect(dialog()?.open).toBe(true)
  })

  it('never blocks on a failed check, and shows no status for it', async () => {
    setup()
    runtimeMock.syncRuntimeLicenses.mockResolvedValue({ status: 'failed', error: 'offline' })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unknown')
    expect(dialog()?.open ?? false).toBe(false)
    expect(store.getState().modals['runtime-connection-lost']?.open ?? false).toBe(false)
  })
})

describe('runtime without a hardware ID', () => {
  it('is unlicensed with no dialog, since there is nothing to buy for', async () => {
    setup()
    runtimeMock.syncRuntimeLicenses.mockResolvedValue({ status: 'no-hardware-id' })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unlicensed')
    expect(result.current.hardwareId).toBeNull()
    expect(dialog()?.open ?? false).toBe(false)
  })
})

describe('useRuntimeCommercialLicense', () => {
  it('opens the purchase page for the hardware ID and watches for the licence', async () => {
    setup({ license: 'gpl' })
    const { result } = renderOwner()
    await flush()
    expect(result.current.buyUrl).toBe(`https://edge.example.com/buy?hardwareId=${encodeURIComponent(ID)}`)
    await act(async () => result.current.buy())
    expect(systemMock.openExternalLink).toHaveBeenCalledWith(result.current.buyUrl)
    expect(result.current.awaitingPurchase).toBe(true)
  })

  it('stops watching once the runtime reports commercial', async () => {
    setup({ license: 'gpl' })
    const { result } = renderOwner()
    await flush()
    await act(async () => result.current.buy())
    act(() => store.getState().deviceActions.setRuntimeLicense('commercial'))
    await flush()
    expect(result.current.status).toBe('licensed')
    expect(result.current.awaitingPurchase).toBe(false)
  })
})

describe('built-in boards', () => {
  it('runs the board flow for the baremetal runtime product and shows the disclaimer when unlicensed', async () => {
    getManifest.mockResolvedValue(manifestWith('user'))
    setupBoard()
    const { result } = renderOwner()
    await flush()
    expect(refreshLicense).toHaveBeenCalledWith({ packageId: 'com.autonomy.openplc-runtime-baremetal' })
    expect(runtimeMock.getHardwareId).not.toHaveBeenCalled()
    expect(result.current.status).toBe('unlicensed')
    expect(result.current.hardwareId).toBe(DEVICE_ID)
    expect(result.current.idLabel).toBe('Device ID')
    expect(result.current.buyUrl).toBe(
      `https://edge.example.com/buy?vppId=com.autonomy.openplc-runtime-baremetal&deviceId=${DEVICE_ID}`,
    )
    expect((dialog()?.data as DialogData).message).toBe(COMMERCIAL_LICENSE_DISCLAIMER)
  })

  it('shows nothing for a board whose runtime licence verifies', async () => {
    getManifest.mockResolvedValue(manifestWith('user'))
    refreshLicense.mockResolvedValue({ deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'already-stored' } })
    setupBoard()
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('licensed')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('does not run the flow on a vendor-paid VPP', async () => {
    getManifest.mockResolvedValue(manifestWith('vendor'))
    setupBoard()
    const { result } = renderOwner()
    await flush()
    expect(refreshLicense).not.toHaveBeenCalled()
    expect(result.current.status).toBe('licensed')
  })

  it('shows the dialog once per board across the link drop of an upload', async () => {
    getManifest.mockResolvedValue(manifestWith('user'))
    setupBoard()
    renderOwner()
    await flush()
    act(() => store.getState().modalActions.closeModal())
    act(() => store.getState().deviceActions.setDeviceConnectionStatus('disconnected', null))
    await flush()
    act(() => store.getState().deviceActions.setDeviceConnectionStatus('connected', '/dev/ttyACM0', 'rtu'))
    await flush()
    expect(refreshLicense).toHaveBeenCalledTimes(2)
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('shows nothing when the board check fails', async () => {
    getManifest.mockResolvedValue(manifestWith('user'))
    refreshLicense.mockResolvedValue({ outcome: { state: 'check-failed', error: 'no reply' } })
    setupBoard()
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unknown')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('never runs for the simulator', async () => {
    setupBoard(SIMULATOR_BOARD)
    const { result } = renderOwner()
    await flush()
    expect(refreshLicense).not.toHaveBeenCalled()
    expect(result.current.status).toBeNull()
  })

  it('maps board outcomes to a runtime licence', () => {
    expect(boardRuntimeLicense({ state: 'licensed', how: 'activated' })).toBe('commercial')
    expect(boardRuntimeLicense({ state: 'unlicensed', entitlementChecked: false })).toBe('gpl')
    expect(boardRuntimeLicense({ state: 'unsupported' })).toBe('gpl')
    expect(boardRuntimeLicense({ state: 'check-failed', error: 'x' })).toBeNull()
  })
})
