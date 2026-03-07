import {
  buildGetListPdu,
  buildGetMd5Pdu,
  buildSetVariablePdu,
  parseGetListResponse,
  parseGetMd5Response,
  parseSetVariableResponse,
} from '@shared/modbus/modbus-pdu'
import { Socket } from 'net'

export { ModbusDebugResponse, ModbusFunctionCode } from '@shared/modbus/modbus-pdu'

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

  private wrapMbap(pdu: Uint8Array): { request: Buffer; transactionId: number } {
    const transactionId = this.incrementTransactionId()
    const request = Buffer.alloc(7 + pdu.length)
    request.writeUInt16BE(transactionId, 0) // Transaction ID
    request.writeUInt16BE(0x0000, 2) // Protocol ID
    request.writeUInt16BE(1 + pdu.length, 4) // Length (unit ID + PDU)
    request.writeUInt8(0x00, 6) // Unit ID
    request.set(pdu, 7) // PDU
    return { request, transactionId }
  }

  private stripMbap(data: Buffer, expectedTransactionId: number): Uint8Array {
    if (data.length < 9) {
      throw new Error(`Invalid response: too short (${data.length} bytes, need at least 9)`)
    }
    const responseTransactionId = data.readUInt16BE(0)
    if (responseTransactionId !== expectedTransactionId) {
      throw new Error('Transaction ID mismatch')
    }
    return new Uint8Array(data.buffer, data.byteOffset + 7, data.length - 7)
  }

  async getMd5Hash(): Promise<string> {
    if (!this.socket) {
      throw new Error('Not connected to target')
    }

    const { request, transactionId } = this.wrapMbap(buildGetMd5Pdu())
    const data = await this.sendTcpRequest(request)
    const pdu = this.stripMbap(data, transactionId)
    return parseGetMd5Response(pdu).md5
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

    const { request, transactionId } = this.wrapMbap(buildGetListPdu(variableIndexes))

    try {
      const data = await this.sendTcpRequest(request)
      const pdu = this.stripMbap(data, transactionId)
      const result = parseGetListResponse(pdu)

      if ('error' in result) {
        return { success: false, error: result.error }
      }

      return {
        success: true,
        tick: result.tick,
        lastIndex: result.lastIndex,
        data: Buffer.from(result.data),
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

    const value = valueBuffer ? new Uint8Array(valueBuffer) : undefined
    const { request, transactionId } = this.wrapMbap(buildSetVariablePdu(variableIndex, force, value))

    try {
      const data = await this.sendTcpRequest(request)
      const pdu = this.stripMbap(data, transactionId)
      const result = parseSetVariableResponse(pdu)

      if ('error' in result) {
        return { success: false, error: result.error }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
