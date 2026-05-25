/**
 * Tests for ModbusRtuClient.
 *
 * Uses real timers with very short timeout values. The mock serial port
 * responds immediately (or not at all for timeout tests). The connect
 * bootloader delay is shortened by mocking setTimeout for connect only.
 */

import { ModbusRtuClient, type SerialPortLike } from '../modbus-rtu-client'
import { ModbusDebugResponse, ModbusFunctionCode } from '../types'

// jsdom polyfill
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextEncoder, TextDecoder } = require('util')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder
}

// ---------------------------------------------------------------------------
// Mock serial port
// ---------------------------------------------------------------------------

type Listener = (...args: any[]) => void

interface MockSerialPort extends SerialPortLike {
  _listeners: Record<string, Listener[]>
  _onceListeners: Record<string, Listener[]>
  _emit: (event: string, ...args: any[]) => void
  _interceptWrite: ((data: Uint8Array) => void) | null
  _flushError: Error | null
  _writeError: Error | null
}

function makeMockPort(): MockSerialPort {
  const listeners: Record<string, Listener[]> = {}
  const onceListeners: Record<string, Listener[]> = {}

  const port: MockSerialPort = {
    isOpen: false,
    _listeners: listeners,
    _onceListeners: onceListeners,
    _interceptWrite: null,
    _flushError: null,
    _writeError: null,

    open() {
      this.isOpen = true
    },
    close() {
      this.isOpen = false
    },
    write(data: Uint8Array, callback?: (err?: Error | null) => void) {
      if (port._writeError) {
        callback?.(port._writeError)
        return
      }
      port._interceptWrite?.(data)
      callback?.(null)
    },
    flush(callback?: (err?: Error | null) => void) {
      if (port._flushError) {
        callback?.(port._flushError)
        return
      }
      callback?.(null)
    },
    on(event: string, listener: Listener) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(listener)
    },
    once(event: string, listener: Listener) {
      if (!onceListeners[event]) onceListeners[event] = []
      onceListeners[event].push(listener)
    },
    removeListener(event: string, listener: Listener) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((l) => l !== listener)
      }
    },
    removeAllListeners(event?: string) {
      if (event) {
        delete listeners[event]
        delete onceListeners[event]
      } else {
        for (const k of Object.keys(listeners)) delete listeners[k]
        for (const k of Object.keys(onceListeners)) delete onceListeners[k]
      }
    },
    _emit(event: string, ...args: any[]) {
      for (const l of (listeners[event] ?? []).slice()) l(...args)
      const once = (onceListeners[event] ?? []).slice()
      onceListeners[event] = []
      for (const l of once) l(...args)
    },
  }
  return port
}

// ---------------------------------------------------------------------------
// CRC helper
// ---------------------------------------------------------------------------

const CRC_HI = [
  0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80,
  0x41, 0x00, 0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1,
  0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01,
  0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40,
  0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81,
  0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0,
  0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80, 0x41, 0x00,
  0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41,
  0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80,
  0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0,
  0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01,
  0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x01, 0xc0, 0x80, 0x41,
  0x00, 0xc1, 0x81, 0x40, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40, 0x01, 0xc0, 0x80,
  0x41, 0x01, 0xc0, 0x80, 0x41, 0x00, 0xc1, 0x81, 0x40,
]

