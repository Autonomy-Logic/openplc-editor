import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { BoardInfo, PackageManifest, RuntimeLicenseMode } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { COMMERCIAL_LICENSE_DISCLAIMER } from '@root/middleware/shared/utils/licensing'
import { act, renderHook } from '@testing-library/react'

import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useRuntimeCommercialLicense, useRuntimeCommercialLicenseOwner } from '../use-runtime-commercial-license'

const ID = `hw2:${'ab'.repeat(32)}`
const RUNTIME_BOARD = 'OpenPLC Runtime v4'
const VPP_BOARD = 'Vendor Board'

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
    device: stubPort(),
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

let store: OpenPLCStore

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
  deviceActions.setRuntimeLicense(opts.license === undefined ? 'gpl' : opts.license)
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
  runtimeMock.syncRuntimeLicenses.mockResolvedValue({ status: 'synced', hardwareId: ID, uploads: [] })
  systemMock.openExternalLink.mockResolvedValue({ success: true })
  getManifest.mockResolvedValue(null)
})

describe('useRuntimeCommercialLicenseOwner', () => {
  it('reads the hardware ID and delivers licences on connect', async () => {
    setup()
    renderOwner()
    await flush()
    expect(runtimeMock.getHardwareId).toHaveBeenCalledTimes(1)
    expect(runtimeMock.syncRuntimeLicenses).toHaveBeenCalledTimes(1)
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

  it('shows nothing for a runtime that does not report a licence', async () => {
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
    runtimeMock.syncRuntimeLicenses.mockResolvedValue({
      status: 'synced',
      hardwareId: ID,
      uploads: [{ orderId: 'order_1', stored: true }],
    })
    runtimeMock.getStatus.mockResolvedValue({ success: true, status: 'RUNNING', license: 'commercial' })
    setup({ license: 'gpl' })
    const { result } = renderOwner()
    await flush()
    expect(runtimeMock.getStatus).toHaveBeenCalled()
    expect(result.current.status).toBe('licensed')
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('waits for the delivery before showing the dialog', async () => {
    let finish: (value: unknown) => void = () => undefined
    runtimeMock.syncRuntimeLicenses.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    setup({ license: 'gpl' })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unlicensed')
    expect(dialog()?.open ?? false).toBe(false)
    await act(async () => finish({ status: 'synced', hardwareId: ID, uploads: [] }))
    await flush()
    expect(dialog()?.open).toBe(true)
  })

  it('never blocks on a failed delivery', async () => {
    runtimeMock.syncRuntimeLicenses.mockResolvedValue({ status: 'failed', error: 'offline' })
    setup({ license: 'gpl' })
    const { result } = renderOwner()
    await flush()
    expect(result.current.status).toBe('unlicensed')
    expect(store.getState().modals['runtime-connection-lost']?.open ?? false).toBe(false)
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
