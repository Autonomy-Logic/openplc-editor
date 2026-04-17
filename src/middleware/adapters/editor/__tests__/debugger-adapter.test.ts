import type { DebuggerPort } from '../../../shared/ports/debugger-port'
import type { DebugConnectionConfig } from '../../../shared/ports/types'
import { createEditorDebuggerAdapter } from '../debugger-adapter'

let adapter: DebuggerPort
const tcpConfig: DebugConnectionConfig = {
  connectionType: 'tcp',
  connectionParams: {
    ipAddress: '192.168.1.100',
    port: '502',
  },
}

beforeEach(() => {
  window.bridge = {
    debuggerConnect: jest.fn().mockResolvedValue({ success: true }),
    debuggerDisconnect: jest.fn().mockResolvedValue({ success: true }),
    debuggerGetVariablesList: jest.fn().mockResolvedValue({
      success: true,
      tick: 42,
      lastIndex: 5,
      data: [1, 0, 255, 0, 1],
    }),
    debuggerSetVariable: jest.fn().mockResolvedValue({ success: true }),
    debuggerVerifyMd5: jest.fn().mockResolvedValue({
      success: true,
      match: true,
      targetMd5: 'abc123def456abc123def456abc123de',
    }),
    debuggerReadProgramStMd5: jest.fn().mockResolvedValue({
      success: true,
      md5: 'abc123def456abc123def456abc123de',
    }),
    readDebugFile: jest.fn().mockResolvedValue({
      success: true,
      content: 'debug_vars[] = { ... }',
    }),
  } as unknown as typeof window.bridge

  adapter = createEditorDebuggerAdapter()
})

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

describe('connect', () => {
  it('delegates to bridge with connection type and params', async () => {
    const result = await adapter.connect(tcpConfig)

    expect(window.bridge.debuggerConnect).toHaveBeenCalledWith('tcp', {
      ipAddress: '192.168.1.100',
      port: '502',
    })
    expect(result).toEqual({ success: true })
  })

  it('sets connected state on success', async () => {
    expect(adapter.isConnected()).toBe(false)
    await adapter.connect(tcpConfig)
    expect(adapter.isConnected()).toBe(true)
  })

  it('does not set connected state on failure', async () => {
    ;(window.bridge.debuggerConnect as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Connection refused',
    })
    await adapter.connect(tcpConfig)
    expect(adapter.isConnected()).toBe(false)
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.debuggerConnect as jest.Mock).mockRejectedValue(new Error('IPC failed'))
    const result = await adapter.connect(tcpConfig)

    expect(result).toEqual({ success: false, error: 'IPC failed' })
  })

  it('supports simulator connection type', async () => {
    await adapter.connect({ connectionType: 'simulator', connectionParams: {} })

    expect(window.bridge.debuggerConnect).toHaveBeenCalledWith('simulator', {})
  })

  it('supports websocket connection type with JWT', async () => {
    await adapter.connect({
      connectionType: 'websocket',
      connectionParams: {
        ipAddress: '10.0.0.1',
        port: '8443',
        jwtToken: 'my-jwt',
      },
    })

    expect(window.bridge.debuggerConnect).toHaveBeenCalledWith('websocket', {
      ipAddress: '10.0.0.1',
      port: '8443',
      jwtToken: 'my-jwt',
    })
  })

  it('supports RTU connection type with serial params', async () => {
    await adapter.connect({
      connectionType: 'rtu',
      connectionParams: {
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        slaveId: 1,
      },
    })

    expect(window.bridge.debuggerConnect).toHaveBeenCalledWith('rtu', {
      port: '/dev/ttyUSB0',
      baudRate: 115200,
      slaveId: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe('disconnect', () => {
  it('delegates to bridge', async () => {
    await adapter.connect(tcpConfig)
    const result = await adapter.disconnect()

    expect(window.bridge.debuggerDisconnect).toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })

  it('clears connected state', async () => {
    await adapter.connect(tcpConfig)
    expect(adapter.isConnected()).toBe(true)

    await adapter.disconnect()
    expect(adapter.isConnected()).toBe(false)
  })

  it('fires disconnect callbacks', async () => {
    const cb1 = jest.fn()
    const cb2 = jest.fn()
    adapter.onDisconnected(cb1)
    adapter.onDisconnected(cb2)

    await adapter.connect(tcpConfig)
    await adapter.disconnect()

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('clears state and fires callbacks even on bridge error', async () => {
    ;(window.bridge.debuggerDisconnect as jest.Mock).mockRejectedValue(new Error('IPC error'))
    const cb = jest.fn()
    adapter.onDisconnected(cb)

    await adapter.connect(tcpConfig)
    const result = await adapter.disconnect()

    expect(adapter.isConnected()).toBe(false)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true })
  })
})

// ---------------------------------------------------------------------------
// getVariablesList
// ---------------------------------------------------------------------------

describe('getVariablesList', () => {
  it('delegates to bridge with indexes', async () => {
    const result = await adapter.getVariablesList([0, 1, 2, 3, 4])

    expect(window.bridge.debuggerGetVariablesList).toHaveBeenCalledWith([0, 1, 2, 3, 4])
    expect(result).toEqual({
      success: true,
      tick: 42,
      lastIndex: 5,
      data: [1, 0, 255, 0, 1],
    })
  })

  it('passes through needsReconnect flag', async () => {
    ;(window.bridge.debuggerGetVariablesList as jest.Mock).mockResolvedValue({
      success: true,
      tick: 10,
      lastIndex: 2,
      data: [1, 0],
      needsReconnect: true,
    })
    const result = await adapter.getVariablesList([0, 1])

    expect(result.needsReconnect).toBe(true)
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.debuggerGetVariablesList as jest.Mock).mockRejectedValue(new Error('Timeout'))
    const result = await adapter.getVariablesList([0])

    expect(result).toEqual({ success: false, error: 'Timeout' })
  })
})

// ---------------------------------------------------------------------------
// setVariable
// ---------------------------------------------------------------------------

describe('setVariable', () => {
  it('delegates to bridge with index, force flag, and value buffer', async () => {
    const buffer = new Uint8Array([0x01, 0x02])
    const result = await adapter.setVariable(5, true, buffer)

    expect(window.bridge.debuggerSetVariable).toHaveBeenCalledWith(5, true, buffer)
    expect(result).toEqual({ success: true })
  })

  it('works without value buffer (unforce)', async () => {
    const result = await adapter.setVariable(5, false)

    expect(window.bridge.debuggerSetVariable).toHaveBeenCalledWith(5, false, undefined)
    expect(result).toEqual({ success: true })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.debuggerSetVariable as jest.Mock).mockRejectedValue(new Error('Write failed'))
    const result = await adapter.setVariable(5, true, new Uint8Array([1]))

    expect(result).toEqual({ success: false, error: 'Write failed' })
  })
})

// ---------------------------------------------------------------------------
// verifyMd5
// ---------------------------------------------------------------------------

describe('verifyMd5', () => {
  it('delegates to bridge with connection config and expected MD5', async () => {
    const result = await adapter.verifyMd5('abc123def456abc123def456abc123de', tcpConfig)

    expect(window.bridge.debuggerVerifyMd5).toHaveBeenCalledWith(
      'tcp',
      { ipAddress: '192.168.1.100', port: '502' },
      'abc123def456abc123def456abc123de',
    )
    expect(result).toEqual({
      success: true,
      match: true,
      targetMd5: 'abc123def456abc123def456abc123de',
    })
  })

  it('uses different configs per call', async () => {
    await adapter.verifyMd5('md5-1', tcpConfig)
    expect(window.bridge.debuggerVerifyMd5).toHaveBeenCalledWith(
      'tcp',
      { ipAddress: '192.168.1.100', port: '502' },
      'md5-1',
    )

    const simConfig: DebugConnectionConfig = { connectionType: 'simulator', connectionParams: {} }
    await adapter.verifyMd5('md5-2', simConfig)
    expect(window.bridge.debuggerVerifyMd5).toHaveBeenCalledWith('simulator', {}, 'md5-2')
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.debuggerVerifyMd5 as jest.Mock).mockRejectedValue(new Error('MD5 check failed'))
    const result = await adapter.verifyMd5('abc123', tcpConfig)

    expect(result).toEqual({ success: false, error: 'MD5 check failed' })
  })
})

// ---------------------------------------------------------------------------
// readProgramMd5
// ---------------------------------------------------------------------------

describe('readProgramMd5', () => {
  it('delegates to bridge with project path and board target', async () => {
    const result = await adapter.readProgramMd5('/home/user/project', 'arduino_mega')

    expect(window.bridge.debuggerReadProgramStMd5).toHaveBeenCalledWith('/home/user/project', 'arduino_mega')
    expect(result).toEqual({
      success: true,
      md5: 'abc123def456abc123def456abc123de',
    })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.debuggerReadProgramStMd5 as jest.Mock).mockRejectedValue(new Error('File not found'))
    const result = await adapter.readProgramMd5('/invalid/path', 'board')

    expect(result).toEqual({ success: false, error: 'File not found' })
  })
})

