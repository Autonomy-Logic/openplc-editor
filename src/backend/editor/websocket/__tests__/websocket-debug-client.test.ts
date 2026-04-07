jest.mock('socket.io-client', () => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  const ioHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}

  const mockSocket = {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
    }),
    off: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler)
      }
    }),
    emit: jest.fn(),
    disconnect: jest.fn(),
    io: {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!ioHandlers[event]) ioHandlers[event] = []
        ioHandlers[event].push(handler)
      }),
    },
    _emit: (event: string, ...args: unknown[]) => {
      const h = handlers[event]
      if (h) h.forEach((fn) => fn(...args))
    },
    _ioEmit: (event: string, ...args: unknown[]) => {
      const h = ioHandlers[event]
      if (h) h.forEach((fn) => fn(...args))
    },
    _handlers: handlers,
    _ioHandlers: ioHandlers,
  }

  return {
    io: jest.fn().mockReturnValue(mockSocket),
    _mockSocket: mockSocket,
  }
})

import { ModbusDebugResponse, ModbusFunctionCode } from '../../modbus/modbus-client'
import { WebSocketDebugClient } from '../websocket-debug-client'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const socketIoModule = require('socket.io-client') as {
  _mockSocket: {
    on: jest.Mock
    off: jest.Mock
    emit: jest.Mock
    disconnect: jest.Mock
    _emit: (event: string, ...args: unknown[]) => void
    _ioEmit: (event: string, ...args: unknown[]) => void
    _handlers: Record<string, ((...args: unknown[]) => void)[]>
    _ioHandlers: Record<string, ((...args: unknown[]) => void)[]>
  }
}

function getSocket() {
  return socketIoModule._mockSocket
}

/**
 * Build a hex-string response matching what the WS debug client expects.
 * Format: funcCode(1) + statusCode(1) + ...payload
 */