const CRC_LO = [
  0x00, 0xc0, 0xc1, 0x01, 0xc3, 0x03, 0x02, 0xc2, 0xc6, 0x06, 0x07, 0xc7, 0x05, 0xc5, 0xc4, 0x04, 0xcc, 0x0c, 0x0d,
  0xcd, 0x0f, 0xcf, 0xce, 0x0e, 0x0a, 0xca, 0xcb, 0x0b, 0xc9, 0x09, 0x08, 0xc8, 0xd8, 0x18, 0x19, 0xd9, 0x1b, 0xdb,
  0xda, 0x1a, 0x1e, 0xde, 0xdf, 0x1f, 0xdd, 0x1d, 0x1c, 0xdc, 0x14, 0xd4, 0xd5, 0x15, 0xd7, 0x17, 0x16, 0xd6, 0xd2,
  0x12, 0x13, 0xd3, 0x11, 0xd1, 0xd0, 0x10, 0xf0, 0x30, 0x31, 0xf1, 0x33, 0xf3, 0xf2, 0x32, 0x36, 0xf6, 0xf7, 0x37,
  0xf5, 0x35, 0x34, 0xf4, 0x3c, 0xfc, 0xfd, 0x3d, 0xff, 0x3f, 0x3e, 0xfe, 0xfa, 0x3a, 0x3b, 0xfb, 0x39, 0xf9, 0xf8,
  0x38, 0x28, 0xe8, 0xe9, 0x29, 0xeb, 0x2b, 0x2a, 0xea, 0xee, 0x2e, 0x2f, 0xef, 0x2d, 0xed, 0xec, 0x2c, 0xe4, 0x24,
  0x25, 0xe5, 0x27, 0xe7, 0xe6, 0x26, 0x22, 0xe2, 0xe3, 0x23, 0xe1, 0x21, 0x20, 0xe0, 0xa0, 0x60, 0x61, 0xa1, 0x63,
  0xa3, 0xa2, 0x62, 0x66, 0xa6, 0xa7, 0x67, 0xa5, 0x65, 0x64, 0xa4, 0x6c, 0xac, 0xad, 0x6d, 0xaf, 0x6f, 0x6e, 0xae,
  0xaa, 0x6a, 0x6b, 0xab, 0x69, 0xa9, 0xa8, 0x68, 0x78, 0xb8, 0xb9, 0x79, 0xbb, 0x7b, 0x7a, 0xba, 0xbe, 0x7e, 0x7f,
  0xbf, 0x7d, 0xbd, 0xbc, 0x7c, 0xb4, 0x74, 0x75, 0xb5, 0x77, 0xb7, 0xb6, 0x76, 0x72, 0xb2, 0xb3, 0x73, 0xb1, 0x71,
  0x70, 0xb0, 0x50, 0x90, 0x91, 0x51, 0x93, 0x53, 0x52, 0x92, 0x96, 0x56, 0x57, 0x97, 0x55, 0x95, 0x94, 0x54, 0x9c,
  0x5c, 0x5d, 0x9d, 0x5f, 0x9f, 0x9e, 0x5e, 0x5a, 0x9a, 0x9b, 0x5b, 0x99, 0x59, 0x58, 0x98, 0x88, 0x48, 0x49, 0x89,
  0x4b, 0x8b, 0x8a, 0x4a, 0x4e, 0x8e, 0x8f, 0x4f, 0x8d, 0x4d, 0x4c, 0x8c, 0x44, 0x84, 0x85, 0x45, 0x87, 0x47, 0x46,
  0x86, 0x82, 0x42, 0x43, 0x83, 0x41, 0x81, 0x80, 0x40,
]

function calculateCrc(buffer: Uint8Array): number {
  let crcHi = 0xff
  let crcLo = 0xff
  for (let i = 0; i < buffer.length; i++) {
    const index = crcHi ^ buffer[i]
    crcHi = crcLo ^ CRC_HI[index]
    crcLo = CRC_LO[index]
  }
  return (crcHi << 8) | crcLo
}

