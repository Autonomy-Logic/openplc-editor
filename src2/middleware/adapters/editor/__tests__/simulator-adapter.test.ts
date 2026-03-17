import type { SimulatorPort } from '../../../shared/ports/simulator-port'
import { createEditorSimulatorAdapter } from '../simulator-adapter'

let adapter: SimulatorPort
let simulatorStoppedCallback: (() => void) | null
let unsubscribeFromMain: jest.Mock

beforeEach(() => {
  simulatorStoppedCallback = null
  unsubscribeFromMain = jest.fn()

  window.bridge = {
    simulatorLoadFirmware: jest.fn().mockResolvedValue({ success: true }),
    simulatorStop: jest.fn().mockResolvedValue({ success: true }),
    simulatorIsRunning: jest.fn().mockResolvedValue(true),
    onSimulatorStopped: jest.fn().mockImplementation((cb: () => void) => {
      simulatorStoppedCallback = cb
      return unsubscribeFromMain
    }),
  } as unknown as typeof window.bridge

  adapter = createEditorSimulatorAdapter()
})

// ---------------------------------------------------------------------------
// loadFirmware
// ---------------------------------------------------------------------------

describe('loadFirmware', () => {
  it('delegates to bridge with hex path', async () => {
    const result = await adapter.loadFirmware('/path/to/firmware.hex')

    expect(window.bridge.simulatorLoadFirmware).toHaveBeenCalledWith('/path/to/firmware.hex')
    expect(result).toEqual({ success: true })
  })

  it('sets running state on success', async () => {
    expect(adapter.isRunning()).toBe(false)

    await adapter.loadFirmware('/path/to/firmware.hex')

    expect(adapter.isRunning()).toBe(true)
  })

  it('does not set running state on failure', async () => {
    ;(window.bridge.simulatorLoadFirmware as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Invalid HEX file',
    })

    const result = await adapter.loadFirmware('/bad/path.hex')

    expect(adapter.isRunning()).toBe(false)
    expect(result).toEqual({ success: false, error: 'Invalid HEX file' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.simulatorLoadFirmware as jest.Mock).mockRejectedValue(new Error('IPC failed'))

    const result = await adapter.loadFirmware('/path/to/firmware.hex')

    expect(result).toEqual({ success: false, error: 'IPC failed' })
    expect(adapter.isRunning()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

describe('stop', () => {
  it('delegates to bridge', async () => {
    await adapter.loadFirmware('/path/to/firmware.hex')
    const result = await adapter.stop()

    expect(window.bridge.simulatorStop).toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })

  it('clears running state', async () => {
    await adapter.loadFirmware('/path/to/firmware.hex')
    expect(adapter.isRunning()).toBe(true)

    await adapter.stop()
    expect(adapter.isRunning()).toBe(false)
  })

  it('fires stop callbacks', async () => {
    const cb = jest.fn()
    adapter.onStopped(cb)

    await adapter.loadFirmware('/path/to/firmware.hex')
    await adapter.stop()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('returns success even on bridge error', async () => {
    ;(window.bridge.simulatorStop as jest.Mock).mockRejectedValue(new Error('IPC error'))

    const result = await adapter.stop()

    expect(result).toEqual({ success: true })
    expect(adapter.isRunning()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isRunning
// ---------------------------------------------------------------------------

describe('isRunning', () => {
  it('returns false initially', () => {
    expect(adapter.isRunning()).toBe(false)
  })

  it('returns true after successful load', async () => {
    await adapter.loadFirmware('/path/to/firmware.hex')
    expect(adapter.isRunning()).toBe(true)
  })

  it('returns false after stop', async () => {
    await adapter.loadFirmware('/path/to/firmware.hex')
    await adapter.stop()
    expect(adapter.isRunning()).toBe(false)
  })

  it('returns false after main process stopped event', async () => {
    await adapter.loadFirmware('/path/to/firmware.hex')
    expect(adapter.isRunning()).toBe(true)

    simulatorStoppedCallback?.()
    expect(adapter.isRunning()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// onStopped
// ---------------------------------------------------------------------------

describe('onStopped', () => {
  it('subscribes to main process stopped events', () => {
    expect(window.bridge.onSimulatorStopped).toHaveBeenCalled()
  })

  it('fires callback when main process signals stopped', async () => {
    const cb = jest.fn()
    adapter.onStopped(cb)

    await adapter.loadFirmware('/path/to/firmware.hex')
    simulatorStoppedCallback?.()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('returns unsubscribe function that removes callback', async () => {
    const cb = jest.fn()
    const unsub = adapter.onStopped(cb)

    unsub()

    await adapter.loadFirmware('/path/to/firmware.hex')
    simulatorStoppedCallback?.()

    expect(cb).not.toHaveBeenCalled()
  })

  it('supports multiple callbacks', async () => {
    const cb1 = jest.fn()
    const cb2 = jest.fn()
    adapter.onStopped(cb1)
    adapter.onStopped(cb2)

    await adapter.loadFirmware('/path/to/firmware.hex')
    simulatorStoppedCallback?.()

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes only the targeted callback', async () => {
    const cb1 = jest.fn()
    const cb2 = jest.fn()
    adapter.onStopped(cb1)
    const unsub2 = adapter.onStopped(cb2)

    unsub2()

    await adapter.loadFirmware('/path/to/firmware.hex')
    simulatorStoppedCallback?.()

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// connectDebugger
// ---------------------------------------------------------------------------

describe('connectDebugger', () => {
  it('is a no-op (resolves without calling bridge)', async () => {
    await expect(adapter.connectDebugger()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// disconnectDebugger
// ---------------------------------------------------------------------------

describe('disconnectDebugger', () => {
  it('is a no-op (does not throw)', () => {
    expect(() => adapter.disconnectDebugger()).not.toThrow()
  })
})
