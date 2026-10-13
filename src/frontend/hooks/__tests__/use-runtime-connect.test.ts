import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { renderHook } from '@testing-library/react'

jest.mock('../../utils/device', () => ({
  validateRuntimeVersion: (...args: unknown[]) => mockValidateRuntimeVersion(...args),
}))

import type { OpenPLCStore } from '../../store'
import type { SelectedDevice } from '../../store/slices/device/types'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useRuntimeConnect } from '../use-runtime-connect'

const mockGetUsersInfo = jest.fn()
const mockClearCredentials = jest.fn().mockResolvedValue(undefined)
const mockSetDeviceContext = jest.fn()
const mockCloseRuntimeSession = jest.fn().mockResolvedValue(undefined)
const mockValidateRuntimeVersion = jest.fn()

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
      getUsersInfo: mockGetUsersInfo,
      clearCredentials: mockClearCredentials,
      setDeviceContext: mockSetDeviceContext,
    }),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort<DevicePort>({ closeRuntimeSession: mockCloseRuntimeSession }),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: WEB_CAPABILITIES,
  }
}

const SELECTED: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-9',
  deviceName: 'Line A',
}

let store: OpenPLCStore

/** Immer freezes the action namespaces, so spies go in as a swapped, write-through copy. */
function installActionSpies() {
  const { modalActions, deviceActions } = store.getState()
  const spies = {
    openModal: jest.fn(modalActions.openModal),
    setRuntimeJwtToken: jest.fn(deviceActions.setRuntimeJwtToken),
    clearDeviceLicense: jest.fn(deviceActions.clearDeviceLicense),
    setRuntimeVersion: jest.fn(deviceActions.setRuntimeVersion),
  }
  store.setState({
    modalActions: { ...modalActions, openModal: spies.openModal },
    deviceActions: {
      ...deviceActions,
      setRuntimeJwtToken: spies.setRuntimeJwtToken,
      clearDeviceLicense: spies.clearDeviceLicense,
      setRuntimeVersion: spies.setRuntimeVersion,
    },
  })
  return spies
}

let spies: ReturnType<typeof installActionSpies>

/** The status the store ended up in — what the Connect button actually reads. */
const currentStatus = (): string => store.getState().runtimeConnection.connectionStatus

const setup = () =>
  renderHook(() => useRuntimeConnect(), { wrapper: createStoreWrapper(store, buildPorts()) }).result.current

beforeEach(() => {
  jest.clearAllMocks()
  store = createTestStore()
  store.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')
  store.getState().deviceActions.setRuntimeIpAddress('192.168.0.2')
  spies = installActionSpies()
  mockGetUsersInfo.mockResolvedValue({ hasUsers: true, runtimeVersion: '4.2.0' })
  mockValidateRuntimeVersion.mockReturnValue({ status: 'ok' })
})

describe('useRuntimeConnect — connecting', () => {
  it('raises the login modal when the runtime already has users', async () => {
    await setup().connect()
    expect(currentStatus()).toBe('connecting')
    expect(spies.openModal).toHaveBeenCalledWith('runtime-login', null)
  })

  it('raises the first-user modal when the runtime has none', async () => {
    mockGetUsersInfo.mockResolvedValue({ hasUsers: false, runtimeVersion: '4.2.0' })
    await setup().connect()
    expect(spies.openModal).toHaveBeenCalledWith('runtime-create-user', null)
  })

  it('remembers the runtime version for version-gated UI', async () => {
    await setup().connect()
    expect(spies.setRuntimeVersion).toHaveBeenCalledWith('4.2.0')
  })

  it('reports an error instead of a modal when getUsersInfo fails', async () => {
    mockGetUsersInfo.mockResolvedValue({ error: 'unreachable' })
    await setup().connect()
    expect(currentStatus()).toBe('error')
    expect(spies.openModal).not.toHaveBeenCalled()
  })

  it('reports an error when the call throws', async () => {
    mockGetUsersInfo.mockRejectedValue(new Error('boom'))
    await setup().connect()
    expect(currentStatus()).toBe('error')
  })

  it('is a no-op when already connected', async () => {
    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    await setup().connect()
    expect(mockGetUsersInfo).not.toHaveBeenCalled()
  })
})