function buildResponse(slaveId: number, functionCode: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(2 + payload.length)
  frame[0] = slaveId
  frame[1] = functionCode
  frame.set(payload, 2)
  const crc = calculateCrc(frame)
  const full = new Uint8Array(frame.length + 2)
  full.set(frame, 0)
  full[frame.length] = (crc >>> 8) & 0xff
  full[frame.length + 1] = crc & 0xff
  return full
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Test suite — uses REAL timers with a short client timeout
// ---------------------------------------------------------------------------

const CLIENT_TIMEOUT = 200 // ms — short enough for fast tests

describe('ModbusRtuClient', () => {
  let port: MockSerialPort
  let client: ModbusRtuClient

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    port = makeMockPort()
    client = new ModbusRtuClient({ slaveId: 1, timeout: CLIENT_TIMEOUT, serialPort: port })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // connect helper -- use fake timers only for the 2500ms bootloader delay
  // -----------------------------------------------------------------------
  async function connectClient(): Promise<void> {
    jest.useFakeTimers()
    const p = client.connect()
    port._emit('open')
    jest.advanceTimersByTime(2500)
    await p
    jest.useRealTimers()
    port.isOpen = true
  }

  /**
   * Configure the mock port to respond immediately (on write) with the given frame.
   * The FRAME_COMPLETE_TIMEOUT_MS (10ms) is handled by real timers.
   */
  function autoRespond(responseFrame: Uint8Array): void {
    port._interceptWrite = () => {
      // Emit data asynchronously (next tick), simulating serial response
      setTimeout(() => port._emit('data', responseFrame), 0)
    }
  }

  // -----------------------------------------------------------------------
  // connect / disconnect
  // -----------------------------------------------------------------------
  describe('connect', () => {
    it('resolves after open event and bootloader delay', async () => {
      jest.useFakeTimers()
      const p = client.connect()
      port._emit('open')
      jest.advanceTimersByTime(2500)
      await p
      jest.useRealTimers()
    })

    it('rejects on error event', async () => {
      jest.useFakeTimers()
      const p = client.connect()
      port._emit('error', new Error('port broken'))
      await expect(p).rejects.toThrow('port broken')
      jest.useRealTimers()
    })

    it('wraps non-Error objects in Error', async () => {
      jest.useFakeTimers()
      const p = client.connect()
      port._emit('error', 'string error')
      await expect(p).rejects.toThrow('string error')
      jest.useRealTimers()
    })
  })

  describe('disconnect', () => {
    it('closes the port', async () => {
      await connectClient()
      port.isOpen = true
      client.disconnect()
      expect(port.isOpen).toBe(false)
    })

    it('does nothing if port is already closed', () => {
      client.disconnect()
    })
  })

  // -----------------------------------------------------------------------
  // getMd5Hash
  // -----------------------------------------------------------------------
  describe('getMd5Hash', () => {
    it('returns MD5 hash and detects LE byte order from sentinel trailer', async () => {
      await connectClient()

      const md5 = 'abc123def456'
      const md5Bytes = new TextEncoder().encode(md5)
      // Response payload: [STATUS, md5_ascii..., sentinel_hi, sentinel_lo].
      // Runtime writes 0xDEAD via native uint16_t → LE target emits
      // [0xAD, 0xDE]; BE target emits [0xDE, 0xAD].  Simulator emulates
      // AVR (LE), so the trailer is [0xAD, 0xDE].
      const payload = new Uint8Array(1 + md5Bytes.length + 2)
      payload[0] = ModbusDebugResponse.SUCCESS
      payload.set(md5Bytes, 1)
      payload[1 + md5Bytes.length] = 0xad
      payload[1 + md5Bytes.length + 1] = 0xde
      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_GET_MD5, payload))

      const result = await client.getMd5Hash()
      expect(result).toEqual({ md5, targetEndian: 'le' })
    })

    it('detects BE byte order from a swapped sentinel', async () => {
      await connectClient()

      const md5 = 'abc123def456'
      const md5Bytes = new TextEncoder().encode(md5)
      const payload = new Uint8Array(1 + md5Bytes.length + 2)
      payload[0] = ModbusDebugResponse.SUCCESS
      payload.set(md5Bytes, 1)
      // BE target stores 0xDEAD natively → bytes [0xDE, 0xAD].
      payload[1 + md5Bytes.length] = 0xde
      payload[1 + md5Bytes.length + 1] = 0xad
      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_GET_MD5, payload))

      const result = await client.getMd5Hash()
      expect(result).toEqual({ md5, targetEndian: 'be' })
    })

    it('throws on function code mismatch after retries', async () => {
      await connectClient()

      const payload = new Uint8Array([ModbusDebugResponse.SUCCESS])
      autoRespond(buildResponse(1, 0x99, payload))

      await expect(client.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
    }, 15000)

    it('throws on error status code after retries', async () => {
      await connectClient()

      const payload = new Uint8Array([0x01])
      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_GET_MD5, payload))

      await expect(client.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
    }, 15000)

    it('throws when response is too short', async () => {
      await connectClient()

      const shortFrame = new Uint8Array([0x01, 0x45, 0x00])
      const crc = calculateCrc(shortFrame)
      const full = new Uint8Array(shortFrame.length + 2)
      full.set(shortFrame, 0)
      full[shortFrame.length] = (crc >>> 8) & 0xff
      full[shortFrame.length + 1] = crc & 0xff
      autoRespond(full)

      await expect(client.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
    }, 15000)

    it('retries on timeout and eventually fails', async () => {
      await connectClient()
      // No autoRespond -- let all requests time out

      await expect(client.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
    }, 15000)
  })

  // -----------------------------------------------------------------------
  // getVariablesList
  // -----------------------------------------------------------------------
  describe('getVariablesList', () => {
    it('returns success with variable data', async () => {
      await connectClient()

      const variableData = new Uint8Array([0xaa, 0xbb])
      const payload = new Uint8Array(1 + 2 + 4 + 2 + variableData.length)
      payload[0] = ModbusDebugResponse.SUCCESS
      payload[1] = 0x00
      payload[2] = 0x05
      payload[3] = 0x00
      payload[4] = 0x00
      payload[5] = 0x00
      payload[6] = 0x2a
      payload[7] = 0x00
      payload[8] = 0x02
      payload.set(variableData, 9)
      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, payload))

      const result = await client.getVariablesList([0, 1])
      expect(result.success).toBe(true)
      expect(result.tick).toBe(42)
      expect(result.lastIndex).toBe(5)
      expect(result.data).toEqual(variableData)
    })

    it('returns error on function code mismatch', async () => {
      await connectClient()

      const payload = new Uint8Array([ModbusDebugResponse.SUCCESS])
      autoRespond(buildResponse(1, 0x99, payload))

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toBe('Function code mismatch')
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await connectClient()

      autoRespond(
        buildResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, new Uint8Array([ModbusDebugResponse.ERROR_OUT_OF_BOUNDS])),
      )

      const result = await client.getVariablesList([999])
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await connectClient()

      autoRespond(
        buildResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, new Uint8Array([ModbusDebugResponse.ERROR_OUT_OF_MEMORY])),
      )

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
    })

    it('returns error on unknown error code', async () => {
      await connectClient()

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, new Uint8Array([0x99])))

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error on too short response (incomplete success)', async () => {
      await connectClient()

      autoRespond(
        buildResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, new Uint8Array([ModbusDebugResponse.SUCCESS, 0x00])),
      )

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Incomplete success response')
    })

    it('returns error on incomplete variable data', async () => {
      await connectClient()

      const payload = new Uint8Array(9)
      payload[0] = ModbusDebugResponse.SUCCESS
      // lastIndex = 0, tick = 1, responseSize = 10
      payload[6] = 0x01
      payload[7] = 0x00
      payload[8] = 0x0a
      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_GET_LIST, payload))

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Incomplete variable data')
    })

    it('returns error on sendRequest timeout', async () => {
      await connectClient()
      // No autoRespond

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })

    it('returns error when response has minimal length below 9 bytes', async () => {
      await connectClient()

      // Build a very short RTU frame (2 byte body + 2 CRC = 4 total)
      // After padding (6 + 2 = 8), still < 9
      const frame = new Uint8Array([0x01, 0x44])
      const crc = calculateCrc(frame)
      const full = new Uint8Array(4)
      full.set(frame, 0)
      full[2] = (crc >>> 8) & 0xff
      full[3] = crc & 0xff
      autoRespond(full)

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })
  })

  // -----------------------------------------------------------------------
  // setVariable
  // -----------------------------------------------------------------------
  describe('setVariable', () => {
    it('returns success on force with buffer', async () => {
      await connectClient()

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.SUCCESS])))

      const result = await client.setVariable(0, true, new Uint8Array([0xff]))
      expect(result.success).toBe(true)
    })

    it('returns success on release (force=false)', async () => {
      await connectClient()

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.SUCCESS])))

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(true)
    })

    it('returns error on function code mismatch', async () => {
      await connectClient()

      autoRespond(buildResponse(1, 0x99, new Uint8Array([ModbusDebugResponse.SUCCESS])))

      const result = await client.setVariable(0, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toBe('Function code mismatch')
    })

    it('returns error on ERROR_OUT_OF_BOUNDS', async () => {
      await connectClient()

      autoRespond(
        buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.ERROR_OUT_OF_BOUNDS])),
      )

      const result = await client.setVariable(999, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    })

    it('returns error on ERROR_OUT_OF_MEMORY', async () => {
      await connectClient()

      autoRespond(
        buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.ERROR_OUT_OF_MEMORY])),
      )

      const result = await client.setVariable(0, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
    })

    it('returns error on unknown status code', async () => {
      await connectClient()

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([0x99])))

      const result = await client.setVariable(0, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown error code')
    })

    it('returns error on too short response', async () => {
      await connectClient()

      const frame = new Uint8Array([0x01, 0x42])
      const crc = calculateCrc(frame)
      const full = new Uint8Array(4)
      full.set(frame, 0)
      full[2] = (crc >>> 8) & 0xff
      full[3] = crc & 0xff
      autoRespond(full)

      const result = await client.setVariable(0, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('returns error on timeout', async () => {
      await connectClient()

      const result = await client.setVariable(0, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  // -----------------------------------------------------------------------
  // sendRequestImpl edge cases
  // -----------------------------------------------------------------------
  describe('sendRequestImpl edge cases', () => {
    it('rejects when serial port is not open', async () => {
      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
    })

    it('handles error event during request', async () => {
      await connectClient()

      port._interceptWrite = () => {
        setTimeout(() => port._emit('error', new Error('USB disconnected')), 0)
      }

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('USB disconnected')
    })

    it('handles non-Error error event', async () => {
      await connectClient()

      port._interceptWrite = () => {
        setTimeout(() => port._emit('error', 'string error'), 0)
      }

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('string error')
    })

    it('handles write error', async () => {
      await connectClient()
      port._writeError = new Error('write failed')

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('write failed')
    })

    it('handles flush error gracefully', async () => {
      await connectClient()
      port._flushError = new Error('flush failed')

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.SUCCESS])))

      const result = await client.setVariable(0, false)
      expect(console.warn).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('handles flush when port is not open', async () => {
      await connectClient()
      port.isOpen = false

      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
    })

    it('serializes concurrent requests via mutex', async () => {
      await connectClient()

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.SUCCESS])))

      const [r1, r2] = await Promise.all([client.setVariable(0, false), client.setVariable(1, false)])

      expect(r1.success).toBe(true)
      expect(r2.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Coverage: unreachable-via-normal-flow defensive branches
  // These branches are guarded by sendRequestImpl checks upstream, but
  // the public methods re-check defensively. We mock sendRequest to test
  // these paths directly.
  // -----------------------------------------------------------------------
  describe('defensive branches via mocked sendRequest', () => {
    function mockSendRequest(client: ModbusRtuClient, response: Uint8Array | Error | string): void {
      // Access private sendRequest via prototype override
      ;(client as any).sendRequest = jest.fn().mockImplementation(() => {
        if (response instanceof Uint8Array) return Promise.resolve(response)
        if (response instanceof Error) return Promise.reject(response)
        return Promise.reject(response) // non-Error rejection
      })
    }

    it('getMd5Hash handles response too short (<9 bytes)', async () => {
      await connectClient()
      // Return a response shorter than 9 bytes (bypassing sendRequestImpl check)
      mockSendRequest(client, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))
      await expect(client.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
    }, 15000)

    it('getMd5Hash handles non-Error exception', async () => {
      await connectClient()
      mockSendRequest(client, 'non-error string')
      await expect(client.getMd5Hash()).rejects.toThrow('Failed to get MD5 hash after retries')
    }, 15000)

    it('getVariablesList handles response too short (<9 bytes)', async () => {
      await connectClient()
      mockSendRequest(client, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))
      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('getVariablesList handles non-Error exception', async () => {
      await connectClient()
      mockSendRequest(client, 'non-error string')
      const result = await client.getVariablesList([0])
      expect(result.success).toBe(false)
      expect(result.error).toBe('non-error string')
    })

    it('setVariable handles response too short (<9 bytes)', async () => {
      await connectClient()
      mockSendRequest(client, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))
      const result = await client.setVariable(0, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('setVariable handles non-Error exception', async () => {
      await connectClient()
      mockSendRequest(client, 'non-error string')
      const result = await client.setVariable(0, true, new Uint8Array([0x01]))
      expect(result.success).toBe(false)
      expect(result.error).toBe('non-error string')
    })
  })

  // -----------------------------------------------------------------------
  // Coverage: flushInputBuffer with null/closed port
  // -----------------------------------------------------------------------
  describe('flushInputBuffer when port becomes null', () => {
    it('resolves immediately when serialPort is null', async () => {
      await connectClient()
      // Override the port check to make it pass but then null the port before flush
      const origSendRequestImpl = (client as any).sendRequestImpl.bind(client)
      ;(client as any).sendRequestImpl = async function (this: any, request: Uint8Array) {
        // Temporarily null the port to hit flushInputBuffer early return
        const savedPort = this.serialPort
        this.serialPort = null
        try {
          await this.flushInputBuffer()
        } finally {
          this.serialPort = savedPort
        }
        return origSendRequestImpl(request)
      }.bind(client)

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.SUCCESS])))
      const result = await client.setVariable(0, false)
      expect(result.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Coverage: mutex rejection handler
  // -----------------------------------------------------------------------
  describe('sendRequest mutex rejection path', () => {
    it('continues to next request after mutex promise rejects', async () => {
      await connectClient()
      // Force the mutex to be a rejected promise
      ;(client as any).sendRequestMutex = Promise.reject(new Error('prev failed'))

      autoRespond(buildResponse(1, ModbusFunctionCode.DEBUG_SET, new Uint8Array([ModbusDebugResponse.SUCCESS])))

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // CRC mismatch
  // -----------------------------------------------------------------------
  describe('CRC handling', () => {
    it('accepts response with wrong CRC (non-fatal per spec)', async () => {
      await connectClient()

      const frame = new Uint8Array([0x01, ModbusFunctionCode.DEBUG_SET, ModbusDebugResponse.SUCCESS])
      const full = new Uint8Array(frame.length + 2)
      full.set(frame, 0)
      full[frame.length] = 0xff
      full[frame.length + 1] = 0xff

      port._interceptWrite = () => {
        setTimeout(() => port._emit('data', full), 0)
      }

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Multi-chunk response
  // -----------------------------------------------------------------------
  describe('response frame assembly', () => {
    it('assembles multi-chunk response', async () => {
      await connectClient()

      const responseFrame = buildResponse(
        1,
        ModbusFunctionCode.DEBUG_SET,
        new Uint8Array([ModbusDebugResponse.SUCCESS]),
      )

      port._interceptWrite = () => {
        const mid = Math.floor(responseFrame.length / 2)
        // First chunk immediately
        setTimeout(() => port._emit('data', responseFrame.slice(0, mid)), 0)
        // Second chunk after a small delay (< 10ms frame timeout)
        setTimeout(() => port._emit('data', responseFrame.slice(mid)), 5)
      }

      const result = await client.setVariable(0, false)
      expect(result.success).toBe(true)
    })
  })
})
