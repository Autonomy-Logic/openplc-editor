import { Socket } from 'net'

import { ModbusDebugResponse, ModbusFunctionCode, ModbusTcpClient } from '../modbus-client'

jest.mock('net')

function createMockSocket() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    connect: jest.fn((_port: number, _host: string, cb: () => void) => {
      cb()
    }),
    destroy: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
    }),
    once: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
    }),
    removeListener: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler)
      }
    }),
    write: jest.fn((_data: unknown, cb?: (err?: Error) => void) => {
      if (cb) cb()
    }),
    _emit: (event: string, ...args: unknown[]) => {
      const h = handlers[event]
      if (h) h.forEach((fn) => fn(...args))
    },
    _handlers: handlers,
  }
}

describe('ModbusTcpClient', () => {
  let client: ModbusTcpClient
  let mockSocket: ReturnType<typeof createMockSocket>

  beforeEach(() => {
    mockSocket = createMockSocket()
    ;(Socket as unknown as jest.Mock).mockImplementation(() => mockSocket)
    client = new ModbusTcpClient({ host: '127.0.0.1', port: 502, timeout: 5000 })
  })

  afterEach(() => jest.restoreAllMocks())

  describe('enums', () => {
    it('exports expected function codes', () => {
      expect(ModbusFunctionCode.DEBUG_INFO).toBe(0x41)
      expect(ModbusFunctionCode.DEBUG_SET).toBe(0x42)
      expect(ModbusFunctionCode.DEBUG_GET).toBe(0x43)
      expect(ModbusFunctionCode.DEBUG_GET_LIST).toBe(0x44)
      expect(ModbusFunctionCode.DEBUG_GET_MD5).toBe(0x45)
    })

    it('exports expected response codes', () => {
      expect(ModbusDebugResponse.SUCCESS).toBe(0x7e)
      expect(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS).toBe(0x81)
      expect(ModbusDebugResponse.ERROR_OUT_OF_MEMORY).toBe(0x82)
    })
  })

  describe('connect', () => {
    it('resolves on successful connection', async () => {
      await expect(client.connect()).resolves.toBeUndefined()
    })

    it('rejects on socket error', async () => {
      mockSocket.connect.mockImplementation(() => {
        // Don't call callback; emit error instead
      })
      ;(Socket as unknown as jest.Mock).mockImplementation(() => {
        const s = createMockSocket()
        s.connect.mockImplementation((_port: number, _host: string) => {
          // Trigger error after attaching handlers
          setTimeout(() => s._emit('error', new Error('connection refused')), 0)
        })
        return s
      })

      client = new ModbusTcpClient({ host: '127.0.0.1', port: 502, timeout: 5000 })
      await expect(client.connect()).rejects.toThrow('connection refused')
    })
  })

  describe('disconnect', () => {
    it('destroys and nullifies socket', async () => {
      await client.connect()
      client.disconnect()
      expect(mockSocket.destroy).toHaveBeenCalled()
    })

    it('does nothing when socket is null', () => {
      client.disconnect() // no connect was called
      expect(mockSocket.destroy).not.toHaveBeenCalled()
    })
  })

  describe('getMd5Hash', () => {
    it('throws when not connected', async () => {
      await expect(client.getMd5Hash()).rejects.toThrow('Not connected to target')
    })

    it('returns MD5 hash on success', async () => {
      await client.connect()

      const md5 = 'abc123def456abc123def456abc123de'
      // Build a valid response: 6-byte MBAP header + unitId + funcCode + status + md5
      const md5Buf = Buffer.from(md5, 'utf-8')
      const response = Buffer.alloc(9 + md5Buf.length)
      response.writeUInt16BE(1, 0) // transactionId
      response.writeUInt16BE(0, 2) // protocolId
      response.writeUInt16BE(3 + md5Buf.length, 4) // length
      response.writeUInt8(0, 6) // unitId
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_MD5, 7) // funcCode
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8) // status
      md5Buf.copy(response as unknown as Uint8Array, 9)

      mockSocket.write.mockImplementation((_data: unknown) => {
        // Simulate response
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getMd5Hash()
      expect(result).toBe(md5)
    })

    it('throws on too-short response', async () => {
      await client.connect()

      const response = Buffer.alloc(5) // too short

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      await expect(client.getMd5Hash()).rejects.toThrow('Invalid response: too short')
    })

    it('throws on transaction ID mismatch', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(9999, 0) // wrong transactionId
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_MD5, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      await expect(client.getMd5Hash()).rejects.toThrow('Transaction ID mismatch')
    })

    it('throws on function code mismatch', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0) // correct transactionId
      response.writeUInt8(0x99, 7) // wrong funcCode
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      await expect(client.getMd5Hash()).rejects.toThrow('Function code mismatch')
    })

    it('throws on error status code', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_MD5, 7)
      response.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      await expect(client.getMd5Hash()).rejects.toThrow('Target returned error code')
    })
  })

  describe('getVariablesList', () => {
    it('returns error when not connected', async () => {
      const result = await client.getVariablesList([0, 1])
      expect(result).toEqual({ success: false, error: 'Not connected to target' })
    })

    it('returns success with variable data', async () => {
      await client.connect()

      // Build success response
      const varData = Buffer.from([0x01, 0x02])
      const response = Buffer.alloc(17 + varData.length)
      response.writeUInt16BE(1, 0) // transactionId
      response.writeUInt16BE(0, 2) // protocolId
      response.writeUInt16BE(11 + varData.length, 4) // length
      response.writeUInt8(0, 6) // unitId
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)
      response.writeUInt16BE(5, 9) // lastIndex
      response.writeUInt32BE(100, 11) // tick
      response.writeUInt16BE(varData.length, 15) // responseSize
      varData.copy(response as unknown as Uint8Array, 17)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0, 1])
      expect(result.success).toBe(true)
      expect(result.tick).toBe(100)
      expect(result.lastIndex).toBe(5)
    })

    it('returns error on too-short response', async () => {
      await client.connect()

      const response = Buffer.alloc(5)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('returns error on transaction ID mismatch', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(9999, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Transaction ID mismatch')
    })

    it('returns error on function code mismatch', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0) // Need to increment since previous calls incremented
      response.writeUInt8(0x99, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Function code mismatch')
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 7)
      response.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 7)
      response.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_MEMORY, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
    })

    it('returns error on unknown status code', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 7)
      response.writeUInt8(0xaa, 8) // unknown code

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error on incomplete success response (< 17 bytes)', async () => {
      await client.connect()

      const response = Buffer.alloc(12)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Incomplete success response')
    })

    it('returns error on incomplete variable data', async () => {
      await client.connect()

      const response = Buffer.alloc(17) // no variable data bytes
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)
      response.writeUInt16BE(0, 9) // lastIndex
      response.writeUInt32BE(0, 11) // tick
      response.writeUInt16BE(10, 15) // responseSize = 10, but no data follows

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Incomplete variable data')
    })

    it('returns error when send throws', async () => {
      await client.connect()

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('error', new Error('socket broken')), 0)
      })

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('socket broken')
    })
  })

  describe('setVariable', () => {
    it('returns error when not connected', async () => {
      const result = await client.setVariable(0, false)
      expect(result).toEqual({ success: false, error: 'Not connected to target' })
    })

    it('returns success on valid response (force=false)', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_SET, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result).toEqual({ success: true })
    })

    it('returns success with force and value buffer', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_SET, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.setVariable(0, true, Buffer.from([0x01, 0x02]))
      expect(result).toEqual({ success: true })
    })

    it('returns error on too-short response', async () => {
      await client.connect()

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', Buffer.alloc(5)), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('returns error on transaction ID mismatch', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(9999, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_SET, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Transaction ID mismatch')
    })

    it('returns error on function code mismatch', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(0x99, 7)
      response.writeUInt8(ModbusDebugResponse.SUCCESS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Function code mismatch')
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_SET, 7)
      response.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_SET, 7)
      response.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_MEMORY, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
    })

    it('returns error on unknown status code', async () => {
      await client.connect()

      const response = Buffer.alloc(9)
      response.writeUInt16BE(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_SET, 7)
      response.writeUInt8(0xcc, 8)

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('data', response), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error when send throws', async () => {
      await client.connect()

      mockSocket.write.mockImplementation(() => {
        setTimeout(() => mockSocket._emit('error', new Error('write failed')), 0)
      })

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toContain('write failed')
    })
  })
})
