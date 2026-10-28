import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BootloaderPort, RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, renderHook } from '@testing-library/react'

import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useRuntimePolling } from '../use-runtime-polling'

// Mirrors the hook's own constant; the test has to cross it to reach the
// connection-lost path at all.
const MAX_CONSECUTIVE_FAILURES = 5

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
      getStatus: (includeTimingStats) => mockRuntime.getStatus(includeTimingStats),
      getLogs: (minId) => mockRuntime.getLogs(minId),
      get getEthercatRuntimeStatus() {
        return mockRuntime.getEthercatRuntimeStatus
      },
      bootloader: stubPort<BootloaderPort>({ getUpdateProgress: () => mockRuntime.bootloader.getUpdateProgress() }),
    }),
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
    capabilities: WEB_CAPABILITIES,
  }
}

let store: OpenPLCStore

/** Immer freezes the action namespaces, so spies go in as a swapped, write-through copy. */
function installActionSpies() {
  const { modalActions, deviceActions } = store.getState()
  const spies = {
    openModal: jest.fn(modalActions.openModal),
    setPlcRuntimeStatus: jest.fn(deviceActions.setPlcRuntimeStatus),
    setEthercatStatus: jest.fn(deviceActions.setEthercatStatus),
  }
  store.setState({
    modalActions: { ...modalActions, openModal: spies.openModal },
    deviceActions: {
      ...deviceActions,
      setPlcRuntimeStatus: spies.setPlcRuntimeStatus,
      setEthercatStatus: spies.setEthercatStatus,
    },
  })
  return spies
}

let spies: ReturnType<typeof installActionSpies>

/** A connected runtime with a token: the only state in which the hook polls. */
function connectRuntime(opts: { includeEthercat?: boolean } = {}) {
  store = createTestStore()
  const { deviceActions } = store.getState()
  deviceActions.setRuntimeJwtToken('tok')
  deviceActions.setRuntimeConnectionStatus('connected')
  deviceActions.setIncludeTimingStatsInPolling(false)
  deviceActions.setIncludeEthercatStatsInPolling(opts.includeEthercat ?? false)
  spies = installActionSpies()
}

function renderPolling() {
  return renderHook(() => useRuntimePolling(), { wrapper: createStoreWrapper(store, buildPorts()) })
}

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
    connectRuntime()
  })

  it('clears stored ethercat status when the polling flag is off', async () => {
    store.getState().deviceActions.setIncludeEthercatStatsInPolling(false)
    mockRuntime.getEthercatRuntimeStatus = jest.fn().mockResolvedValue({ success: true, data: { masters: [] } })

    renderPolling()
    await flushAll()

    // setEthercatStatus(null) is the soft-clear when the flag is off.
    expect(spies.setEthercatStatus).toHaveBeenCalledWith(null)
    // The optional method is gated by the flag too — it shouldn't even be invoked.
    expect(mockRuntime.getEthercatRuntimeStatus).not.toHaveBeenCalled()
  })

  it('skips cleanly when the optional getEthercatRuntimeStatus method is not on the runtime', async () => {
    store.getState().deviceActions.setIncludeEthercatStatsInPolling(true)
    mockRuntime.getEthercatRuntimeStatus = undefined

    renderPolling()
    await flushAll()

    // No data write — the soft-fail branch keeps whatever was in the store.
    expect(spies.setEthercatStatus).not.toHaveBeenCalled()
    // status path still ran successfully so the rest of the cycle isn't disturbed.
    expect(spies.setPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
  })

  it('writes the runtime payload into the store on a successful ethercat poll', async () => {
    store.getState().deviceActions.setIncludeEthercatStatsInPolling(true)
    const payload = { masters: [{ name: 'BusA', plugin_state: 'OPERATIONAL' }] }
    mockRuntime.getEthercatRuntimeStatus = jest.fn().mockResolvedValue({ success: true, data: payload })

    renderPolling()
    await flushAll()

    expect(mockRuntime.getEthercatRuntimeStatus).toHaveBeenCalledTimes(1)
    expect(spies.setEthercatStatus).toHaveBeenCalledWith(payload)
  })

  it('does not tear down the connection on a transient ethercat rejection', async () => {
    store.getState().deviceActions.setIncludeEthercatStatsInPolling(true)
    mockRuntime.getEthercatRuntimeStatus = jest.fn().mockRejectedValue(new Error('boom'))

    renderPolling()
    await flushAll()

    // status path still wrote — meaning Promise.all didn't reject.
    expect(spies.setPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
    // Soft-fail keeps prior data; setEthercatStatus is not called with anything.
    expect(spies.setEthercatStatus).not.toHaveBeenCalled()
    // No connection-lost modal opened.
    expect(spies.openModal).not.toHaveBeenCalled()
  })
})

describe('useRuntimePolling — while the runtime is being replaced', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRuntime.getStatus.mockResolvedValue({ success: true, status: 'RUNNING' })
    mockRuntime.getLogs.mockResolvedValue({ success: true, logs: [] })
    mockRuntime.getEthercatRuntimeStatus = undefined
    mockRuntime.bootloader.getUpdateProgress.mockResolvedValue({ success: false, error: 'idle' })
    connectRuntime()
    const { deviceActions } = store.getState()
    deviceActions.setRuntimeUpdateInProgress(false)
    deviceActions.setSelectedDevice({
      orchestratorId: 'orch-1',
      orchestratorAgentId: 'agent-1',
      deviceId: 'dev-1',
      deviceName: '192.168.2.4',
    })
    deviceActions.setRuntimeIpAddress('192.168.1.112')
  })

  it('stands down while a version change is in flight', async () => {
    // The runtime is stopped and its container replaced during an update, so
    // its silence is the expected state, not a fault. Polling through it
    // counted the gap as failures and announced a lost connection in the
    // middle of an update that was working.
    store.getState().deviceActions.setRuntimeUpdateInProgress(true)

    renderPolling()
    await flushAll()

    expect(mockRuntime.getStatus).not.toHaveBeenCalled()
    expect(spies.openModal).not.toHaveBeenCalled()
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
    jest.useFakeTimers()
    try {
      renderPolling()
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
    expect(spies.openModal).toHaveBeenCalled()
    const [id, data] = spies.openModal.mock.calls[spies.openModal.mock.calls.length - 1]
    expect(id).toBe('runtime-connection-lost')
    expect(data).not.toBeNull()
    expect(data).toHaveProperty('label', '192.168.2.4')
  })
})
