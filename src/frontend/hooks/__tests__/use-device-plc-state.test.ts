/**
 * useDevicePlcState — mirrors the held device link's run/stop state into the
 * store. The hook owns no timer; it only translates what the main process
 * already pushes on each liveness tick.
 */
import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { renderHook } from '@testing-library/react'

import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useDevicePlcState } from '../use-device-plc-state'

type PlcStatePush = (payload: { port: string; plcState?: number; switchPosition?: number }) => void

/** Captures the callback the hook subscribes with, so tests can drive it. */
let pushed: PlcStatePush | null = null
const mockUnsubscribe = jest.fn()
let onPlcStateImpl: DevicePort['onPlcState'] = (cb: PlcStatePush) => {
  pushed = cb
  return mockUnsubscribe
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
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort<DevicePort>({ onPlcState: onPlcStateImpl }),
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
  const { deviceActions } = store.getState()
  const spies = {
    setPlcRuntimeStatus: jest.fn(deviceActions.setPlcRuntimeStatus),
    setPlcSwitchPosition: jest.fn(deviceActions.setPlcSwitchPosition),
  }
  store.setState({ deviceActions: { ...deviceActions, ...spies } })
  return spies
}

let spies: ReturnType<typeof installActionSpies>

function renderPlcState() {
  return renderHook(() => useDevicePlcState(), { wrapper: createStoreWrapper(store, buildPorts()) })
}

describe('useDevicePlcState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    store = createTestStore()
    spies = installActionSpies()
    pushed = null
    onPlcStateImpl = (cb: PlcStatePush) => {
      pushed = cb
      return mockUnsubscribe
    }
  })

  it('maps a RUNNING push with the switch in RUN', () => {
    renderPlcState()
    pushed!({ port: '/dev/x', plcState: 1, switchPosition: 1 })

    expect(spies.setPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
    expect(spies.setPlcSwitchPosition).toHaveBeenCalledWith('run')
  })

  it('maps STOPPED with the switch in STOP', () => {
    renderPlcState()
    pushed!({ port: '/dev/x', plcState: 0, switchPosition: 0 })

    expect(spies.setPlcRuntimeStatus).toHaveBeenCalledWith('STOPPED')
    expect(spies.setPlcSwitchPosition).toHaveBeenCalledWith('stop')
  })

  it('maps the ERROR state', () => {
    renderPlcState()
    pushed!({ port: '/dev/x', plcState: 2, switchPosition: 1 })

    expect(spies.setPlcRuntimeStatus).toHaveBeenCalledWith('ERROR')
  })

  it('leaves the status untouched when the firmware reports no state', () => {
    // Firmware predating the run/stop state machine omits the field. Inventing a
    // status would make the button lie, so the hook writes nothing.
    renderPlcState()
    pushed!({ port: '/dev/x' })

    expect(spies.setPlcRuntimeStatus).not.toHaveBeenCalled()
    // ...and the switch reads as "unknown", which the start pre-check must treat
    // as "no gating" rather than blocking.
    expect(spies.setPlcSwitchPosition).toHaveBeenCalledWith(null)
  })

  it('is inert on a platform whose DevicePort has no held link', () => {
    // The web platform has no serial link, so the optional method is absent.
    onPlcStateImpl = undefined
    expect(() => renderPlcState()).not.toThrow()
    expect(spies.setPlcRuntimeStatus).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderPlcState()
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})
