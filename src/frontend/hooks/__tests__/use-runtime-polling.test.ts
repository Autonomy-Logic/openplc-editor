import { renderHook } from '@testing-library/react'

// The `mock*` prefix lets ts-jest hoist these references into the
// `jest.mock` factories below — Jest reuses the same babel-plugin-jest
// rule Vitest's `vi.hoisted` was originally written against. Spelled out
// long-hand (no Vitest API) so the suite runs under plain Jest.
const mockSetPlcRuntimeStatus = jest.fn()
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
} = {
  getStatus: jest.fn(),
  getLogs: jest.fn(),
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
