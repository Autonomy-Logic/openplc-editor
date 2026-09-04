import { act, renderHook } from '@testing-library/react'

// Mirrors the hook's own constant; the test has to cross it to reach the
// connection-lost path at all.
const MAX_CONSECUTIVE_FAILURES = 5

// The `mock*` prefix lets ts-jest hoist these references into the
// `jest.mock` factories below — Jest reuses the same babel-plugin-jest
// rule Vitest's `vi.hoisted` was originally written against. Spelled out
// long-hand (no Vitest API) so the suite runs under plain Jest.
const mockSetPlcRuntimeStatus = jest.fn()
const mockSetPlcSwitchPosition = jest.fn()
const mockSetTimingStats = jest.fn()
const mockSetEthercatStatus = jest.fn()
const mockSetRuntimeJwtToken = jest.fn()
const mockSetRuntimeConnectionStatus = jest.fn()
const mockOpenModal = jest.fn()
const mockSetPlcLogsVisible = jest.fn()
const mockSetPlcLogs = jest.fn()
const mockAppendPlcLogs = jest.fn()
const mockSetPlcLogsLastId = jest.fn()
const mockClearPlcLogs = jest.fn()

const mockState: Record<string, unknown> = {
  runtimeConnection: {
    connectionStatus: 'connected',
    jwtToken: 'tok',
    includeTimingStatsInPolling: false,
    includeEthercatStatsInPolling: false,
    plcStatus: null,
    ethercatStatus: null,
  },
  workspace: { plcLogs: '', plcLogsLastId: null },
  deviceActions: {
    setPlcRuntimeStatus: mockSetPlcRuntimeStatus,
    setPlcSwitchPosition: mockSetPlcSwitchPosition,
    setTimingStats: mockSetTimingStats,
    setEthercatStatus: mockSetEthercatStatus,
    setRuntimeJwtToken: mockSetRuntimeJwtToken,
    setRuntimeConnectionStatus: mockSetRuntimeConnectionStatus,
  },
  modalActions: { openModal: mockOpenModal },
  workspaceActions: {
    setPlcLogsVisible: mockSetPlcLogsVisible,
    setPlcLogs: mockSetPlcLogs,
    appendPlcLogs: mockAppendPlcLogs,
    setPlcLogsLastId: mockSetPlcLogsLastId,
    clearPlcLogs: mockClearPlcLogs,
  },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

const mockRuntime: {
  getStatus: jest.Mock
  getLogs: jest.Mock
  getEthercatRuntimeStatus: undefined | jest.Mock
  // The hook asks the bootloader whether a version change has finished, so it
  // can lower the flag that suspends connection-lost detection.
  bootloader: { getUpdateProgress: jest.Mock }
} = {
  getStatus: jest.fn(),
  getLogs: jest.fn(),
  bootloader: { getUpdateProgress: jest.fn() },
  getEthercatRuntimeStatus: undefined,
}

jest.mock('../../store', () => ({
  useOpenPLCStore: mockUseOpenPLCStore,
}))

jest.mock('../../../middleware/shared/providers', () => ({
  useRuntime: () => mockRuntime,
}))

import { useRuntimePolling } from '../use-runtime-polling'

const flushAll = async () => {
  // Two ticks: poll schedules a Promise.all; status/logs/ethercat resolve, then
  // the consumer's downstream `.then` chain runs.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useRuntimePolling — EtherCAT branches', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: status/logs succeed, ethercat off, no method on runtime.
    mockRuntime.getStatus.mockResolvedValue({ success: true, status: 'RUNNING' })
    mockRuntime.getLogs.mockResolvedValue({ success: true, logs: [] })
    mockRuntime.getEthercatRuntimeStatus = undefined
    Object.assign(mockState.runtimeConnection as object, {
      connectionStatus: 'connected',
      jwtToken: 'tok',
      includeTimingStatsInPolling: false,
      includeEthercatStatsInPolling: false,
    })
  })

  it('clears stored ethercat status when the polling flag is off', async () => {
    Object.assign(mockState.runtimeConnection as object, { includeEthercatStatsInPolling: false })
    mockRuntime.getEthercatRuntimeStatus = jest.fn().mockResolvedValue({ success: true, data: { masters: [] } })

    renderHook(() => useRuntimePolling())
    await flushAll()

    // setEthercatStatus(null) is the soft-clear when the flag is off.
    expect(mockSetEthercatStatus).toHaveBeenCalledWith(null)
    // The optional method is gated by the flag too — it shouldn't even be invoked.
    expect(mockRuntime.getEthercatRuntimeStatus).not.toHaveBeenCalled()
  })

  it('skips cleanly when the optional getEthercatRuntimeStatus method is not on the runtime', async () => {
    Object.assign(mockState.runtimeConnection as object, { includeEthercatStatsInPolling: true })
    mockRuntime.getEthercatRuntimeStatus = undefined

    renderHook(() => useRuntimePolling())
    await flushAll()

    // No data write — the soft-fail branch keeps whatever was in the store.
    expect(mockSetEthercatStatus).not.toHaveBeenCalled()
    // status path still ran successfully so the rest of the cycle isn't disturbed.
    expect(mockSetPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
  })

  it('writes the runtime payload into the store on a successful ethercat poll', async () => {
    Object.assign(mockState.runtimeConnection as object, { includeEthercatStatsInPolling: true })
    const payload = { masters: [{ name: 'BusA', plugin_state: 'OPERATIONAL' }] }
    mockRuntime.getEthercatRuntimeStatus = jest.fn().mockResolvedValue({ success: true, data: payload })

    renderHook(() => useRuntimePolling())
    await flushAll()

    expect(mockRuntime.getEthercatRuntimeStatus).toHaveBeenCalledTimes(1)
    expect(mockSetEthercatStatus).toHaveBeenCalledWith(payload)
  })

  it('does not tear down the connection on a transient ethercat rejection', async () => {
    Object.assign(mockState.runtimeConnection as object, { includeEthercatStatsInPolling: true })
    mockRuntime.getEthercatRuntimeStatus = jest.fn().mockRejectedValue(new Error('boom'))

    renderHook(() => useRuntimePolling())
    await flushAll()

    // status path still wrote — meaning Promise.all didn't reject.
    expect(mockSetPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
    // Soft-fail keeps prior data; setEthercatStatus is not called with anything.
    expect(mockSetEthercatStatus).not.toHaveBeenCalled()
    // No connection-lost modal opened.
    expect(mockOpenModal).not.toHaveBeenCalled()
  })
})

