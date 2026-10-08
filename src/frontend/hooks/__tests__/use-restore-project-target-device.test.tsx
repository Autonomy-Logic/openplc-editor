import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OrchestratorInfo, OrchestratorPort } from '@root/middleware/shared/ports/orchestrator-port'
import { EDITOR_CAPABILITIES, WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformCapabilities } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useRestoreProjectTargetDevice } from '../use-restore-project-target-device'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const listing = [
  {
    id: 'edge-1',
    agentId: 'agent-1',
    name: 'shop-floor-01',
    devices: [{ id: 'vplc-1', name: 'mixer', status: 'online', active: true, backplaneAccess: false }],
  },
] as OrchestratorInfo[]

const target = { orchestratorId: 'edge-1', deviceId: 'vplc-1', deviceName: 'mixer' }

const makePorts = (listOrchestrators: OrchestratorPort['listOrchestrators'], capabilities: PlatformCapabilities) =>
  ({
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort<OrchestratorPort>({ listOrchestrators }),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities,
  }) as PlatformPorts

const loadProjectWithTarget = (store: OpenPLCStore) =>
  store.getState().deviceActions.setDeviceDefinitions({
    configuration: { deviceBoard: 'OpenPLC Runtime v4', communicationPort: '', targetDevice: target },
  })

describe('useRestoreProjectTargetDevice', () => {
  it('selects the recorded vPLC when the project opens and it is listed', async () => {
    const store = createTestStore()
    loadProjectWithTarget(store)
    const list = jest.fn(() => Promise.resolve(listing))

    renderHook(() => useRestoreProjectTargetDevice(), {
      wrapper: createStoreWrapper(store, makePorts(list, WEB_CAPABILITIES)),
    })

    await waitFor(() =>
      expect(store.getState().runtimeConnection.selectedDevice).toEqual({
        orchestratorId: 'edge-1',
        orchestratorAgentId: 'agent-1',
        deviceId: 'vplc-1',
        deviceName: 'mixer',
        backplaneAccess: false,
      }),
    )
    // Selecting is not connecting.
    expect(store.getState().runtimeConnection.connectionStatus).toBe('disconnected')
  })

  it('selects nothing when the recorded vPLC is no longer listed', async () => {
    const store = createTestStore()
    loadProjectWithTarget(store)
    const list = jest.fn(() => Promise.resolve([]))

    renderHook(() => useRestoreProjectTargetDevice(), {
      wrapper: createStoreWrapper(store, makePorts(list, WEB_CAPABILITIES)),
    })

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(store.getState().runtimeConnection.selectedDevice).toBeNull()
  })

  it('does not undo a disconnect: clearing the selection does not trigger a second restore', async () => {
    const store = createTestStore()
    loadProjectWithTarget(store)
    const list = jest.fn(() => Promise.resolve(listing))

    renderHook(() => useRestoreProjectTargetDevice(), {
      wrapper: createStoreWrapper(store, makePorts(list, WEB_CAPABILITIES)),
    })
    await waitFor(() => expect(store.getState().runtimeConnection.selectedDevice).not.toBeNull())

    act(() => store.getState().deviceActions.clearRuntimeConnection())
    await act(async () => {})

    expect(list).toHaveBeenCalledTimes(1)
    expect(store.getState().runtimeConnection.selectedDevice).toBeNull()
  })

  it('restores again when the project is reloaded', async () => {
    const store = createTestStore()
    loadProjectWithTarget(store)
    const list = jest.fn(() => Promise.resolve(listing))

    renderHook(() => useRestoreProjectTargetDevice(), {
      wrapper: createStoreWrapper(store, makePorts(list, WEB_CAPABILITIES)),
    })
    await waitFor(() => expect(store.getState().runtimeConnection.selectedDevice).not.toBeNull())

    act(() => {
      store.getState().deviceActions.clearDeviceDefinitions()
      loadProjectWithTarget(store)
    })

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(store.getState().runtimeConnection.selectedDevice?.deviceId).toBe('vplc-1'))
  })

  it('leaves an existing selection alone', async () => {
    const store = createTestStore()
    loadProjectWithTarget(store)
    const other = { orchestratorId: 'edge-1', orchestratorAgentId: 'agent-1', deviceId: 'vplc-9', deviceName: 'x' }
    store.getState().deviceActions.setSelectedDevice(other)
    const list = jest.fn(() => Promise.resolve(listing))

    renderHook(() => useRestoreProjectTargetDevice(), {
      wrapper: createStoreWrapper(store, makePorts(list, WEB_CAPABILITIES)),
    })
    await act(async () => {})

    expect(list).not.toHaveBeenCalled()
    expect(store.getState().runtimeConnection.selectedDevice).toEqual(other)
  })

  it('is inert where vPLCs are not targeted (the desktop)', async () => {
    const store = createTestStore()
    loadProjectWithTarget(store)
    const list = jest.fn(() => Promise.resolve(listing))

    renderHook(() => useRestoreProjectTargetDevice(), {
      wrapper: createStoreWrapper(store, makePorts(list, EDITOR_CAPABILITIES)),
    })
    await act(async () => {})

    expect(list).not.toHaveBeenCalled()
    expect(store.getState().runtimeConnection.selectedDevice).toBeNull()
  })
})
