// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - serialport types are not available at build time but will be at runtime
import {
  buildGetBoardIdRequest,
  buildGetStatusRequest,
  buildPlcSetStateRequest,
  buildReadLicenseRequest,
  buildWriteLicenseRequest,
  parseGetBoardIdResponse,
  parseGetStatusResponse,
  parsePlcSetStateResponse,
  parseReadLicenseResponse,
  parseWriteLicenseResponse,
} from '@root/backend/shared/debug/modbus-pdu'
import type {
  DebugBoardIdResult,
  DebugStatusResult,
  DeviceModbusTransport,
  Md5ProbeResult,
  PlcControlResult,
} from '@root/backend/shared/debug/types'
import { PlcRuntimeState } from '@root/backend/shared/simulator/types'
import { detectTargetEndian } from '@root/frontend/utils/endian'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { SerialPort } from 'serialport'

import { ModbusDebugResponse, ModbusFunctionCode } from './modbus-client'

interface ModbusRtuClientOptions {
  port: string
  baudRate: number
  slaveId: number
  timeout: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serialPort?: any // Pre-built serial port (e.g. VirtualSerialPort for simulator)
}

interface SendRequestOptions {
  /**
   * Optional size-aware end-of-frame predictor. Given the raw accumulated
   * response buffer (the on-the-wire RTU frame, BEFORE the 6-byte TCP-compat
   * padding sendRequestImpl prepends), returns the total number of bytes the
   * complete frame is expected to have, or `null` when not enough bytes have
   * arrived yet to make that call. When provided, the request completes as
   * soon as the buffer reaches the predicted length instead of waiting for the
   * idle timeout — which truncates large multi-chunk responses at 9600 baud
   * where inter-chunk gaps exceed FRAME_COMPLETE_TIMEOUT_MS. Callers that omit
   * this fall back to the unchanged idle-timeout framing.
   */
  expectedTotalLength?: (raw: Buffer) => number | null
}

const ARDUINO_BOOTLOADER_DELAY_MS = 2500
const MD5_REQUEST_MAX_RETRIES = 3
const MD5_REQUEST_RETRY_DELAY_MS = 500

const FRAME_COMPLETE_TIMEOUT_MS = 10

export class ModbusRtuClient implements DeviceModbusTransport {
  private port: string
  private baudRate: number
  private slaveId: number
  private timeout: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serialPort: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private injectedSerialPort: any = null

