import {
  allocBytes,
  buildGetListPdu,
  buildGetMd5Pdu,
  buildSetVariablePdu,
  parseGetListResponse,
  parseGetMd5Response,
  parseSetVariableResponse,
  readUint16BE,
  writeUint8,
  writeUint16BE,
} from '@shared/modbus/modbus-pdu'

export interface SerialPortLike {
  isOpen: boolean
  open(): void
  close(): void
  write(data: Uint8Array, callback?: (err?: Error | null) => void): void
  flush(callback?: (err?: Error | null) => void): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener(event: string, listener: (...args: any[]) => void): void
  removeAllListeners(event?: string): void
}

interface ModbusRtuClientOptions {
  slaveId: number
  timeout: number
  serialPort: SerialPortLike
}

const MD5_REQUEST_MAX_RETRIES = 3
const MD5_REQUEST_RETRY_DELAY_MS = 500

const FRAME_COMPLETE_TIMEOUT_MS = 10

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

// ---------------------------------------------------------------------------
// Modbus RTU Client (web-compatible)
// ---------------------------------------------------------------------------

export class ModbusRtuClient {
  private slaveId: number
  private timeout: number
  private serialPort: SerialPortLike | null = null
  private injectedSerialPort: SerialPortLike

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
    this.slaveId = options.slaveId
    this.timeout = options.timeout
    this.injectedSerialPort = options.serialPort
  }

  private calculateCrc(buffer: Uint8Array): number {
    let crcHi = 0xff
    let crcLo = 0xff

    for (let i = 0; i < buffer.length; i++) {
      const index = crcHi ^ buffer[i]
      crcHi = crcLo ^ ModbusRtuClient.CRC_HI_TABLE[index]
      crcLo = ModbusRtuClient.CRC_LO_TABLE[index]
    }

    return (crcHi << 8) | crcLo
  }

  private assembleRequest(functionCode: number, data: Uint8Array): Uint8Array {
    const frameWithoutCrc = allocBytes(2 + data.length)
    writeUint8(frameWithoutCrc, 0, this.slaveId)
    writeUint8(frameWithoutCrc, 1, functionCode)
    frameWithoutCrc.set(data, 2)

    const crc = this.calculateCrc(frameWithoutCrc)
    const request = allocBytes(frameWithoutCrc.length + 2)
    request.set(frameWithoutCrc, 0)
    writeUint16BE(request, frameWithoutCrc.length, crc)

    return request
  }

  async connect(): Promise<void> {
    this.serialPort = this.injectedSerialPort
    return new Promise((resolve, reject) => {
      this.serialPort!.on('open', () => resolve())
      this.serialPort!.on('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))))
      this.serialPort!.open()
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

      this.serialPort.flush((err?: Error | null) => {
        if (err) {
          console.warn('Warning: Failed to flush serial port:', err.message)
        }
        resolve()
      })
    })
  }

  private sendRequestMutex: Promise<void> = Promise.resolve()

  private async sendRequest(request: Uint8Array): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      this.sendRequestMutex = this.sendRequestMutex.then(
        () => this.sendRequestImpl(request).then(resolve, reject),
        () => this.sendRequestImpl(request).then(resolve, reject),
      )
    })
  }

  private async sendRequestImpl(request: Uint8Array): Promise<Uint8Array> {
    if (!this.serialPort || !this.serialPort.isOpen) {
      throw new Error('Serial port is not open')
    }

    await this.flushInputBuffer()

    return new Promise((resolve, reject) => {
      let responseBuffer = allocBytes(0)
      let frameCompleteTimeout: ReturnType<typeof setTimeout> | null = null

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

      const onData = (data: Uint8Array) => {
        responseBuffer = concatBytes(responseBuffer, data)

        if (frameCompleteTimeout) {
          clearTimeout(frameCompleteTimeout)
        }

        frameCompleteTimeout = setTimeout(() => {
          clearTimeout(timeoutHandle)
          cleanup()

          if (responseBuffer.length < 5) {
            reject(new Error('Response too short'))
            return
          }

          const receivedCrc = readUint16BE(responseBuffer, responseBuffer.length - 2)
          const calculatedCrc = this.calculateCrc(responseBuffer.slice(0, responseBuffer.length - 2))

          if (receivedCrc !== calculatedCrc) {
            // OpenPLC debugger ignores CRC errors — mismatch is non-fatal
          }

          const responseWithoutCrc = responseBuffer.slice(0, responseBuffer.length - 2)
          const paddedResponse = allocBytes(6 + responseWithoutCrc.length)
          // First 6 bytes are zeros (padding for TCP header compatibility)
          paddedResponse.set(responseWithoutCrc, 6)

          resolve(paddedResponse)
        }, FRAME_COMPLETE_TIMEOUT_MS)
      }

      const onError = (error: unknown) => {
        clearTimeout(timeoutHandle)
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      this.serialPort!.on('data', onData)
      this.serialPort!.once('error', onError)
      this.serialPort!.write(request, (error?: Error | null) => {
        if (error) {
          clearTimeout(timeoutHandle)
          cleanup()
          reject(error)
        }
      })
    })
  }

  private extractPdu(response: Uint8Array): Uint8Array {
    // RTU response is padded: [6 zero bytes][slave ID][PDU...]
    // PDU starts at offset 7
    if (response.length < 9) {
      throw new Error(`Invalid response: too short (${response.length} bytes, need at least 9)`)
    }
    return response.subarray(7)
  }

  async getMd5Hash(): Promise<string> {
    const pdu = buildGetMd5Pdu()
    const request = this.assembleRequest(pdu[0], pdu.subarray(1))

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MD5_REQUEST_MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, MD5_REQUEST_RETRY_DELAY_MS))
        }

        const response = await this.sendRequest(request)
        const responsePdu = this.extractPdu(response)
        return parseGetMd5Response(responsePdu).md5
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
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
    data?: Uint8Array
    error?: string
  }> {
    try {
      const pdu = buildGetListPdu(variableIndexes)
      const request = this.assembleRequest(pdu[0], pdu.subarray(1))
      const response = await this.sendRequest(request)
      const responsePdu = this.extractPdu(response)
      const result = parseGetListResponse(responsePdu)

      if ('error' in result) {
        return { success: false, error: result.error }
      }

      return {
        success: true,
        tick: result.tick,
        lastIndex: result.lastIndex,
        data: result.data,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async setVariable(
    variableIndex: number,
    force: boolean,
    valueBuffer?: Uint8Array,
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const pdu = buildSetVariablePdu(variableIndex, force, valueBuffer)
      const request = this.assembleRequest(pdu[0], pdu.subarray(1))
      const response = await this.sendRequest(request)
      const responsePdu = this.extractPdu(response)
      const result = parseSetVariableResponse(responsePdu)

      if ('error' in result) {
        return { success: false, error: result.error }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
