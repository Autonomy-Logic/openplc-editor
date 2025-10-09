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

    const request = Buffer.alloc(10)
    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(4, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(endiannessCheck, 8)

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
}
