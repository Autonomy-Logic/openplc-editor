/**
 * useDevicePlcState — mirrors the held device link's run/stop state into the
 * store. The hook owns no timer; it only translates what the main process
 * already pushes on each liveness tick.
 */
import { renderHook } from '@testing-library/react'

const mockSetPlcRuntimeStatus = jest.fn()
const mockSetPlcSwitchPosition = jest.fn()

/** Captures the callback the hook subscribes with, so tests can drive it. */
let pushed: ((payload: { port: string; plcState?: number; switchPosition?: number }) => void) | null = null
const mockUnsubscribe = jest.fn()
let onPlcStateImpl: unknown = (cb: (p: { port: string; plcState?: number; switchPosition?: number }) => void) => {
  pushed = cb
  return mockUnsubscribe
}

jest.mock('../../../middleware/shared/providers', () => ({
  useDevice: () => ({ onPlcState: onPlcStateImpl }),
}))

jest.mock('../../store', () => ({
  useOpenPLCStore: (selector: (s: unknown) => unknown) =>
    selector({
      deviceActions: {
        setPlcRuntimeStatus: mockSetPlcRuntimeStatus,
        setPlcSwitchPosition: mockSetPlcSwitchPosition,
      },
    }),
}))

import { useDevicePlcState } from '../use-device-plc-state'

describe('useDevicePlcState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pushed = null
    onPlcStateImpl = (cb: (p: { port: string; plcState?: number; switchPosition?: number }) => void) => {
      pushed = cb
      return mockUnsubscribe
    }
  })

  it('maps a RUNNING push with the switch in RUN', () => {
    renderHook(() => useDevicePlcState())
    pushed!({ port: '/dev/x', plcState: 1, switchPosition: 1 })

    expect(mockSetPlcRuntimeStatus).toHaveBeenCalledWith('RUNNING')
    expect(mockSetPlcSwitchPosition).toHaveBeenCalledWith('run')
  })

  it('maps STOPPED with the switch in STOP', () => {
    renderHook(() => useDevicePlcState())
    pushed!({ port: '/dev/x', plcState: 0, switchPosition: 0 })

    expect(mockSetPlcRuntimeStatus).toHaveBeenCalledWith('STOPPED')
    expect(mockSetPlcSwitchPosition).toHaveBeenCalledWith('stop')
  })

  it('maps the ERROR state', () => {
    renderHook(() => useDevicePlcState())
    pushed!({ port: '/dev/x', plcState: 2, switchPosition: 1 })

    expect(mockSetPlcRuntimeStatus).toHaveBeenCalledWith('ERROR')
  })

  it('leaves the status untouched when the firmware reports no state', () => {
    // Firmware predating the run/stop state machine omits the field. Inventing a
    // status would make the button lie, so the hook writes nothing.
    renderHook(() => useDevicePlcState())
    pushed!({ port: '/dev/x' })

    expect(mockSetPlcRuntimeStatus).not.toHaveBeenCalled()
    // ...and the switch reads as "unknown", which the start pre-check must treat
    // as "no gating" rather than blocking.
    expect(mockSetPlcSwitchPosition).toHaveBeenCalledWith(null)
  })

  it('is inert on a platform whose DevicePort has no held link', () => {
    // The web platform has no serial link, so the optional method is absent.
    onPlcStateImpl = undefined
    expect(() => renderHook(() => useDevicePlcState())).not.toThrow()
    expect(mockSetPlcRuntimeStatus).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useDevicePlcState())
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})