function buildHexResponse(funcCode: number, statusCode: number, payload?: Buffer): string {
  const buf = Buffer.alloc(2 + (payload ? payload.length : 0))
  buf.writeUInt8(funcCode, 0)
  buf.writeUInt8(statusCode, 1)
  if (payload) payload.copy(buf as unknown as Uint8Array, 2)
  return Array.from(buf)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

describe('WebSocketDebugClient', () => {
  let client: WebSocketDebugClient

  beforeEach(() => {
    jest.useFakeTimers()
    // Clear handler maps between tests
    const sock = getSocket()
    for (const key of Object.keys(sock._handlers)) delete sock._handlers[key]
    for (const key of Object.keys(sock._ioHandlers)) delete sock._ioHandlers[key]
    sock.on.mockClear()
    sock.off.mockClear()
    sock.emit.mockClear()
    sock.disconnect.mockClear()

    client = new WebSocketDebugClient({
      host: '127.0.0.1',
      port: 8443,
      token: 'test-token',
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('connect', () => {
    it('resolves when connected event fires with ok status', async () => {
      const connectPromise = client.connect()
      const sock = getSocket()
      sock._emit('connected', { status: 'ok' })
      await expect(connectPromise).resolves.toBeUndefined()
    })

    it('rejects when connected event fires with non-ok status', async () => {
      const connectPromise = client.connect()
      const sock = getSocket()
      sock._emit('connected', { status: 'fail' })
      await expect(connectPromise).rejects.toThrow('Connection failed: invalid status')
    })

    it('rejects on connect_error', async () => {
      const connectPromise = client.connect()
      const sock = getSocket()
      sock._emit('connect_error', new Error('auth failed'))
      await expect(connectPromise).rejects.toThrow('auth failed')
    })

    it('rejects on io error', async () => {
      const connectPromise = client.connect()
      const sock = getSocket()
      sock._ioEmit('error', new Error('transport error'))
      await expect(connectPromise).rejects.toThrow('transport error')
    })

    it('rejects on connection timeout', async () => {
      const connectPromise = client.connect()
      jest.advanceTimersByTime(6000)
      await expect(connectPromise).rejects.toThrow('Connection timeout')
    })

    it('accepts rejectUnauthorized option', () => {
      const c = new WebSocketDebugClient({
        host: '127.0.0.1',
        port: 8443,
        token: 'test',
        rejectUnauthorized: true,
      })
      // Just verify it can be constructed
      expect(c).toBeDefined()
    })
  })

  describe('disconnect', () => {
    it('disconnects and nullifies socket', async () => {
      const connectPromise = client.connect()
      getSocket()._emit('connected', { status: 'ok' })
      await connectPromise

      client.disconnect()
      expect(getSocket().disconnect).toHaveBeenCalled()
    })

    it('does nothing when not connected', () => {
      // Create a fresh client that never connected
      const freshClient = new WebSocketDebugClient({
        host: '127.0.0.1',
        port: 8443,
        token: 'test',
      })
      // disconnect before connect - should not throw
      // socket is null internally (never assigned since connect wasn't called on this specific instance)
      // Actually, socket is assigned in connect(), so if never connected, it's null
      freshClient.disconnect()
    })
  })

  describe('getMd5Hash', () => {
    async function connectClient() {
      const p = client.connect()
      getSocket()._emit('connected', { status: 'ok' })
      await p
    }

    it('throws when not connected', async () => {
      // Create a fresh client without connecting
      const freshClient = new WebSocketDebugClient({
        host: '127.0.0.1',
        port: 8443,
        token: 'test',
      })
      await expect(freshClient.getMd5Hash()).rejects.toThrow('Not connected to target')
    })

    it('returns MD5 hash on success', async () => {
      await connectClient()

      const md5 = 'abc123def456'
      const md5Buf = Buffer.from(md5, 'utf-8')
      const hexResp = buildHexResponse(ModbusFunctionCode.DEBUG_GET_MD5, ModbusDebugResponse.SUCCESS, md5Buf)

      const promise = client.getMd5Hash()

      // Find and call the debug_response handler
      const sock = getSocket()
      const emitCall = sock.emit.mock.calls.find(
        (call: unknown[]) => call[0] === 'debug_command',
      )
      expect(emitCall).toBeDefined()

      sock._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result).toBe(md5)
    })

    it('rejects when response is not successful', async () => {
      await connectClient()

      const promise = client.getMd5Hash()
      getSocket()._emit('debug_response', { success: false, error: 'server error' })
      await expect(promise).rejects.toThrow('server error')
    })

    it('rejects when response has no data', async () => {
      await connectClient()

      const promise = client.getMd5Hash()
      getSocket()._emit('debug_response', { success: true })
      await expect(promise).rejects.toThrow('No data in response')
    })

    it('rejects on too-short response', async () => {
      await connectClient()

      // Only 1 byte
      const promise = client.getMd5Hash()
      getSocket()._emit('debug_response', { success: true, data: '45' })
      await expect(promise).rejects.toThrow('Invalid response: too short')
    })

    it('rejects on function code mismatch', async () => {
      await connectClient()

      const hexResp = buildHexResponse(0x99, ModbusDebugResponse.SUCCESS)

      const promise = client.getMd5Hash()
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      await expect(promise).rejects.toThrow('Function code mismatch')
    })

    it('rejects on error status code', async () => {
      await connectClient()

      const hexResp = buildHexResponse(
        ModbusFunctionCode.DEBUG_GET_MD5,
        ModbusDebugResponse.ERROR_OUT_OF_BOUNDS,
      )

      const promise = client.getMd5Hash()
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      await expect(promise).rejects.toThrow('Target returned error code')
    })

    it('rejects on request timeout', async () => {
      await connectClient()

      const promise = client.getMd5Hash()
      jest.advanceTimersByTime(6000)
      await expect(promise).rejects.toThrow('Request timeout')
    })

    it('rejects with unknown error', async () => {
      await connectClient()

      const promise = client.getMd5Hash()
      getSocket()._emit('debug_response', { success: false })
      await expect(promise).rejects.toThrow('Unknown error')
    })

    it('handles parse errors in response handler', async () => {
      await connectClient()

      const promise = client.getMd5Hash()
      // Send garbage hex data that will cause buffer parsing to fail
      getSocket()._emit('debug_response', { success: true, data: 'ZZ GG' })
      await expect(promise).rejects.toThrow()
    })
  })

  describe('getVariablesList', () => {
    async function connectClient() {
      const p = client.connect()
      getSocket()._emit('connected', { status: 'ok' })
      await p
    }

    it('returns error when not connected', async () => {
      const freshClient = new WebSocketDebugClient({
        host: '127.0.0.1',
        port: 8443,
        token: 'test',
      })
      const result = await freshClient.getVariablesList([0])
      expect(result).toEqual({ success: false, error: 'Not connected to target' })
    })

    it('returns success with variable data', async () => {
      await connectClient()

      const varData = Buffer.from([0xaa, 0xbb])
      // funcCode(1) + status(1) + lastIndex(2) + tick(4) + responseSize(2) + varData
      const payload = Buffer.alloc(8 + varData.length)
      payload.writeUInt16BE(3, 0) // lastIndex
      payload.writeUInt32BE(99, 2) // tick
      payload.writeUInt16BE(varData.length, 6)
      varData.copy(payload as unknown as Uint8Array, 8)

      const hexResp = buildHexResponse(ModbusFunctionCode.DEBUG_GET_LIST, ModbusDebugResponse.SUCCESS, payload)

      const promise = client.getVariablesList([0, 1])
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(true)
      expect(result.tick).toBe(99)
      expect(result.lastIndex).toBe(3)
    })

    it('returns error on unsuccessful response', async () => {
      await connectClient()

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: false, error: 'ws error' })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('ws error')
    })

    it('returns error on missing data', async () => {
      await connectClient()

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('No data in response')
    })

    it('returns error on too-short response', async () => {
      await connectClient()

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true, data: '44' })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('returns error on function code mismatch', async () => {
      await connectClient()

      const hexResp = buildHexResponse(0x99, ModbusDebugResponse.SUCCESS)

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Function code mismatch')
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await connectClient()

      const hexResp = buildHexResponse(
        ModbusFunctionCode.DEBUG_GET_LIST,
        ModbusDebugResponse.ERROR_OUT_OF_BOUNDS,
      )

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await connectClient()

      const hexResp = buildHexResponse(
        ModbusFunctionCode.DEBUG_GET_LIST,
        ModbusDebugResponse.ERROR_OUT_OF_MEMORY,
      )

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
    })

    it('returns error on unknown status code', async () => {
      await connectClient()

      const hexResp = buildHexResponse(ModbusFunctionCode.DEBUG_GET_LIST, 0xee)

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error on incomplete success response (< 10 bytes)', async () => {
      await connectClient()

      // funcCode(1) + status(1) + only 2 extra bytes = 4 total, but need 10
      const payload = Buffer.alloc(2) // not enough
      const hexResp = buildHexResponse(
        ModbusFunctionCode.DEBUG_GET_LIST,
        ModbusDebugResponse.SUCCESS,
        payload,
      )

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Incomplete success response')
    })

    it('returns error on incomplete variable data', async () => {
      await connectClient()

      // payload has lastIndex + tick + responseSize claiming 100 bytes, but no actual data
      const payload = Buffer.alloc(8)
      payload.writeUInt16BE(0, 0) // lastIndex
      payload.writeUInt32BE(0, 2) // tick
      payload.writeUInt16BE(100, 6) // responseSize = 100, but no data
      const hexResp = buildHexResponse(
        ModbusFunctionCode.DEBUG_GET_LIST,
        ModbusDebugResponse.SUCCESS,
        payload,
      )

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Incomplete variable data')
    })

    it('returns error on request timeout', async () => {
      await connectClient()

      const promise = client.getVariablesList([0])
      jest.advanceTimersByTime(6000)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('Request timeout')
    })

    it('returns error on unknown error in response', async () => {
      await connectClient()

      const promise = client.getVariablesList([0])
      getSocket()._emit('debug_response', { success: false })
      const result = await promise
      expect(result).toEqual({ success: false, error: 'Unknown error' })
    })
  })

  describe('setVariable', () => {
    async function connectClient() {
      const p = client.connect()
      getSocket()._emit('connected', { status: 'ok' })
      await p
    }

    it('returns error when not connected', async () => {
      const freshClient = new WebSocketDebugClient({
        host: '127.0.0.1',
        port: 8443,
        token: 'test',
      })
      const result = await freshClient.setVariable(0, false)
      expect(result).toEqual({ success: false, error: 'Not connected to target' })
    })

    it('returns success on valid response (force=false)', async () => {
      await connectClient()

      const hexResp = buildHexResponse(ModbusFunctionCode.DEBUG_SET, ModbusDebugResponse.SUCCESS)

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result).toEqual({ success: true })
    })

    it('returns success with force and value buffer', async () => {
      await connectClient()

      const hexResp = buildHexResponse(ModbusFunctionCode.DEBUG_SET, ModbusDebugResponse.SUCCESS)

      const promise = client.setVariable(0, true, Buffer.from([0x01]))
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result).toEqual({ success: true })
    })

    it('returns error on unsuccessful response', async () => {
      await connectClient()

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: false, error: 'fail' })
      const result = await promise
      expect(result).toEqual({ success: false, error: 'fail' })
    })

    it('returns error on missing data', async () => {
      await connectClient()

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: true })
      const result = await promise
      expect(result).toEqual({ success: false, error: 'No data in response' })
    })

    it('returns error on too-short response', async () => {
      await connectClient()

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: true, data: '42' })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('returns error on function code mismatch', async () => {
      await connectClient()

      const hexResp = buildHexResponse(0x99, ModbusDebugResponse.SUCCESS)

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Function code mismatch')
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await connectClient()

      const hexResp = buildHexResponse(
        ModbusFunctionCode.DEBUG_SET,
        ModbusDebugResponse.ERROR_OUT_OF_BOUNDS,
      )

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result).toEqual({ success: false, error: 'ERROR_OUT_OF_BOUNDS' })
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await connectClient()

      const hexResp = buildHexResponse(
        ModbusFunctionCode.DEBUG_SET,
        ModbusDebugResponse.ERROR_OUT_OF_MEMORY,
      )

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result).toEqual({ success: false, error: 'ERROR_OUT_OF_MEMORY' })
    })

    it('returns error on unknown status code', async () => {
      await connectClient()

      const hexResp = buildHexResponse(ModbusFunctionCode.DEBUG_SET, 0xdd)

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: true, data: hexResp })
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error on request timeout', async () => {
      await connectClient()

      const promise = client.setVariable(0, false)
      jest.advanceTimersByTime(6000)
      const result = await promise
      expect(result).toEqual({ success: false, error: 'Request timeout' })
    })

    it('returns error on unknown error in response', async () => {
      await connectClient()

      const promise = client.setVariable(0, false)
      getSocket()._emit('debug_response', { success: false })
      const result = await promise
      expect(result).toEqual({ success: false, error: 'Unknown error' })
    })
  })
})
