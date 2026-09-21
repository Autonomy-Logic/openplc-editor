import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockOpenModal = jest.fn()
const mockSetRuntimeConnectionStatus = jest.fn((status: string) => {
  ;(mockState.runtimeConnection as { connectionStatus: string }).connectionStatus = status
})
const mockSetRuntimeJwtToken = jest.fn()
const mockClearDeviceLicense = jest.fn()
const mockSetRuntimeVersion = jest.fn()

/** The status the store ended up in — what the Connect button actually reads. */
const currentStatus = (): string => (mockState.runtimeConnection as { connectionStatus: string }).connectionStatus

type SelectedDevice = { orchestratorAgentId: string; deviceId: string } | null

const mockState: Record<string, unknown> = {
  deviceDefinitions: { configuration: { deviceBoard: 'OpenPLC Runtime v4', runtimeIpAddress: '192.168.0.2' } },
  runtimeConnection: { connectionStatus: 'disconnected', selectedDevice: null as SelectedDevice },
  modalActions: { openModal: mockOpenModal },
  deviceActions: {
    setRuntimeConnectionStatus: mockSetRuntimeConnectionStatus,
    setRuntimeJwtToken: mockSetRuntimeJwtToken,
    clearDeviceLicense: mockClearDeviceLicense,
    setRuntimeVersion: mockSetRuntimeVersion,
  },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

const mockGetUsersInfo = jest.fn()
const mockClearCredentials = jest.fn().mockResolvedValue(undefined)
const mockSetDeviceContext = jest.fn()
const mockCloseRuntimeSession = jest.fn().mockResolvedValue(undefined)
const mockValidateRuntimeVersion = jest.fn()

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('@root/middleware/shared/providers/platform-context', () => ({
  useRuntime: () => ({
    getUsersInfo: mockGetUsersInfo,
    clearCredentials: mockClearCredentials,
    setDeviceContext: mockSetDeviceContext,
  }),
  useDevice: () => ({ closeRuntimeSession: mockCloseRuntimeSession }),
}))
jest.mock('../../utils/device', () => ({
  validateRuntimeVersion: (...args: unknown[]) => mockValidateRuntimeVersion(...args),
}))

import { useRuntimeConnect } from '../use-runtime-connect'

const setup = () => renderHook(() => useRuntimeConnect()).result.current

beforeEach(() => {
  jest.clearAllMocks()
  mockState.deviceDefinitions = {
    configuration: { deviceBoard: 'OpenPLC Runtime v4', runtimeIpAddress: '192.168.0.2' },
  }
  mockState.runtimeConnection = { connectionStatus: 'disconnected', selectedDevice: null }
  mockGetUsersInfo.mockResolvedValue({ hasUsers: true, runtimeVersion: '4.2.0' })
  mockValidateRuntimeVersion.mockReturnValue({ status: 'ok' })
})

describe('useRuntimeConnect — connecting', () => {
  it('raises the login modal when the runtime already has users', async () => {
    await setup().connect()
    expect(currentStatus()).toBe('connecting')
    expect(mockOpenModal).toHaveBeenCalledWith('runtime-login', null)
  })

  it('raises the first-user modal when the runtime has none', async () => {
    mockGetUsersInfo.mockResolvedValue({ hasUsers: false, runtimeVersion: '4.2.0' })
    await setup().connect()
    expect(mockOpenModal).toHaveBeenCalledWith('runtime-create-user', null)
  })

  it('remembers the runtime version for version-gated UI', async () => {
    await setup().connect()
    expect(mockSetRuntimeVersion).toHaveBeenCalledWith('4.2.0')
  })

  it('reports an error instead of a modal when getUsersInfo fails', async () => {
    mockGetUsersInfo.mockResolvedValue({ error: 'unreachable' })
    await setup().connect()
    expect(currentStatus()).toBe('error')
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('reports an error when the call throws', async () => {
    mockGetUsersInfo.mockRejectedValue(new Error('boom'))
    await setup().connect()
    expect(currentStatus()).toBe('error')
  })

  it('is a no-op when already connected', async () => {
    ;(mockState.runtimeConnection as { connectionStatus: string }).connectionStatus = 'connected'
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
    mockState.runtimeConnection = {
      connectionStatus: 'disconnected',
      selectedDevice: { orchestratorAgentId: 'agent-1', deviceId: 'dev-9' },
    }
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
    mockState.deviceDefinitions = { configuration: { deviceBoard: 'OpenPLC Runtime v4', runtimeIpAddress: '' } }
    mockState.runtimeConnection = {
      connectionStatus: 'disconnected',
      selectedDevice: { orchestratorAgentId: 'agent-1', deviceId: 'dev-9' },
    }
    await setup().connect()
    expect(mockGetUsersInfo).toHaveBeenCalled()
  })

  it('stops when there is neither an IP nor a selected device', async () => {
    mockState.deviceDefinitions = { configuration: { deviceBoard: 'OpenPLC Runtime v4', runtimeIpAddress: '' } }
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
    expect(mockOpenModal).toHaveBeenCalledWith(
      'debugger-message',
      expect.objectContaining({ type: 'error', title: 'Runtime Version Mismatch' }),
    )
    expect(mockOpenModal).not.toHaveBeenCalledWith('runtime-login', null)
  })

  it('offers to continue past an undetectable version, and logs in on "Continue Anyway"', async () => {
    mockValidateRuntimeVersion.mockReturnValue({ status: 'missing', message: 'no version header' })
    await setup().connect()

    const [, payload] = mockOpenModal.mock.calls[0] as [string, { buttons: string[]; onResponse: (i: number) => void }]
    expect(payload.buttons).toEqual(['Continue Anyway', 'Cancel'])

    payload.onResponse(0)
    expect(mockOpenModal).toHaveBeenCalledWith('runtime-login', null)
  })

  it('stays disconnected when that offer is declined', async () => {
    mockValidateRuntimeVersion.mockReturnValue({ status: 'missing' })
    await setup().connect()

    const [, payload] = mockOpenModal.mock.calls[0] as [string, { onResponse: (i: number) => void }]
    payload.onResponse(1)
    expect(currentStatus()).toBe('disconnected')
    expect(mockOpenModal).not.toHaveBeenCalledWith('runtime-login', null)
  })
})

// A deliberate disconnect drops everything the session owned: the token, any
// debug channel opened off it, and the licence badge — leaving the badge would
// assert possession of hardware nothing is talking to.
describe('useRuntimeConnect — toggle off', () => {
  beforeEach(() => {
    ;(mockState.runtimeConnection as { connectionStatus: string }).connectionStatus = 'connected'
  })

  it('drops the token, the credentials, the session and the licence', async () => {
    await setup().toggle()
    expect(mockSetRuntimeJwtToken).toHaveBeenCalledWith(null)
    expect(currentStatus()).toBe('disconnected')
    expect(mockClearCredentials).toHaveBeenCalled()
    expect(mockCloseRuntimeSession).toHaveBeenCalled()
    expect(mockClearDeviceLicense).toHaveBeenCalled()
    expect(mockGetUsersInfo).not.toHaveBeenCalled()
  })
})
