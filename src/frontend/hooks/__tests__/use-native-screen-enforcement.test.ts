import { renderHook, waitFor } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockAddLog = jest.fn()
const mockGetRetainConfig = jest.fn()
const mockUpdateRetainConfig = jest.fn()

const mockState: Record<string, unknown> = {
  consoleActions: { addLog: mockAddLog },
  runtimeConnection: { connectionStatus: 'connected', runtimeVersion: 'v4.2.0' },
  deviceDefinitions: { configuration: { deviceBoard: 'SLM-RP4' } },
  deviceAvailableOptions: { availableBoards: new Map() },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('../../../middleware/shared/providers', () => ({
  useRuntime: () => ({
    getRetainConfig: mockGetRetainConfig,
    updateRetainConfig: mockUpdateRetainConfig,
  }),
}))

import { useNativeScreenEnforcement } from '../use-native-screen-enforcement'

/** A board whose VPP declares that it replaces the persistent-storage screen. */
const hidingBoard = () => new Map([['SLM-RP4', { vpp: { hidesNativeScreens: ['persistent-storage'] } }]]) as never

const plainBoard = () => new Map([['SLM-RP4', { vpp: {} }]]) as never

beforeEach(() => {
  jest.clearAllMocks()
  mockGetRetainConfig.mockResolvedValue({ success: true, config: { enabled: true } })
  mockUpdateRetainConfig.mockResolvedValue({ success: true, config: { enabled: false } })
  mockState.runtimeConnection = { connectionStatus: 'connected', runtimeVersion: 'v4.2.0' }
  mockState.deviceAvailableOptions = { availableBoards: hidingBoard() }
})

describe('useNativeScreenEnforcement', () => {
  it('switches the native store off when the target replaces it', async () => {
    renderHook(() => useNativeScreenEnforcement())
    await waitFor(() => expect(mockUpdateRetainConfig).toHaveBeenCalledWith({ enabled: false }))
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', message: expect.stringContaining('switched off') }),
    )
  })

  it('leaves a device alone when the store was already off', async () => {
    // Idempotent: no redundant PUT on every reconnect.
    mockGetRetainConfig.mockResolvedValue({ success: true, config: { enabled: false } })
    renderHook(() => useNativeScreenEnforcement())
    await waitFor(() => expect(mockGetRetainConfig).toHaveBeenCalled())
    expect(mockUpdateRetainConfig).not.toHaveBeenCalled()
  })

  it('does nothing for a target that does not replace the screen', () => {
    mockState.deviceAvailableOptions = { availableBoards: plainBoard() }
    renderHook(() => useNativeScreenEnforcement())
    expect(mockGetRetainConfig).not.toHaveBeenCalled()
  })

  it('does nothing while disconnected', () => {
    mockState.runtimeConnection = { connectionStatus: 'disconnected', runtimeVersion: 'v4.2.0' }
    renderHook(() => useNativeScreenEnforcement())
    expect(mockGetRetainConfig).not.toHaveBeenCalled()
  })

  it('does nothing on a runtime with no built-in store to switch off', () => {
    mockState.runtimeConnection = { connectionStatus: 'connected', runtimeVersion: 'v4.1.10' }
    renderHook(() => useNativeScreenEnforcement())
    expect(mockGetRetainConfig).not.toHaveBeenCalled()
  })

  it('warns loudly when it could not switch the store off', async () => {
    // The one outcome the operator must not miss: two stores may now be live,
    // and the screen that would have shown it is hidden.
    mockUpdateRetainConfig.mockResolvedValue({ success: false, error: 'Admin privileges required' })
    renderHook(() => useNativeScreenEnforcement())
    await waitFor(() =>
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('Two stores may now be active'),
        }),
      ),
    )
  })

  it('does not blind-write when it could not read the current setting', async () => {
    mockGetRetainConfig.mockResolvedValue({ success: false, error: 'unreachable' })
    renderHook(() => useNativeScreenEnforcement())
    await waitFor(() => expect(mockGetRetainConfig).toHaveBeenCalled())
    expect(mockUpdateRetainConfig).not.toHaveBeenCalled()
    expect(mockAddLog).not.toHaveBeenCalled()
  })

  it('tries once per target rather than on every render', async () => {
    const { rerender } = renderHook(() => useNativeScreenEnforcement())
    await waitFor(() => expect(mockUpdateRetainConfig).toHaveBeenCalledTimes(1))
    rerender()
    rerender()
    expect(mockGetRetainConfig).toHaveBeenCalledTimes(1)
  })
})
