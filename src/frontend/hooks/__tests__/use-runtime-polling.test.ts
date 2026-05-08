import { renderHook } from '@testing-library/react'

const storeMocks = vi.hoisted(() => {
  const setPlcRuntimeStatus = vi.fn()
  const setTimingStats = vi.fn()
  const setEthercatStatus = vi.fn()
  const setRuntimeJwtToken = vi.fn()
  const setRuntimeConnectionStatus = vi.fn()
  const openModal = vi.fn()
  const setPlcLogsVisible = vi.fn()
  const setPlcLogs = vi.fn()
  const appendPlcLogs = vi.fn()
  const setPlcLogsLastId = vi.fn()
  const clearPlcLogs = vi.fn()

  const state: Record<string, unknown> = {
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
      setPlcRuntimeStatus,
      setTimingStats,
      setEthercatStatus,
      setRuntimeJwtToken,
      setRuntimeConnectionStatus,
    },
    modalActions: { openModal },
    workspaceActions: { setPlcLogsVisible, setPlcLogs, appendPlcLogs, setPlcLogsLastId, clearPlcLogs },
  }

  type Selector<T> = (s: typeof state) => T
  const useOpenPLCStore = ((selector?: Selector<unknown>) => (selector ? selector(state) : state)) as ReturnType<
    typeof vi.fn
  > & { getState: () => typeof state }
  useOpenPLCStore.getState = () => state

  return {
    state,
    useOpenPLCStore,
    setPlcRuntimeStatus,
    setTimingStats,
    setEthercatStatus,
    openModal,
    setPlcLogs,
    appendPlcLogs,
    clearPlcLogs,
    setPlcLogsVisible,
  }
})

vi.mock('../../store', () => ({
  useOpenPLCStore: storeMocks.useOpenPLCStore,
}))

const runtimeMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getLogs: vi.fn(),
  getEthercatRuntimeStatus: undefined as undefined | ReturnType<typeof vi.fn>,
}))

vi.mock('../../../middleware/shared/providers', () => ({
  useRuntime: () => runtimeMocks,
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
    vi.clearAllMocks()
    // Default: status/logs succeed, ethercat off, no method on runtime.
    runtimeMocks.getStatus.mockResolvedValue({ success: true, status: 'RUNNING' })
    runtimeMocks.getLogs.mockResolvedValue({ success: true, logs: [] })
    runtimeMocks.getEthercatRuntimeStatus = undefined
    Object.assign(storeMocks.state.runtimeConnection as object, {
      connectionStatus: 'connected',
      jwtToken: 'tok',
      includeTimingStatsInPolling: false,
      includeEthercatStatsInPolling: false,
    })
  })

  it('clears stored ethercat status when the polling flag is off', async () => {
    Object.assign(storeMocks.state.runtimeConnection as object, { includeEthercatStatsInPolling: false })
    runtimeMocks.getEthercatRuntimeStatus = vi.fn().mockResolvedValue({ success: true, data: { masters: [] } })

    renderHook(() => useRuntimePolling())
    await flushAll()

    // setEthercatStatus(null) is the soft-clear when the flag is off.
    expect(storeMocks.setEthercatStatus).toHaveBeenCalledWith(null)
    // The optional method is gated by the flag too — it shouldn't even be invoked.
    expect(runtimeMocks.getEthercatRuntimeStatus).not.toHaveBeenCalled()
  })

  it('skips cleanly when the optional getEthercatRuntimeStatus method is not on the runtime', async () => {
    Object.assign(storeMocks.state.runtimeConnection as object, { includeEthercatStatsInPolling: true })
    runtimeMocks.getEthercatRuntimeStatus = undefined

    renderHook(() => useRuntimePolling())
    await flushAll()

    // No data write — the soft-fail branch keeps whatever was in the store.
    expect(storeMocks.setEthercatStatus).not.toHaveBeenCalled()
    // status path still ran successfully so the rest of the cycle isn't disturbed.
    expect(storeMocks.setPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
  })

  it('writes the runtime payload into the store on a successful ethercat poll', async () => {
    Object.assign(storeMocks.state.runtimeConnection as object, { includeEthercatStatsInPolling: true })
    const payload = { masters: [{ name: 'BusA', plugin_state: 'OPERATIONAL' }] }
    runtimeMocks.getEthercatRuntimeStatus = vi.fn().mockResolvedValue({ success: true, data: payload })

    renderHook(() => useRuntimePolling())
    await flushAll()

    expect(runtimeMocks.getEthercatRuntimeStatus).toHaveBeenCalledTimes(1)
    expect(storeMocks.setEthercatStatus).toHaveBeenCalledWith(payload)
  })

  it('does not tear down the connection on a transient ethercat rejection', async () => {
    Object.assign(storeMocks.state.runtimeConnection as object, { includeEthercatStatsInPolling: true })
    runtimeMocks.getEthercatRuntimeStatus = vi.fn().mockRejectedValue(new Error('boom'))

    renderHook(() => useRuntimePolling())
    await flushAll()

    // status path still wrote — meaning Promise.all didn't reject.
    expect(storeMocks.setPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
    // Soft-fail keeps prior data; setEthercatStatus is not called with anything.
    expect(storeMocks.setEthercatStatus).not.toHaveBeenCalled()
    // No connection-lost modal opened.
    expect(storeMocks.openModal).not.toHaveBeenCalled()
  })
})
