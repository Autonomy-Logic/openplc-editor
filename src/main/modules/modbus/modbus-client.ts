import { Socket } from 'net'

export enum ModbusFunctionCode {
  DEBUG_INFO = 0x41,
  DEBUG_SET = 0x42,
  DEBUG_GET = 0x43,
  DEBUG_GET_LIST = 0x44,
  DEBUG_GET_MD5 = 0x45,
}

export enum ModbusDebugResponse {
  SUCCESS = 0x7e,
  ERROR_OUT_OF_BOUNDS = 0x81,
  ERROR_OUT_OF_MEMORY = 0x82,
}

interface ModbusTcpClientOptions {
  host: string
  port: number
  timeout: number
}

export class ModbusTcpClient {
  private host: string
  private port: number
  private timeout: number
  private socket: Socket | null = null
  private transactionId: number = 0

  constructor(options: ModbusTcpClientOptions) {
    this.host = options.host
    this.port = options.port
    this.timeout = options.timeout
  }

  private incrementTransactionId(): number {
    this.transactionId = (this.transactionId + 1) % 65536
    return this.transactionId
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket()

      const timeoutHandle = setTimeout(() => {
        this.socket?.destroy()
        reject(new Error('Connection timeout'))
      }, this.timeout)

      this.socket.connect(this.port, this.host, () => {
        clearTimeout(timeoutHandle)
        resolve()
      })

      this.socket.on('error', (error) => {
        clearTimeout(timeoutHandle)
        reject(error)
      })
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }

  async getMd5Hash(): Promise<string> {
    if (!this.socket) {
      throw new Error('Not connected to target')
    }

    const transactionId = this.incrementTransactionId()
    const protocolId = 0x0000
    const unitId = 0x00
    const functionCode = ModbusFunctionCode.DEBUG_GET_MD5
    const endiannessCheck = 0xdead

    const request = Buffer.alloc(12)
    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(6, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(endiannessCheck, 8)
    request.writeUInt8(0, 10)
    request.writeUInt8(0, 11)

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error('Request timeout'))
      }, this.timeout)

      const onData = (data: Buffer) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)

        try {
          if (data.length < 9) {
            reject(new Error('Invalid response: too short'))
            return
          }

          const responseTransactionId = data.readUInt16BE(0)
          const responseFunctionCode = data.readUInt8(7)
          const statusCode = data.readUInt8(8)

          if (responseTransactionId !== transactionId) {
            reject(new Error('Transaction ID mismatch'))
            return
          }

          if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_MD5 as number)) {
            reject(new Error('Function code mismatch'))
            return
          }

          if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
            reject(new Error(`Target returned error code: 0x${statusCode.toString(16)}`))
            return
          }

          const md5String = data.slice(9).toString('utf-8').trim()
          resolve(md5String)
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      const onError = (error: Error) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        reject(error)
      }

      this.socket!.once('data', onData)
      this.socket!.once('error', onError)
      this.socket!.write(request as unknown as Uint8Array)
    })
  }

  async getVariablesList(variableIndexes: number[]): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    data?: Buffer
    error?: string
  }> {
    if (!this.socket) {
      return { success: false, error: 'Not connected to target' }
    }

    const transactionId = this.incrementTransactionId()
    const protocolId = 0x0000
    const unitId = 0x00
    const functionCode = ModbusFunctionCode.DEBUG_GET_LIST
    const numIndexes = variableIndexes.length

    const pduLength = 3 + 2 * numIndexes
    const request = Buffer.alloc(6 + pduLength)

    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(pduLength, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(numIndexes, 8)

    for (let i = 0; i < numIndexes; i++) {
      request.writeUInt16BE(variableIndexes[i], 10 + i * 2)
    }

    console.log('[DEBUG] Modbus DEBUG_GET_LIST request:', {
      variableIndexes,
      numIndexes,
      length: request.length,
      hex: request.toString('hex'),
      bytes: Array.from(request)
        .map((b) => `0x${b.toString(16).padStart(2, '0')}`)
        .join(' '),
    })

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        resolve({ success: false, error: 'Request timeout' })
      }, this.timeout)

      const onData = (data: Buffer) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)

        try {
          console.log('[DEBUG] Modbus DEBUG_GET_LIST response received:', {
            length: data.length,
            hex: data.toString('hex'),
            bytes: Array.from(data)
              .map((b) => `0x${b.toString(16).padStart(2, '0')}`)
              .join(' '),
          })

          if (data.length < 9) {
            console.error('[DEBUG] Response too short for minimum valid response:', data.length, 'bytes')
            resolve({ success: false, error: `Invalid response: too short (${data.length} bytes, need at least 9)` })
            return
          }

          const responseTransactionId = data.readUInt16BE(0)
          const responseFunctionCode = data.readUInt8(7)
          const statusCode = data.readUInt8(8)

          console.log('[DEBUG] Parsed response header:', {
            transactionId: responseTransactionId,
            expectedTransactionId: transactionId,
            functionCode: `0x${responseFunctionCode.toString(16)}`,
            statusCode: `0x${statusCode.toString(16)}`,
          })

          if (responseTransactionId !== transactionId) {
            resolve({ success: false, error: 'Transaction ID mismatch' })
            return
          }

          if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_LIST as number)) {
            resolve({ success: false, error: 'Function code mismatch' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
            console.log('[DEBUG] Target returned ERROR_OUT_OF_BOUNDS')
            resolve({ success: false, error: 'ERROR_OUT_OF_BOUNDS' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
            console.log('[DEBUG] Target returned ERROR_OUT_OF_MEMORY')
            resolve({ success: false, error: 'ERROR_OUT_OF_MEMORY' })
            return
          }

          if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
            console.error('[DEBUG] Unknown status code:', `0x${statusCode.toString(16)}`)
            resolve({ success: false, error: `Unknown error code: 0x${statusCode.toString(16)}` })
            return
          }

          if (data.length < 17) {
            console.error('[DEBUG] Success response too short:', data.length, 'bytes, expected at least 17')
            resolve({
              success: false,
              error: `Incomplete success response (${data.length} bytes, expected at least 17)`,
            })
            return
          }

          console.log('[DEBUG] About to parse success response fields...')
          const lastIndex = data.readUInt16BE(9)
          console.log('[DEBUG] lastIndex:', lastIndex)
          const tick = data.readUInt32BE(11)
          console.log('[DEBUG] tick:', tick)
          const responseSize = data.readUInt16BE(15)
          console.log('[DEBUG] responseSize:', responseSize)

          if (data.length < 17 + responseSize) {
            console.error('[DEBUG] Incomplete variable data:', {
              expected: responseSize,
              available: data.length - 17,
            })
            resolve({
              success: false,
              error: `Incomplete variable data (expected ${responseSize} bytes, got ${data.length - 17})`,
            })
            return
          }

          const variableData = data.slice(17, 17 + responseSize)
          console.log('[DEBUG] Variable data extracted:', {
            length: variableData.length,
            hex: variableData.toString('hex'),
          })

          resolve({
            success: true,
            tick,
            lastIndex,
            data: variableData,
          })
        } catch (error) {
          console.error('[DEBUG] Exception in Modbus response parsing:', error)
          resolve({ success: false, error: String(error) })
        }
      }

      const onError = (error: Error) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        resolve({ success: false, error: error.message })
      }

      this.socket!.once('data', onData)
      this.socket!.once('error', onError)
      this.socket!.write(request as unknown as Uint8Array)
    })
  }
}