// Web reaches a device through the orchestrator, so the adapter has to be told
// WHICH device before anything is asked of it. Extracting the connect without
// this left getUsersInfo addressed at nothing: the status went to 'error' and no
// login modal ever appeared.
describe('useRuntimeConnect — device context', () => {
  it('addresses the selected device before asking the runtime anything', async () => {
    store.getState().deviceActions.setSelectedDevice(SELECTED)
    await setup().connect()
    expect(mockSetDeviceContext).toHaveBeenCalledWith({ agentId: 'agent-1', deviceId: 'dev-9' })
    expect(mockSetDeviceContext.mock.invocationCallOrder[0]).toBeLessThan(mockGetUsersInfo.mock.invocationCallOrder[0])
  })

  it('sets no context on the desktop path, which addresses an IP directly', async () => {
    await setup().connect()
    expect(mockSetDeviceContext).not.toHaveBeenCalled()
    expect(mockGetUsersInfo).toHaveBeenCalled()
  })

  it('connects with no IP when a device is selected — web carries no runtimeIpAddress', async () => {
    store.getState().deviceActions.setRuntimeIpAddress('')
    store.getState().deviceActions.setSelectedDevice(SELECTED)
    await setup().connect()
    expect(mockGetUsersInfo).toHaveBeenCalled()
  })

  it('stops when there is neither an IP nor a selected device', async () => {
    store.getState().deviceActions.setRuntimeIpAddress('')
    await setup().connect()
    expect(mockGetUsersInfo).not.toHaveBeenCalled()
    expect(currentStatus()).toBe('disconnected')
  })
})

describe('useRuntimeConnect — version validation', () => {
  it('refuses a mismatched runtime and explains why', async () => {
    mockValidateRuntimeVersion.mockReturnValue({ status: 'mismatch', message: 'v3 runtime, v4 target' })
    await setup().connect()
    expect(currentStatus()).toBe('error')
    expect(spies.openModal).toHaveBeenCalledWith(
      'debugger-message',
      expect.objectContaining({ type: 'error', title: 'Runtime Version Mismatch' }),
    )
    expect(spies.openModal).not.toHaveBeenCalledWith('runtime-login', null)
  })

  it('offers to continue past an undetectable version, and logs in on "Continue Anyway"', async () => {
    mockValidateRuntimeVersion.mockReturnValue({ status: 'missing', message: 'no version header' })
    await setup().connect()

    const [, payload] = spies.openModal.mock.calls[0] as [
      string,
      { buttons: string[]; onResponse: (i: number) => void },
    ]
    expect(payload.buttons).toEqual(['Continue Anyway', 'Cancel'])

    payload.onResponse(0)
    expect(spies.openModal).toHaveBeenCalledWith('runtime-login', null)
  })

  it('stays disconnected when that offer is declined', async () => {
    mockValidateRuntimeVersion.mockReturnValue({ status: 'missing' })
    await setup().connect()

    const [, payload] = spies.openModal.mock.calls[0] as [string, { onResponse: (i: number) => void }]
    payload.onResponse(1)
    expect(currentStatus()).toBe('disconnected')
    expect(spies.openModal).not.toHaveBeenCalledWith('runtime-login', null)
  })
})

// A deliberate disconnect drops everything the session owned: the token, any
// debug channel opened off it, and the licence badge — leaving the badge would
// assert possession of hardware nothing is talking to.
describe('useRuntimeConnect — toggle off', () => {
  beforeEach(() => {
    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
  })

  it('drops the token, the credentials, the session and the licence', async () => {
    await setup().toggle()
    expect(spies.setRuntimeJwtToken).toHaveBeenCalledWith(null)
    expect(currentStatus()).toBe('disconnected')
    expect(mockClearCredentials).toHaveBeenCalled()
    expect(mockCloseRuntimeSession).toHaveBeenCalled()
    expect(spies.clearDeviceLicense).toHaveBeenCalled()
    expect(mockGetUsersInfo).not.toHaveBeenCalled()
  })
})
