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
  private sendRequestMutex: Promise<void> = Promise.resolve()

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

  private sendTcpRequestImpl(request: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to target'))
        return
      }

      const timeoutHandle = setTimeout(() => {
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        reject(new Error('Request timeout'))
      }, this.timeout)

      const onData = (data: Buffer) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        resolve(data)
      }

      const onError = (error: Error) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        reject(error)
      }

      this.socket.once('data', onData)
      this.socket.once('error', onError)
      this.socket.write(request as unknown as Uint8Array)
    })
  }

  private sendTcpRequest(request: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      this.sendRequestMutex = this.sendRequestMutex.then(
        () => this.sendTcpRequestImpl(request).then(resolve, reject),
        () => this.sendTcpRequestImpl(request).then(resolve, reject),
      )
    })
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

    const data = await this.sendTcpRequest(request)

    if (data.length < 9) {
      throw new Error('Invalid response: too short')
    }

    const responseTransactionId = data.readUInt16BE(0)
    const responseFunctionCode = data.readUInt8(7)
    const statusCode = data.readUInt8(8)

    if (responseTransactionId !== transactionId) {
      throw new Error('Transaction ID mismatch')
    }

    if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_MD5 as number)) {
      throw new Error('Function code mismatch')
    }

    if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
      throw new Error(`Target returned error code: 0x${statusCode.toString(16)}`)
    }

    const md5String = data.slice(9).toString('utf-8').trim()
    return md5String
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

    try {
      const data = await this.sendTcpRequest(request)

      if (data.length < 9) {
        return { success: false, error: `Invalid response: too short (${data.length} bytes, need at least 9)` }
      }

      const responseTransactionId = data.readUInt16BE(0)
      const responseFunctionCode = data.readUInt8(7)
      const statusCode = data.readUInt8(8)

      if (responseTransactionId !== transactionId) {
        return { success: false, error: 'Transaction ID mismatch' }
      }

      if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_LIST as number)) {
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

      if (data.length < 17) {
        return {
          success: false,
          error: `Incomplete success response (${data.length} bytes, expected at least 17)`,
        }
      }

      const lastIndex = data.readUInt16BE(9)
      const tick = data.readUInt32BE(11)
      const responseSize = data.readUInt16BE(15)

      if (data.length < 17 + responseSize) {
        return {
          success: false,
          error: `Incomplete variable data (expected ${responseSize} bytes, got ${data.length - 17})`,
        }
      }

      const variableData = data.slice(17, 17 + responseSize)

      return {
        success: true,
        tick,
        lastIndex,
        data: variableData,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
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
    if (!this.socket) {
      return { success: false, error: 'Not connected to target' }
    }

    const transactionId = this.incrementTransactionId()
    const protocolId = 0x0000
    const unitId = 0x00
    const functionCode = ModbusFunctionCode.DEBUG_SET

    const dataLength = force && valueBuffer ? valueBuffer.length : 1
    const pduLength = 7 + dataLength
    const request = Buffer.alloc(6 + pduLength)

    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(pduLength, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(variableIndex, 8)
    request.writeUInt8(force ? 1 : 0, 10)
    request.writeUInt16BE(dataLength, 11)

    if (force && valueBuffer) {
      for (let i = 0; i < valueBuffer.length; i++) {
        request.writeUInt8(valueBuffer[i], 13 + i)
      }
    } else {
      request.writeUInt8(0, 13)
    }

    try {
      const data = await this.sendTcpRequest(request)

      if (data.length < 9) {
        return { success: false, error: `Invalid response: too short (${data.length} bytes, need at least 9)` }
      }

      const responseTransactionId = data.readUInt16BE(0)
      const responseFunctionCode = data.readUInt8(7)
      const statusCode = data.readUInt8(8)

      if (responseTransactionId !== transactionId) {
        return { success: false, error: 'Transaction ID mismatch' }
      }

      if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_SET as number)) {
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
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