// ---------------------------------------------------------------------------
// readDebugFile
// ---------------------------------------------------------------------------

describe('readDebugFile', () => {
  it('delegates to bridge with project path and board target', async () => {
    const result = await adapter.readDebugFile('/home/user/project', 'arduino_mega')

    expect(window.bridge.readDebugFile).toHaveBeenCalledWith('/home/user/project', 'arduino_mega')
    expect(result).toEqual({
      success: true,
      content: 'debug_vars[] = { ... }',
    })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.readDebugFile as jest.Mock).mockRejectedValue(new Error('Read error'))
    const result = await adapter.readDebugFile('/path', 'board')

    expect(result).toEqual({ success: false, error: 'Read error' })
  })
})

// ---------------------------------------------------------------------------
// onDisconnected
// ---------------------------------------------------------------------------

describe('onDisconnected', () => {
  it('returns a working unsubscribe function', async () => {
    const cb = jest.fn()
    const unsub = adapter.onDisconnected(cb)

    await adapter.connect(tcpConfig)
    unsub()
    await adapter.disconnect()

    expect(cb).not.toHaveBeenCalled()
  })

  it('supports multiple subscribers', async () => {
    const cb1 = jest.fn()
    const cb2 = jest.fn()
    const cb3 = jest.fn()
    adapter.onDisconnected(cb1)
    const unsub2 = adapter.onDisconnected(cb2)
    adapter.onDisconnected(cb3)

    unsub2()
    await adapter.connect(tcpConfig)
    await adapter.disconnect()

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).not.toHaveBeenCalled()
    expect(cb3).toHaveBeenCalledTimes(1)
  })

  it('tolerates double-unsubscribe without error', () => {
    const cb = jest.fn()
    const unsub = adapter.onDisconnected(cb)

    unsub()
    // Second call: indexOf returns -1, the idx >= 0 branch is false
    expect(() => unsub()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// isConnected
// ---------------------------------------------------------------------------

describe('isConnected', () => {
  it('returns false initially', () => {
    expect(adapter.isConnected()).toBe(false)
  })

  it('returns true after successful connect', async () => {
    await adapter.connect(tcpConfig)
    expect(adapter.isConnected()).toBe(true)
  })

  it('returns false after disconnect', async () => {
    await adapter.connect(tcpConfig)
    await adapter.disconnect()
    expect(adapter.isConnected()).toBe(false)
  })
})