  private static readonly CRC_HI_TABLE = [
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

  private static readonly CRC_LO_TABLE = [
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

  constructor(options: ModbusRtuClientOptions) {
    this.port = options.port
    this.baudRate = options.baudRate
    this.slaveId = options.slaveId
    this.timeout = options.timeout
    this.injectedSerialPort = options.serialPort ?? null
  }

  private calculateCrc(buffer: Buffer): number {
    let crcHi = 0xff
    let crcLo = 0xff

    for (let i = 0; i < buffer.length; i++) {
      const index = crcHi ^ buffer[i]
      crcHi = crcLo ^ ModbusRtuClient.CRC_HI_TABLE[index]
      crcLo = ModbusRtuClient.CRC_LO_TABLE[index]
    }

    return (crcHi << 8) | crcLo
  }

  private assembleRequest(functionCode: number, data: Buffer): Buffer {
    const frameWithoutCrc = Buffer.alloc(2 + data.length)
    frameWithoutCrc.writeUInt8(this.slaveId, 0)
    frameWithoutCrc.writeUInt8(functionCode, 1)
    data.copy(frameWithoutCrc as unknown as Uint8Array, 2)

    const crc = this.calculateCrc(frameWithoutCrc)
    const request = Buffer.alloc(frameWithoutCrc.length + 2)
    frameWithoutCrc.copy(request as unknown as Uint8Array, 0)
    request.writeUInt16BE(crc, frameWithoutCrc.length)

    return request
  }

  async connect(): Promise<void> {
    // If a pre-built serial port was provided (e.g. VirtualSerialPort), use it directly
    if (this.injectedSerialPort) {
      this.serialPort = this.injectedSerialPort
      return new Promise((resolve, reject) => {
        this.serialPort.on('open', () => resolve())
        this.serialPort.on('error', (err: Error) => reject(err))
        this.serialPort.open()
      })
    }

    return new Promise((resolve, reject) => {
      try {
        this.serialPort = new SerialPort({
          path: this.port,
          baudRate: this.baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
        })

        this.serialPort.on('open', () => {
          setTimeout(() => {
            resolve()
          }, ARDUINO_BOOTLOADER_DELAY_MS)
        })

        this.serialPort.on('error', (error: unknown) => {
          reject(error instanceof Error ? error : new Error(getErrorMessage(error)))
        })
      } catch (error) {
        reject(error instanceof Error ? error : new Error(getErrorMessage(error)))
      }
    })
  }

  disconnect(): void {
    if (this.serialPort && this.serialPort.isOpen) {
      this.serialPort.close()
      this.serialPort = null
    }
  }

  private flushInputBuffer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.serialPort || !this.serialPort.isOpen) {
        resolve()
        return
      }

      this.serialPort.flush((err: Error | null) => {
        if (err) {
          console.warn('Warning: Failed to flush serial port:', err.message)
        }
        resolve()
      })
    })
  }

  private sendRequestMutex: Promise<void> = Promise.resolve()

  private async sendRequest(request: Buffer, opts?: SendRequestOptions): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      this.sendRequestMutex = this.sendRequestMutex.then(
        () => this.sendRequestImpl(request, opts).then(resolve, reject),
        () => this.sendRequestImpl(request, opts).then(resolve, reject),
      )
    })
  }

  private async sendRequestImpl(request: Buffer, opts?: SendRequestOptions): Promise<Buffer> {
    if (!this.serialPort || !this.serialPort.isOpen) {
      throw new Error('Serial port is not open')
    }

    await this.flushInputBuffer()

    return new Promise((resolve, reject) => {
      let responseBuffer = Buffer.alloc(0)
      let frameCompleteTimeout: NodeJS.Timeout | null = null

      // Forward-declared so the timeout handler can reference them for cleanup
      const cleanup = () => {
        this.serialPort?.removeListener('data', onData)
        this.serialPort?.removeListener('error', onError)
        if (frameCompleteTimeout) {
          clearTimeout(frameCompleteTimeout)
        }
      }

      const timeoutHandle = setTimeout(() => {
        cleanup()
        reject(new Error('Request timeout'))
      }, this.timeout)

      // Strip the 2-byte CRC trailer, prepend the 6-byte TCP-compat padding the
      // rest of the client expects, and resolve. Shared by both the size-aware
      // completion and the idle-timeout fallback so they process frames identically.
      const complete = () => {
        clearTimeout(timeoutHandle)
        cleanup()

        if (responseBuffer.length < 5) {
          reject(new Error('Response too short'))
          return
        }

        const receivedCrc = responseBuffer.readUInt16BE(responseBuffer.length - 2)
        const calculatedCrc = this.calculateCrc(responseBuffer.slice(0, responseBuffer.length - 2))

        if (receivedCrc !== calculatedCrc) {
          // OpenPLC debugger ignores CRC errors — mismatch is non-fatal
        }

        const responseWithoutCrc = responseBuffer.slice(0, responseBuffer.length - 2)
        const paddedResponse = Buffer.alloc(6 + responseWithoutCrc.length)
        paddedResponse.fill(0, 0, 6)
        responseWithoutCrc.copy(paddedResponse as unknown as Uint8Array, 6)

        resolve(paddedResponse)
      }

      const onData = (data: Buffer) => {
        responseBuffer = Buffer.concat([responseBuffer, data] as unknown as Uint8Array[])

        // Size-aware framing (opt-in): if the caller can predict the full frame
        // length, complete as soon as it has fully arrived, and while the frame
        // is known-incomplete keep waiting for the remaining bytes rather than
        // letting the idle timeout truncate a multi-chunk response.
        if (opts?.expectedTotalLength) {
          const expected = opts.expectedTotalLength(responseBuffer)
          if (expected !== null) {
            if (frameCompleteTimeout) {
              clearTimeout(frameCompleteTimeout)
              frameCompleteTimeout = null
            }
            if (responseBuffer.length >= expected) {
              complete()
            }
            return
          }
        }

        // Fallback: idle-timeout end-of-frame detection (unchanged default
        // behavior for callers that pass no predictor, or before the predictor
        // has enough bytes to decide).
        if (frameCompleteTimeout) {
          clearTimeout(frameCompleteTimeout)
        }

        frameCompleteTimeout = setTimeout(() => {
          complete()
        }, FRAME_COMPLETE_TIMEOUT_MS)
      }

      const onError = (error: Error) => {
        clearTimeout(timeoutHandle)
        cleanup()
        reject(error)
      }

      this.serialPort!.on('data', onData)
      this.serialPort!.once('error', onError)
      this.serialPort!.write(request as unknown as Uint8Array, (error: unknown) => {
        if (error) {
          clearTimeout(timeoutHandle)
          cleanup()
          const errorMessage =
            typeof error === 'string'
              ? error
              : typeof error === 'object' && error !== null
                ? JSON.stringify(error)
                : 'Unknown error'
          reject(error instanceof Error ? error : new Error(errorMessage))
        }
      })
    })
  }

  async getMd5Hash(): Promise<Md5ProbeResult> {
    const functionCode = ModbusFunctionCode.DEBUG_GET_MD5
    const endiannessCheck = 0xdead

    const data = Buffer.alloc(4)
    data.writeUInt16BE(endiannessCheck, 0)
    data.writeUInt8(0, 2)
    data.writeUInt8(0, 3)

    const request = this.assembleRequest(functionCode, data)

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MD5_REQUEST_MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, MD5_REQUEST_RETRY_DELAY_MS))
        }

        const response = await this.sendRequest(request)

        if (response.length < 9) {
          throw new Error('Invalid response: too short')
        }

        const functionCodeResponse = response.readUInt8(7)
        const statusCode = response.readUInt8(8)

        if (functionCodeResponse !== (ModbusFunctionCode.DEBUG_GET_MD5 as number)) {
          throw new Error('Function code mismatch')
        }

        if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
          throw new Error(`Target returned error code: 0x${statusCode.toString(16)}`)
        }

        // Response trailer is a 2-byte runtime-driven sentinel: the
        // runtime stores the literal 0xDEAD through a native uint16_t,
        // so the bytes reflect target byte order.
        const trailerHi = response.readUInt8(response.length - 2)
        const trailerLo = response.readUInt8(response.length - 1)
        const targetEndian = detectTargetEndian(trailerHi, trailerLo)

        const md5Region = response.slice(9, response.length - 2)
        const md5 = md5Region.toString('utf-8').replace(/\0+$/, '').trim()
        return { md5, targetEndian }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(getErrorMessage(error))
        if (attempt < MD5_REQUEST_MAX_RETRIES) {
          console.warn(`MD5 request attempt ${attempt + 1} failed: ${lastError.message}. Retrying...`)
        }
      }
    }

    throw Object.assign(new Error('Failed to get MD5 hash after retries'), { cause: lastError })
  }

  async getVariablesList(variableIndexes: number[]): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    data?: Buffer
    error?: string
  }> {
    try {
      const functionCode = ModbusFunctionCode.DEBUG_GET_LIST
      const numIndexes = variableIndexes.length

      // Phase 4 PDU: each address is (arr:u8, elem:u16) — 3 bytes.
      // Editor represents DebugAddr as packed number: (arr << 16) | elem.
      const data = Buffer.alloc(2 + 3 * numIndexes)
      data.writeUInt16BE(numIndexes, 0)

      for (let i = 0; i < numIndexes; i++) {
        const packed = variableIndexes[i]
        const arr = (packed >>> 16) & 0xff
        const elem = packed & 0xffff
        data.writeUInt8(arr, 2 + i * 3)
        data.writeUInt16BE(elem, 2 + i * 3 + 1)
      }

      const request = this.assembleRequest(functionCode, data)
      const response = await this.sendRequest(request, {
        // Raw RTU frame (SUCCESS): id@0, FC@1, STATUS@2, lastIndex u16 @3..4,
        // tick u32 @5..8, responseSize u16BE @9..10, data @11.., crc 2 -> total =
        // 11 + responseSize + 2 = 13 + responseSize. A non-SUCCESS response is
        // id, FC, STATUS, crc 2 = 5 bytes, so key off STATUS. (Mirrors the C
        // runtime debugGetTraceList: mb_frame_len = 11 + responseSize / = 3.)
        expectedTotalLength: (raw) => {
          if (raw.length < 3) return null
          if (raw.readUInt8(2) !== (ModbusDebugResponse.SUCCESS as number)) return 5
          if (raw.length < 11) return null
          return 13 + raw.readUInt16BE(9)
        },
      })

      if (response.length < 9) {
        return { success: false, error: `Invalid response: too short (${response.length} bytes, need at least 9)` }
      }

      const functionCodeResponse = response.readUInt8(7)
      const statusCode = response.readUInt8(8)

      if (functionCodeResponse !== (ModbusFunctionCode.DEBUG_GET_LIST as number)) {
        return { success: false, error: 'Function code mismatch' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
        return { success: false, error: 'ERROR_OUT_OF_BOUNDS' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
        return { success: false, error: 'ERROR_OUT_OF_MEMORY' }
      }

      if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
        return { success: false, error: `Unknown error code: 0x${statusCode.toString(16)}` }
      }

      if (response.length < 17) {
        return {
          success: false,
          error: `Incomplete success response (${response.length} bytes, expected at least 17)`,
        }
      }

      const lastIndex = response.readUInt16BE(9)
      const tick = response.readUInt32BE(11)
      const responseSize = response.readUInt16BE(15)

      if (response.length < 17 + responseSize) {
        return {
          success: false,
          error: `Incomplete variable data (expected ${responseSize} bytes, got ${response.length - 17})`,
        }
      }

      const variableData = response.slice(17, 17 + responseSize)

      return {
        success: true,
        tick,
        lastIndex,
        data: variableData,
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  async setVariable(
    variableIndex: number,
    force: boolean,
    valueBuffer?: Buffer,
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const functionCode = ModbusFunctionCode.DEBUG_SET

      // Phase 4 PDU: [arr:u8, elem:u16, force:u8, len:u16, value...]
      const arr = (variableIndex >>> 16) & 0xff
      const elem = variableIndex & 0xffff

      const dataLength = force && valueBuffer ? valueBuffer.length : 1
      const data = Buffer.alloc(6 + dataLength)

      data.writeUInt8(arr, 0)
      data.writeUInt16BE(elem, 1)
      data.writeUInt8(force ? 1 : 0, 3)
      data.writeUInt16BE(dataLength, 4)

      if (force && valueBuffer) {
        for (let i = 0; i < valueBuffer.length; i++) {
          data.writeUInt8(valueBuffer[i], 6 + i)
        }
      } else {
        data.writeUInt8(0, 6)
      }

      const request = this.assembleRequest(functionCode, data)
      const response = await this.sendRequest(request)

      if (response.length < 9) {
        return { success: false, error: `Invalid response: too short (${response.length} bytes, need at least 9)` }
      }

      const functionCodeResponse = response.readUInt8(7)
      const statusCode = response.readUInt8(8)

      if (functionCodeResponse !== (ModbusFunctionCode.DEBUG_SET as number)) {
        return { success: false, error: 'Function code mismatch' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
        return { success: false, error: 'ERROR_OUT_OF_BOUNDS' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
        return { success: false, error: 'ERROR_OUT_OF_MEMORY' }
      }

      if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
        return { success: false, error: `Unknown error code: 0x${statusCode.toString(16)}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  // -------------------------------------------------------------------------
  // On-device license storage (FC 0x49/0x4A). Response offsets account for the
  // 6-byte TCP-compat padding sendRequestImpl prepends: FC@7, status@8, payload@9+.
  // The wire `len` is BIG-ENDIAN (matches the other FCs) while the blob content
  // it frames is little-endian — do not confuse the two.
  // -------------------------------------------------------------------------

  async writeLicense(
    blob: Uint8Array,
  ): Promise<{ success: boolean; status?: number; unsupported?: boolean; error?: string }> {
    try {
      // buildWriteLicenseRequest() returns [FC][len:u16BE][blob]; assembleRequest
      // writes the FC + slaveId itself, so hand it only the trailing payload.
      const pdu = buildWriteLicenseRequest(blob)
      const payload = Buffer.from(pdu.subarray(1))
      const request = this.assembleRequest(ModbusFunctionCode.DEBUG_WRITE_LICENSE, payload)
      const response = await this.sendRequest(request)

      if (response.length < 9) {
        return { success: false, error: `Invalid response: too short (${response.length} bytes, need at least 9)` }
      }

      // Strip the 6-byte TCP-compat padding; the pure PDU starts at offset 7.
      const pduResponse = Uint8Array.prototype.slice.call(response, 7)
      return parseWriteLicenseResponse(pduResponse)
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  async readLicense(): Promise<{
    success: boolean
    status?: number
    empty?: boolean
    corrupt?: boolean
    unsupported?: boolean
    blob?: Uint8Array
    error?: string
  }> {
    try {
      const pdu = buildReadLicenseRequest()
      const payload = Buffer.from(pdu.subarray(1)) // bare [FC]; no trailing payload
      const request = this.assembleRequest(ModbusFunctionCode.DEBUG_READ_LICENSE, payload)
      const response = await this.sendRequest(request, {
        // Raw RTU frame: id@0, FC@1, STATUS@2, len u16BE @3..4, blob @5.., crc 2.
        // SUCCESS → total = 1+1+1+2+len+2 = 7+len. A non-SUCCESS response carries
        // no len/blob ([id][FC][STATUS][crc:2] = 5 bytes), so key off STATUS.
        expectedTotalLength: (raw) => {
          if (raw.length < 3) return null
          if (raw.readUInt8(2) !== (ModbusDebugResponse.SUCCESS as number)) return 5
          if (raw.length < 5) return null
          return 7 + raw.readUInt16BE(3)
        },
      })

      if (response.length < 9) {
        return { success: false, error: `Invalid response: too short (${response.length} bytes, need at least 9)` }
      }

      // Strip the 6-byte TCP-compat padding; parse the pure PDU from offset 7.
      const pduResponse = Uint8Array.prototype.slice.call(response, 7)
      return parseReadLicenseResponse(pduResponse)
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * FC 0x48 DEBUG_GET_BOARD_ID. Bare `[FC]` PDU (no payload). Response offsets
   * account for the 6-byte TCP-compat padding sendRequestImpl prepends, so the
   * pure PDU `[FC][status][id_len:u8][id_bytes...]` starts at offset 7 — hand it
   * to the shared parseGetBoardIdResponse rather than parsing inline.
   */
  async getBoardId(): Promise<DebugBoardIdResult> {
    try {
      // buildGetBoardIdRequest() returns the [FC] PDU; assembleRequest writes
      // the function code + slaveId itself and expects only the trailing payload
      // (empty for board-id), so strip the leading FC byte.
      const pdu = buildGetBoardIdRequest()
      const payload = Buffer.from(pdu.subarray(1))
      const request = this.assembleRequest(ModbusFunctionCode.DEBUG_GET_BOARD_ID, payload)
      const response = await this.sendRequest(request)

      if (response.length < 9) {
        return { success: false, error: `Invalid response: too short (${response.length} bytes, need at least 9)` }
      }

      const pduResponse = Uint8Array.prototype.slice.call(response, 7)
      return parseGetBoardIdResponse(pduResponse)
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }
  /**
   * FC 0x46 -- runtime status. Reports the run/stop state, the scan counter and
   * uptime in one bare-FC round trip.
   *
   * This is the single read path for run/stop state: the frame's `running` byte
   * carries it, so no second function code is needed. It also doubles as the
   * liveness probe for a held link (any successful reply proves the firmware is
   * answering), which is why the device liveness poll uses it.
   */
  async getStatus(): Promise<DebugStatusResult> {
    try {
      // buildGetStatusRequest() returns the [FC] PDU; assembleRequest writes the
      // function code + slaveId itself and expects only the trailing payload
      // (empty here), so strip the leading FC byte.
      const pdu = buildGetStatusRequest()
      const request = this.assembleRequest(ModbusFunctionCode.DEBUG_GET_STATUS, Buffer.from(pdu.subarray(1)))
      const response = await this.sendRequest(request)

      if (response.length < 9) {
        return { success: false, error: `Invalid response: too short (${response.length} bytes, need at least 9)` }
      }
      return parseGetStatusResponse(Uint8Array.prototype.slice.call(response, 7))
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * FC 0x4b -- ask the runtime to run or stop.
   *
   * Command only; reads go through `getStatus()`. A RUN request is refused (not
   * queued) while the mode switch reads STOP, and the result says so via
   * `refusedBySwitch` so the caller can tell the user to flip the switch.
   */
  async setPlcState(state: PlcRuntimeState.RUNNING | PlcRuntimeState.STOPPED): Promise<PlcControlResult> {
    try {
      const pdu = buildPlcSetStateRequest(state)
      const request = this.assembleRequest(ModbusFunctionCode.PLC_SET_STATE, Buffer.from(pdu.subarray(1)))
      const response = await this.sendRequest(request)

      if (response.length < 8) {
        return { success: false, error: `Invalid response: too short (${response.length} bytes)` }
      }
      return parsePlcSetStateResponse(Uint8Array.prototype.slice.call(response, 7))
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

}