describe('useRuntimePolling — while the runtime is being replaced', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRuntime.getStatus.mockResolvedValue({ success: true, status: 'RUNNING' })
    mockRuntime.getLogs.mockResolvedValue({ success: true, logs: [] })
    mockRuntime.getEthercatRuntimeStatus = undefined
    mockRuntime.bootloader.getUpdateProgress.mockResolvedValue({ success: false, error: 'idle' })
    Object.assign(mockState.runtimeConnection as object, {
      connectionStatus: 'connected',
      jwtToken: 'tok',
      includeTimingStatsInPolling: false,
      includeEthercatStatsInPolling: false,
      runtimeUpdateInProgress: false,
      selectedDevice: { deviceName: '192.168.2.4' },
      ipAddress: '192.168.1.112',
    })
  })

  it('stands down while a version change is in flight', async () => {
    // The runtime is stopped and its container replaced during an update, so
    // its silence is the expected state, not a fault. Polling through it
    // counted the gap as failures and announced a lost connection in the
    // middle of an update that was working.
    Object.assign(mockState.runtimeConnection as object, { runtimeUpdateInProgress: true })

    renderHook(() => useRuntimePolling())
    await flushAll()

    expect(mockRuntime.getStatus).not.toHaveBeenCalled()
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('names the device when the connection really is lost', async () => {
    // This path passed null, which the modal rendered as the literal
    // "Unknown" -- so every message from it read "The connection to Unknown
    // has been lost".
    mockRuntime.getStatus.mockResolvedValue({ success: false })
    mockRuntime.getLogs.mockResolvedValue({ success: false })

    // The polls happen on a 2s interval, so the clock has to move. Awaiting
    // microtasks in a loop -- what this used to do -- runs the FIRST poll five
    // times over and never reaches the failure threshold, which is why the
    // assertions below were reachable only behind an `if`.
    jest.useFakeTimers();
    try {
      renderHook(() => useRuntimePolling())
      for (let attempt = 0; attempt < MAX_CONSECUTIVE_FAILURES + 1; attempt += 1) {
        await act(async () => {
          jest.advanceTimersByTime(2000)
          await flushAll()
        })
      }
    } finally {
      jest.useRealTimers()
    }

    // Asserted unconditionally. This sat behind `if (calls.length > 0)`, so
    // when the five failing polls never reached handleConnectionLost the test
    // asserted nothing and passed -- it could not regress, and did not prove
    // the label fix it was named for.
    expect(mockOpenModal).toHaveBeenCalled()
    const [id, data] = mockOpenModal.mock.calls[mockOpenModal.mock.calls.length - 1]
    expect(id).toBe('runtime-connection-lost')
    expect(data).not.toBeNull()
    expect(data.label).toBe('192.168.2.4')
  })
})
