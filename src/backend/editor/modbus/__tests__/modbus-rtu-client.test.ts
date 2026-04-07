jest.mock('serialport', () => ({
  SerialPort: jest.fn(),
}))

import { ModbusDebugResponse, ModbusFunctionCode } from '../modbus-client'
import { ModbusRtuClient } from '../modbus-rtu-client'

function createMockSerialPort() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    isOpen: true,
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
    write: jest.fn((_data: unknown, cb?: (err?: unknown) => void) => {
      if (cb) cb()
    }),
    close: jest.fn(),
    open: jest.fn(),
    flush: jest.fn((cb: (err: Error | null) => void) => cb(null)),
    _emit: (event: string, ...args: unknown[]) => {
      const h = handlers[event]
      if (h) h.forEach((fn) => fn(...args))
    },
    _handlers: handlers,
  }
}

/**
 * Build a Modbus RTU-like response that the client will receive.
 * The sendRequestImpl in ModbusRtuClient pads the response with 6 zero bytes at the front
 * to match TCP format offsets, so what we return from the mock serial port is the RTU frame
 * (without the 6-byte padding - that's added by sendRequestImpl).
 * The RTU frame is: [slaveId, funcCode, ...payload, crcHi, crcLo]
 * The code strips CRC and pads with 6 zeros before returning to callers.
 */
function buildRtuResponse(slaveId: number, funcCode: number, payload: Buffer): Buffer {
  const frame = Buffer.alloc(2 + payload.length + 2) // slaveId + funcCode + payload + CRC(2)
  frame.writeUInt8(slaveId, 0)
  frame.writeUInt8(funcCode, 1)
  payload.copy(frame as unknown as Uint8Array, 2)
  // Write a dummy CRC (the code logs CRC mismatches but doesn't reject them)
  frame.writeUInt16BE(0x0000, 2 + payload.length)
  return frame
}

