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

    const pduLength = 4 + 2 * numIndexes
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

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        resolve({ success: false, error: 'Request timeout' })
      }, this.timeout)

      const onData = (data: Buffer) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)

        try {
          if (data.length < 9) {
            resolve({ success: false, error: `Invalid response: too short (${data.length} bytes, need at least 9)` })
            return
          }

          const responseTransactionId = data.readUInt16BE(0)
          const responseFunctionCode = data.readUInt8(7)
          const statusCode = data.readUInt8(8)

          if (responseTransactionId !== transactionId) {
            resolve({ success: false, error: 'Transaction ID mismatch' })
            return
          }

          if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_LIST as number)) {
            resolve({ success: false, error: 'Function code mismatch' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
            resolve({ success: false, error: 'ERROR_OUT_OF_BOUNDS' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
            resolve({ success: false, error: 'ERROR_OUT_OF_MEMORY' })
            return
          }

          if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
            resolve({ success: false, error: `Unknown error code: 0x${statusCode.toString(16)}` })
            return
          }

          if (data.length < 17) {
            resolve({
              success: false,
              error: `Incomplete success response (${data.length} bytes, expected at least 17)`,
            })
            return
          }

          const lastIndex = data.readUInt16BE(9)
          const tick = data.readUInt32BE(11)
          const responseSize = data.readUInt16BE(15)

          if (data.length < 17 + responseSize) {
            resolve({
              success: false,
              error: `Incomplete variable data (expected ${responseSize} bytes, got ${data.length - 17})`,
            })
            return
          }

          const variableData = data.slice(17, 17 + responseSize)

          resolve({
            success: true,
            tick,
            lastIndex,
            data: variableData,
          })
        } catch (error) {
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

  async setVariable(
    variableIndex: number,
    force: boolean,
    value?: number,
  ): Promise<{
    success: boolean
    error?: string
  }> {
    console.log('[ModbusTcpClient] setVariable called with:', { variableIndex, force, value })

    if (!this.socket) {
      console.log('[ModbusTcpClient] Socket not connected')
      return { success: false, error: 'Not connected to target' }
    }

    const transactionId = this.incrementTransactionId()
    const protocolId = 0x0000
    const unitId = 0x00
    const functionCode = ModbusFunctionCode.DEBUG_SET

    const pduLength = !force ? 6 : 8
    const request = Buffer.alloc(6 + pduLength)

    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(pduLength, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(variableIndex, 8)
    request.writeUInt8(force ? 1 : 0, 10)
    request.writeUInt16BE(1, 11)
    if (force) {
      request.writeUInt8(value ?? 0, 13)
    }

    console.log('[ModbusTcpClient] Sending request:', {
      transactionId,
      protocolId,
      pduLength,
      unitId,
      functionCode: `0x${functionCode.toString(16)}`,
      variableIndex,
      forceFlag: force ? 1 : 0,
      dataLength: 1,
      value: force ? value ?? 0 : undefined,
      requestHex: request.toString('hex'),
    })

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        resolve({ success: false, error: 'Request timeout' })
      }, this.timeout)

      const onData = (data: Buffer) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)

        console.log('[ModbusTcpClient] Received response:', {
          length: data.length,
          hex: data.toString('hex'),
        })

        try {
          if (data.length < 9) {
            console.log('[ModbusTcpClient] Response too short')
            resolve({ success: false, error: `Invalid response: too short (${data.length} bytes, need at least 9)` })
            return
          }

          const responseTransactionId = data.readUInt16BE(0)
          const responseFunctionCode = data.readUInt8(7)
          const statusCode = data.readUInt8(8)

          console.log('[ModbusTcpClient] Response parsed:', {
            responseTransactionId,
            expectedTransactionId: transactionId,
            responseFunctionCode: `0x${responseFunctionCode.toString(16)}`,
            expectedFunctionCode: `0x${ModbusFunctionCode.DEBUG_SET.toString(16)}`,
            statusCode: `0x${statusCode.toString(16)}`,
          })

          if (responseTransactionId !== transactionId) {
            console.log('[ModbusTcpClient] Transaction ID mismatch')
            resolve({ success: false, error: 'Transaction ID mismatch' })
            return
          }

          if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_SET as number)) {
            console.log('[ModbusTcpClient] Function code mismatch')
            resolve({ success: false, error: 'Function code mismatch' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
            console.log('[ModbusTcpClient] ERROR_OUT_OF_BOUNDS')
            resolve({ success: false, error: 'ERROR_OUT_OF_BOUNDS' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
            console.log('[ModbusTcpClient] ERROR_OUT_OF_MEMORY')
            resolve({ success: false, error: 'ERROR_OUT_OF_MEMORY' })
            return
          }

          if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
            console.log('[ModbusTcpClient] Unknown error code')
            resolve({ success: false, error: `Unknown error code: 0x${statusCode.toString(16)}` })
            return
          }

          console.log('[ModbusTcpClient] Success!')
          resolve({ success: true })
        } catch (error) {
          console.error('[ModbusTcpClient] Error parsing response:', error)
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
