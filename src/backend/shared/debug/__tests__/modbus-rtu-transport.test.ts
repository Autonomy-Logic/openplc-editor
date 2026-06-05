// ---------------------------------------------------------------------------
// Mock simulatorService (imported via '../simulator' barrel)
// ---------------------------------------------------------------------------
const mockConnectDebugger = jest.fn()
const mockDisconnectDebugger = jest.fn()
const mockGetMd5Hash = jest.fn()
const mockIsRunning = jest.fn()
const mockGetVariablesList = jest.fn()
const mockSetVariable = jest.fn()

jest.mock('../../simulator', () => ({
  simulatorService: {
    connectDebugger: mockConnectDebugger,
    disconnectDebugger: mockDisconnectDebugger,
    getMd5Hash: mockGetMd5Hash,
    isRunning: mockIsRunning,
    getVariablesList: mockGetVariablesList,
    setVariable: mockSetVariable,
  },
}))

// ---------------------------------------------------------------------------
// Mock hex helpers
// ---------------------------------------------------------------------------
jest.mock('../../../../frontend/utils/hex', () => ({
  hexToBytes: jest.fn((hex: string) => {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }),
  bytesToHex: jest.fn((bytes: Uint8Array) => {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }),
}))

import { ModbusRtuTransport } from '../modbus-rtu-transport'

describe('ModbusRtuTransport', () => {
  let transport: ModbusRtuTransport

  beforeEach(() => {
    jest.clearAllMocks()
    transport = new ModbusRtuTransport()
  })

  // -----------------------------------------------------------------------
  // connect
  // -----------------------------------------------------------------------
  describe('connect', () => {
    it('delegates to simulatorService.connectDebugger', async () => {
      mockConnectDebugger.mockResolvedValue(undefined)
      await transport.connect()
      expect(mockConnectDebugger).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // disconnect
  // -----------------------------------------------------------------------
  describe('disconnect', () => {
    it('delegates to simulatorService.disconnectDebugger', () => {
      transport.disconnect()
      expect(mockDisconnectDebugger).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // getMd5Hash
  // -----------------------------------------------------------------------
  describe('getMd5Hash', () => {
    it('delegates to simulatorService.getMd5Hash and reports LE byte order', async () => {
      // The web simulator path reads MD5 from the built artifact
      // (deterministic, no wire) and the emulated AVR is always LE,
      // so the transport hard-codes `targetEndian: 'le'` here.
      mockGetMd5Hash.mockResolvedValue('abc123')
      const result = await transport.getMd5Hash()
      expect(result).toEqual({ md5: 'abc123', targetEndian: 'le' })
      expect(mockGetMd5Hash).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // getVariablesList
  // -----------------------------------------------------------------------
  describe('getVariablesList', () => {
    it('returns error when simulator is not running', async () => {
      mockIsRunning.mockReturnValue(false)
      const result = await transport.getVariablesList([0, 1])
      expect(result).toEqual({ success: false, error: 'Simulator is not running' })
    })

    it('returns error when simulatorService call fails', async () => {
      mockIsRunning.mockReturnValue(true)
      mockGetVariablesList.mockResolvedValue({ success: false, error: 'some error' })

      const result = await transport.getVariablesList([0])
      expect(result).toEqual({ success: false, error: 'some error' })
    })

    it('returns success with converted data', async () => {
      mockIsRunning.mockReturnValue(true)
      mockGetVariablesList.mockResolvedValue({
        success: true,
        tick: 42,
        lastIndex: 5,
        data: '0a1b',
      })

      const result = await transport.getVariablesList([0, 1, 2])

      expect(result.success).toBe(true)
      expect(result.tick).toBe(42)
      expect(result.lastIndex).toBe(5)
      expect(result.data).toEqual(new Uint8Array([0x0a, 0x1b]))
    })

    it('returns success with undefined data when hex data is absent', async () => {
      mockIsRunning.mockReturnValue(true)
      mockGetVariablesList.mockResolvedValue({
        success: true,
        tick: 10,
        lastIndex: 0,
        data: undefined,
      })

      const result = await transport.getVariablesList([0])
      expect(result.success).toBe(true)
      expect(result.data).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // setVariable
  // -----------------------------------------------------------------------
  describe('setVariable', () => {
    it('passes hex-encoded value when force=true and buffer provided', async () => {
      mockSetVariable.mockResolvedValue({ success: true })
      const buf = new Uint8Array([0xff, 0x01])

      const result = await transport.setVariable(3, true, buf)

      expect(result).toEqual({ success: true })
      expect(mockSetVariable).toHaveBeenCalledWith(3, true, 'ff01')
    })

    it('passes undefined hex when force=false', async () => {
      mockSetVariable.mockResolvedValue({ success: true })

      await transport.setVariable(5, false, new Uint8Array([0x01]))

      expect(mockSetVariable).toHaveBeenCalledWith(5, false, undefined)
    })

    it('passes undefined hex when force=true but no buffer', async () => {
      mockSetVariable.mockResolvedValue({ success: true })

      await transport.setVariable(5, true, undefined)

      expect(mockSetVariable).toHaveBeenCalledWith(5, true, undefined)
    })
  })
})
