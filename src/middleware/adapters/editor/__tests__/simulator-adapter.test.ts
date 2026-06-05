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

  it('fires stop callbacks even on bridge error', async () => {
    const cb = jest.fn()
    adapter.onStopped(cb)
    ;(window.bridge.simulatorStop as jest.Mock).mockRejectedValue(new Error('IPC error'))

    await adapter.loadFirmware('/path/to/firmware.hex')
    await adapter.stop()

    expect(cb).toHaveBeenCalledTimes(1)
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

  it('tolerates double-unsubscribe without error', () => {
    const cb = jest.fn()
    const unsub = adapter.onStopped(cb)

    unsub()
    // Second call: indexOf returns -1, the idx >= 0 branch is false
    expect(() => unsub()).not.toThrow()
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

// ---------------------------------------------------------------------------
// getDebugMd5Hash
// ---------------------------------------------------------------------------

describe('getDebugMd5Hash', () => {
  it('throws when no project context is provided', async () => {
    // The default adapter is created without getProjectContext
    await expect(adapter.getDebugMd5Hash()).rejects.toThrow('Project context not available for MD5 hash')
  })

  it('returns the MD5 hash from the bridge', async () => {
    window.bridge = {
      ...window.bridge,
      debuggerReadProgramStMd5: jest.fn().mockResolvedValue({ success: true, md5: 'abc123' }),
    } as unknown as typeof window.bridge

    const adapterWithContext = createEditorSimulatorAdapter(() => ({
      projectPath: '/project',
      boardTarget: 'Arduino Mega',
    }))

    const result = await adapterWithContext.getDebugMd5Hash()

    expect(window.bridge.debuggerReadProgramStMd5).toHaveBeenCalledWith('/project', 'Arduino Mega')
    expect(result).toBe('abc123')
  })

  it('throws when bridge returns failure', async () => {
    window.bridge = {
      ...window.bridge,
      debuggerReadProgramStMd5: jest.fn().mockResolvedValue({ success: false, error: 'File not found' }),
    } as unknown as typeof window.bridge

    const adapterWithContext = createEditorSimulatorAdapter(() => ({
      projectPath: '/project',
      boardTarget: 'Arduino Mega',
    }))

    await expect(adapterWithContext.getDebugMd5Hash()).rejects.toThrow('File not found')
  })

  it('throws generic error when bridge returns failure without error message', async () => {
    window.bridge = {
      ...window.bridge,
      debuggerReadProgramStMd5: jest.fn().mockResolvedValue({ success: false }),
    } as unknown as typeof window.bridge

    const adapterWithContext = createEditorSimulatorAdapter(() => ({
      projectPath: '/project',
      boardTarget: 'Arduino Mega',
    }))

    await expect(adapterWithContext.getDebugMd5Hash()).rejects.toThrow('Failed to read MD5 hash')
  })
})

// ---------------------------------------------------------------------------
// getDebugVariablesList
// ---------------------------------------------------------------------------

describe('getDebugVariablesList', () => {
  beforeEach(() => {
    window.bridge = {
      ...window.bridge,
      debuggerGetVariablesList: jest.fn(),
    } as unknown as typeof window.bridge
  })

  it('returns converted hex string from number array data', async () => {
    ;(window.bridge.debuggerGetVariablesList as jest.Mock).mockResolvedValue({
      success: true,
      tick: 42,
      lastIndex: 3,
      data: [0, 255, 16], // -> "00ff10"
    })

    const result = await adapter.getDebugVariablesList([0, 1, 2])

    expect(window.bridge.debuggerGetVariablesList).toHaveBeenCalledWith([0, 1, 2])
    expect(result).toEqual({
      success: true,
      tick: 42,
      lastIndex: 3,
      data: '00ff10',
    })
  })

  it('returns error when bridge reports failure', async () => {
    ;(window.bridge.debuggerGetVariablesList as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Not connected',
    })

    const result = await adapter.getDebugVariablesList([0])

    expect(result).toEqual({ success: false, error: 'Not connected' })
  })

  it('handles undefined data on success', async () => {
    ;(window.bridge.debuggerGetVariablesList as jest.Mock).mockResolvedValue({
      success: true,
      tick: 1,
      lastIndex: 0,
    })

    const result = await adapter.getDebugVariablesList([])

    expect(result).toEqual({
      success: true,
      tick: 1,
      lastIndex: 0,
      data: undefined,
    })
  })
})

// ---------------------------------------------------------------------------
// setDebugVariable
// ---------------------------------------------------------------------------

describe('setDebugVariable', () => {
  beforeEach(() => {
    window.bridge = {
      ...window.bridge,
      debuggerSetVariable: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as typeof window.bridge
  })

  it('converts hex string to Uint8Array when force is true with value', async () => {
    const result = await adapter.setDebugVariable(5, true, '00ff10')

    expect(window.bridge.debuggerSetVariable).toHaveBeenCalledWith(5, true, new Uint8Array([0, 255, 16]))
    expect(result).toEqual({ success: true })
  })

  it('strips whitespace from hex string before conversion', async () => {
    await adapter.setDebugVariable(5, true, '00 ff 10')

    expect(window.bridge.debuggerSetVariable).toHaveBeenCalledWith(5, true, new Uint8Array([0, 255, 16]))
  })

  it('passes undefined for value when force is false', async () => {
    await adapter.setDebugVariable(3, false)

    expect(window.bridge.debuggerSetVariable).toHaveBeenCalledWith(3, false, undefined)
  })

  it('passes undefined for value when force is true but no hex provided', async () => {
    await adapter.setDebugVariable(3, true)

    expect(window.bridge.debuggerSetVariable).toHaveBeenCalledWith(3, true, undefined)
  })
})
