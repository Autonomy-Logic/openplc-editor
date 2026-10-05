/**
 * Byte-identical with openplc-editor's copy. No module mocks: ports come through
 * PlatformProvider, so the same file runs under Jest and Vitest.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { getMemoryState } from '@root/frontend/utils/toast'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type { ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import type { EtherCATDevice } from '@root/middleware/shared/ports/ethercat-types'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { EtherCATEditor } from '..'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const BUS = 'ethercat_bus'

const scanned = (position: number, productCode: number, name: string): EtherCATDevice => ({
  position,
  name,
  vendor_id: 2,
  product_code: productCode,
  revision: 1,
  serial_number: 0,
  config_address: 0,
  alias: 0,
  state: 'PRE-OP',
  al_status_code: 0,
  has_coe: false,
  input_bytes: 0,
  output_bytes: 0,
})

const SCANNED = [scanned(1, 0x0898_3052, 'EL2202'), scanned(2, 0x07d4_3052, 'EL2004')]

const summary = (name: string, productCode: number) => ({
  type: { name, productCode: `#x${productCode.toString(16)}`, revisionNo: '#x1' },
  name,
  inputChannelCount: 0,
  outputChannelCount: 2,
  totalInputBytes: 0,
  totalOutputBytes: 1,
})

const REPO_ITEM: ESIRepositoryItemLight = {
  id: 'item-1',
  filename: 'Beckhoff EL2xxx.xml',
  vendor: { id: '#x2', name: 'Beckhoff' },
  devices: [summary('EL2202', 0x0898_3052), summary('EL2004', 0x07d4_3052)],
  loadedAt: '2026-09-29T00:00:00.000Z',
}

type LoadResult = Awaited<ReturnType<EsiPort['loadDeviceFull']>>

let loadCalls: { itemId: string; deviceIndex: number }[] = []
let pendingLoads: { resolve: (r: LoadResult) => void; reject: (e: unknown) => void }[] = []

function makePorts(): PlatformPorts {
  const runtime = stubPort<RuntimePort>({
    getEthercatServiceStatus: () => Promise.resolve({ success: true, data: { available: true, message: '' } }),
    getNetworkInterfaces: () => Promise.resolve({ success: true, data: [{ name: 'eth0', description: 'Ethernet' }] }),
    scanEthercatDevices: () =>
      Promise.resolve({
        success: true,
        data: { status: 'success', devices: SCANNED, message: '', scan_time_ms: 5, interface: 'eth0' },
      }),
  })
  const esi = stubPort<EsiPort>({
    loadRepositoryLight: () => Promise.resolve({ success: true, items: [REPO_ITEM] }),
    loadDeviceFull: (itemId, deviceIndex) => {
      loadCalls.push({ itemId, deviceIndex })
      return new Promise<LoadResult>((resolve, reject) => pendingLoads.push({ resolve, reject }))
    },
  })
  return {
    compiler: stubPort(),
    runtime,
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    esi,
    capabilities: EDITOR_CAPABILITIES,
  }
}

let store: OpenPLCStore

function seedStore() {
  const state = store.getState()
  store.setState({
    editor: { type: 'plc-remote-device', meta: { name: BUS, protocol: 'ethercat' } },
    runtimeConnection: { ...state.runtimeConnection, connectionStatus: 'connected' },
    project: {
      ...state.project,
      meta: { ...state.project.meta, path: '/projects/ethercat' },
      data: {
        ...state.project.data,
        remoteDevices: [
          {
            name: BUS,
            protocol: 'ethercat',
            ethercatConfig: { masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000 }, devices: [] },
          },
        ],
      },
    },
  })
}

const configuredSlaves = () =>
  store.getState().project.data.remoteDevices?.find((d) => d.name === BUS)?.ethercatConfig?.devices ?? []

const addButton = () => screen.getByRole('button', { name: /Add Selected|Adding/, hidden: true })
const browserAddButton = () => screen.getByRole('button', { name: 'Add Device', hidden: true })

async function renderScannedAndSelected() {
  const ports = makePorts()
  render(<EtherCATEditor />, { wrapper: createStoreWrapper(store, ports) })

  const scan = await screen.findByRole('button', { name: 'Scan' })
  await waitFor(() => expect(scan.hasAttribute('disabled')).toBe(false))
  fireEvent.click(scan)

  for (const d of SCANNED) {
    fireEvent.click(await screen.findByLabelText(`Select device at position ${d.position}`))
  }
  await waitFor(() => expect(addButton().textContent).toBe(`Add Selected (${SCANNED.length})`))
}

async function settleLoad(index: number, result: LoadResult) {
  await waitFor(() => expect(pendingLoads.length).toBeGreaterThan(index))
  await act(async () => {
    pendingLoads[index].resolve(result)
    await Promise.resolve()
  })
}

describe('EtherCATEditor "Add Selected"', () => {
  beforeEach(() => {
    loadCalls = []
    pendingLoads = []
    store = createTestStore()
    seedStore()
  })

  it('ignores a second click while an add is running, so each slave is loaded and added once', async () => {
    await renderScannedAndSelected()

    act(() => {
      fireEvent.click(addButton())
      fireEvent.click(addButton())
    })

    for (let i = 0; i < SCANNED.length; i++) await settleLoad(i, { success: false, error: 'no xml' })

    await waitFor(() => expect(configuredSlaves()).toHaveLength(SCANNED.length))
    expect(loadCalls).toEqual([
      { itemId: 'item-1', deviceIndex: 0 },
      { itemId: 'item-1', deviceIndex: 1 },
    ])
    const slaves = configuredSlaves()
    expect(new Set(slaves.map((d) => d.position)).size).toBe(SCANNED.length)
    expect(new Set(slaves.map((d) => d.name)).size).toBe(SCANNED.length)
  })

  it('disables the button and the scan with progress while adding, then restores them', async () => {
    await renderScannedAndSelected()

    fireEvent.click(addButton())

    await waitFor(() => expect(addButton().textContent).toContain('Adding 1/2…'))
    expect(addButton().hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Scan' }).hasAttribute('disabled')).toBe(true)
    expect(browserAddButton().hasAttribute('disabled')).toBe(true)

    await settleLoad(0, { success: false, error: 'no xml' })
    await waitFor(() => expect(addButton().textContent).toContain('Adding 2/2…'))

    await settleLoad(1, { success: false, error: 'no xml' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan' }).hasAttribute('disabled')).toBe(false))
    expect(addButton().textContent).toBe('Add Selected')
    expect(addButton().hasAttribute('disabled')).toBe(true)
    expect(browserAddButton().hasAttribute('disabled')).toBe(false)
  })

  it('keeps a master config edit made while the add was running', async () => {
    await renderScannedAndSelected()

    fireEvent.click(addButton())
    await waitFor(() => expect(pendingLoads.length).toBe(1))
    act(() => {
      store.getState().projectActions.updateEthercatConfig(BUS, {
        masterConfig: { networkInterface: 'eth1', cycleTimeUs: 2000 },
        devices: configuredSlaves(),
      })
    })

    for (let i = 0; i < SCANNED.length; i++) await settleLoad(i, { success: false, error: 'no xml' })

    await waitFor(() => expect(configuredSlaves()).toHaveLength(SCANNED.length))
    const master = store.getState().project.data.remoteDevices?.find((d) => d.name === BUS)
      ?.ethercatConfig?.masterConfig
    expect(master).toEqual({ networkInterface: 'eth1', cycleTimeUs: 2000 })
  })

  it('ignores a device browser add while a scan add is running', async () => {
    await renderScannedAndSelected()

    fireEvent.click(browserAddButton())
    fireEvent.change(screen.getByPlaceholderText(/Search devices/), { target: { value: 'EL2004' } })
    fireEvent.click(await screen.findByRole('button', { name: /EL2004/, pressed: false }))
    // With the modal open the page behind it is aria-hidden, so this finds only the modal's confirm button.
    const confirm = screen.getByRole('button', { name: 'Add Device' })

    act(() => {
      fireEvent.click(addButton())
      fireEvent.click(confirm)
    })

    for (let i = 0; i < SCANNED.length; i++) await settleLoad(i, { success: false, error: 'no xml' })

    await waitFor(() => expect(configuredSlaves()).toHaveLength(SCANNED.length))
    expect(loadCalls).toHaveLength(SCANNED.length)
    expect(configuredSlaves().every((d) => d.addedFrom === 'scan')).toBe(true)
  })

  it('releases the button when loadDeviceFull rejects', async () => {
    await renderScannedAndSelected()

    fireEvent.click(addButton())
    await waitFor(() => expect(pendingLoads.length).toBe(1))
    await act(async () => {
      pendingLoads[0].reject(new Error('network down'))
      await Promise.resolve()
    })

    await waitFor(() => expect(addButton().textContent).toBe(`Add Selected (${SCANNED.length})`))
    expect(addButton().hasAttribute('disabled')).toBe(false)
    expect(configuredSlaves()).toHaveLength(0)
    expect(getMemoryState().toasts[0]).toMatchObject({
      title: 'Failed to add EtherCAT devices',
      description: 'Error: network down',
      variant: 'fail',
    })
  })
})