describe('ModbusRtuClient', () => {
  let client: ModbusRtuClient
  let mockSerialPort: ReturnType<typeof createMockSerialPort>

  beforeEach(() => {
    jest.useFakeTimers()
    mockSerialPort = createMockSerialPort()
    client = new ModbusRtuClient({
      port: '/dev/ttyUSB0',
      baudRate: 115200,
      slaveId: 1,
      timeout: 5000,
      serialPort: mockSerialPort,
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('connect with injected serial port', () => {
    it('resolves when open event fires', async () => {
      const connectPromise = client.connect()
      mockSerialPort._emit('open')
      await expect(connectPromise).resolves.toBeUndefined()
    })

    it('rejects when error event fires', async () => {
      const connectPromise = client.connect()
      mockSerialPort._emit('error', new Error('port busy'))
      await expect(connectPromise).rejects.toThrow('port busy')
    })
  })

  describe('disconnect', () => {
    it('closes port when open', async () => {
      const connectPromise = client.connect()
      mockSerialPort._emit('open')
      await connectPromise

      client.disconnect()
      expect(mockSerialPort.close).toHaveBeenCalled()
    })

    it('does nothing when port is not open', () => {
      // Never connected, so serialPort is null
      client.disconnect()
      expect(mockSerialPort.close).not.toHaveBeenCalled()
    })
  })

  describe('getMd5Hash', () => {
    async function connectClient() {
      const p = client.connect()
      mockSerialPort._emit('open')
      await p
    }

    it('returns MD5 hash on success', async () => {
      await connectClient()

      const md5 = 'abc123def456abc123def456abc123de'
      const md5Buf = Buffer.from(md5, 'utf-8')
      const payload = Buffer.alloc(1 + md5Buf.length)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      md5Buf.copy(payload as unknown as Uint8Array, 1)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_GET_MD5, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        // Simulate data arriving after a small delay
        process.nextTick(() => {
          mockSerialPort._emit('data', response)
        })
      })

      const promise = client.getMd5Hash()
      // Advance past flush and frame-complete timeout
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result).toBe(md5)
    })

    it('throws on error status after retries', async () => {
      jest.useRealTimers()

      const shortTimeoutPort = createMockSerialPort()
      const c = new ModbusRtuClient({
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        slaveId: 1,
        timeout: 50,
        serialPort: shortTimeoutPort,
      })
      const cp = c.connect()
      shortTimeoutPort._emit('open')
      await cp

      // Return a response with an error status code
      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_GET_MD5, payload)

      shortTimeoutPort.write.mockImplementation((_data: unknown, cb2?: (err?: unknown) => void) => {
        if (cb2) cb2()
        setTimeout(() => shortTimeoutPort._emit('data', response), 1)
      })

      await expect(c.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
      jest.useFakeTimers()
    }, 15000)

    it('throws on timeout when no response', async () => {
      jest.useRealTimers()

      const shortTimeoutPort = createMockSerialPort()
      const c = new ModbusRtuClient({
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        slaveId: 1,
        timeout: 30,
        serialPort: shortTimeoutPort,
      })
      const cp = c.connect()
      shortTimeoutPort._emit('open')
      await cp

      // Don't emit any data - will timeout
      shortTimeoutPort.write.mockImplementation((_data: unknown, cb2?: (err?: unknown) => void) => {
        if (cb2) cb2()
      })

      await expect(c.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
      jest.useFakeTimers()
    }, 15000)
  })

  describe('getVariablesList', () => {
    async function connectClient() {
      const p = client.connect()
      mockSerialPort._emit('open')
      await p
    }

    it('returns success with variable data', async () => {
      await connectClient()

      const varData = Buffer.from([0xAA, 0xBB])
      // payload: statusCode + lastIndex(2) + tick(4) + responseSize(2) + varData
      const payload = Buffer.alloc(1 + 2 + 4 + 2 + varData.length)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      payload.writeUInt16BE(5, 1) // lastIndex
      payload.writeUInt32BE(42, 3) // tick
      payload.writeUInt16BE(varData.length, 7)
      varData.copy(payload as unknown as Uint8Array, 9)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.getVariablesList([0, 1])
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(true)
      expect(result.tick).toBe(42)
      expect(result.lastIndex).toBe(5)
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.getVariablesList([0])
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_MEMORY, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.getVariablesList([0])
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
    })

    it('returns error on unknown status code', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(0xcc, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.getVariablesList([0])
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error on function code mismatch', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      const response = buildRtuResponse(1, 0x99, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.getVariablesList([0])
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Function code mismatch')
    })

    it('returns error on too-short response', async () => {
      await connectClient()

      // Short frame: just slaveId + funcCode + CRC
      const response = Buffer.alloc(4)
      response.writeUInt8(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_GET_LIST, 1)
      response.writeUInt16BE(0, 2)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.getVariablesList([0])
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('returns error on incomplete success response', async () => {
      await connectClient()

      // Only status, no lastIndex/tick/responseSize fields
      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.getVariablesList([0])
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Incomplete success response')
    })
  })

  describe('setVariable', () => {
    async function connectClient() {
      const p = client.connect()
      mockSerialPort._emit('open')
      await p
    }

    it('returns success on valid response (force=false)', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_SET, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result).toEqual({ success: true })
    })

    it('returns success with force and value buffer', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_SET, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, true, Buffer.from([0x01]))
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result).toEqual({ success: true })
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_SET, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.ERROR_OUT_OF_MEMORY, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_SET, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
    })

    it('returns error on unknown status code', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(0xdd, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_SET, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error on function code mismatch', async () => {
      await connectClient()

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      const response = buildRtuResponse(1, 0x99, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Function code mismatch')
    })

    it('returns error on too-short response', async () => {
      await connectClient()

      const response = Buffer.alloc(4)
      response.writeUInt8(1, 0)
      response.writeUInt8(ModbusFunctionCode.DEBUG_SET, 1)
      response.writeUInt16BE(0, 2)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })
  })

  describe('flushInputBuffer error path', () => {
    it('warns on flush error but continues', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      mockSerialPort.flush.mockImplementation((cb: (err: Error | null) => void) => {
        cb(new Error('flush failed'))
      })

      const p = client.connect()
      mockSerialPort._emit('open')
      await p

      const payload = Buffer.alloc(1)
      payload.writeUInt8(ModbusDebugResponse.SUCCESS, 0)
      const response = buildRtuResponse(1, ModbusFunctionCode.DEBUG_SET, payload)

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', response))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('flush'), expect.any(String))
      warnSpy.mockRestore()
    })
  })

  describe('sendRequestImpl timeout', () => {
    it('rejects with timeout error when no response', async () => {
      // Use a short timeout
      client = new ModbusRtuClient({
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        slaveId: 1,
        timeout: 100,
        serialPort: mockSerialPort,
      })

      const p = client.connect()
      mockSerialPort._emit('open')
      await p

      // Write succeeds but no data event fires
      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
      })

      const promise = client.setVariable(0, false)
      // Advance past the timeout
      await jest.advanceTimersByTimeAsync(200)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Request timeout')
    })
  })

  describe('sendRequestImpl write error', () => {
    it('rejects when serial write fails', async () => {
      const p = client.connect()
      mockSerialPort._emit('open')
      await p

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb(new Error('write failed'))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('write failed')
    })
  })

  describe('sendRequestImpl serial error event', () => {
    it('rejects when serial port fires error during request', async () => {
      const p = client.connect()
      mockSerialPort._emit('open')
      await p

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        // Simulate serial error
        process.nextTick(() => mockSerialPort._emit('error', new Error('serial error')))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('serial error')
    })
  })

  describe('connect without injected serial port', () => {
    it('creates a real SerialPort instance', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serialportMod = require('serialport')
      const mockPort = createMockSerialPort()
      serialportMod.SerialPort.mockImplementation(() => mockPort)

      const rtuClient = new ModbusRtuClient({
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        slaveId: 1,
        timeout: 5000,
      })

      const connectPromise = rtuClient.connect()
      // Simulate the bootloader delay + open event
      mockPort._emit('open')
      await jest.advanceTimersByTimeAsync(3000) // ARDUINO_BOOTLOADER_DELAY_MS
      await expect(connectPromise).resolves.toBeUndefined()
    })

    it('rejects on error from real SerialPort', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serialportMod = require('serialport')
      const mockPort = createMockSerialPort()
      serialportMod.SerialPort.mockImplementation(() => mockPort)

      const rtuClient = new ModbusRtuClient({
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        slaveId: 1,
        timeout: 5000,
      })

      const connectPromise = rtuClient.connect()
      mockPort._emit('error', new Error('port not found'))
      await expect(connectPromise).rejects.toThrow('port not found')
    })

    it('rejects when SerialPort constructor throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serialportMod = require('serialport')
      serialportMod.SerialPort.mockImplementation(() => {
        throw new Error('constructor error')
      })

      const rtuClient = new ModbusRtuClient({
        port: '/dev/bad',
        baudRate: 115200,
        slaveId: 1,
        timeout: 5000,
      })

      await expect(rtuClient.connect()).rejects.toThrow('constructor error')
    })

    it('handles non-Error thrown from constructor', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serialportMod = require('serialport')
      serialportMod.SerialPort.mockImplementation(() => {
        throw 'string error'
      })

      const rtuClient = new ModbusRtuClient({
        port: '/dev/bad',
        baudRate: 115200,
        slaveId: 1,
        timeout: 5000,
      })

      await expect(rtuClient.connect()).rejects.toThrow('string error')
    })

    it('handles non-Error in error event', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serialportMod = require('serialport')
      const mockPort = createMockSerialPort()
      serialportMod.SerialPort.mockImplementation(() => mockPort)

      const rtuClient = new ModbusRtuClient({
        port: '/dev/bad',
        baudRate: 115200,
        slaveId: 1,
        timeout: 5000,
      })

      const connectPromise = rtuClient.connect()
      mockPort._emit('error', 'string error event')
      await expect(connectPromise).rejects.toThrow('string error event')
    })
  })

  describe('flushInputBuffer with closed port', () => {
    it('resolves immediately when port is not open', async () => {
      const closedPort = createMockSerialPort()
      closedPort.isOpen = false

      const rtuClient = new ModbusRtuClient({
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        slaveId: 1,
        timeout: 5000,
        serialPort: closedPort,
      })

      const p = rtuClient.connect()
      closedPort._emit('open')
      await p

      // Set isOpen to false after connecting
      closedPort.isOpen = false

      // The setVariable will call flushInputBuffer which should resolve immediately
      // then sendRequestImpl will throw 'Serial port is not open'
      const result = await rtuClient.setVariable(0, false)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Serial port is not open')
    })
  })

  describe('sendRequestImpl response too short', () => {
    it('rejects when response is less than 5 bytes', async () => {
      const p = client.connect()
      mockSerialPort._emit('open')
      await p

      // Return a frame that after stripping CRC will be too short (< 5 bytes with padding)
      // Actually, the frame-complete timeout fires after 10ms of silence, then validates
      const shortFrame = Buffer.from([0x01, 0x42, 0x00, 0x00]) // 4 bytes total

      mockSerialPort.write.mockImplementation((_data: unknown, cb?: (err?: unknown) => void) => {
        if (cb) cb()
        process.nextTick(() => mockSerialPort._emit('data', shortFrame))
      })

      const promise = client.setVariable(0, false)
      await jest.advanceTimersByTimeAsync(50)
      const result = await promise
      expect(result.success).toBe(false)
      expect(result.error).toContain('Response too short')
    })
  })
})
