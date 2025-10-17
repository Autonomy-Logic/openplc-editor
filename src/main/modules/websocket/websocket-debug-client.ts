import { io, Socket } from 'socket.io-client'

import { ModbusDebugResponse, ModbusFunctionCode } from '../modbus/modbus-client'

interface WebSocketDebugClientOptions {
  host: string
  port: number
  token: string
  rejectUnauthorized?: boolean
}

export class WebSocketDebugClient {
  private host: string
  private port: number
  private token: string
  private socket: Socket | null = null
  private rejectUnauthorized: boolean

  constructor(options: WebSocketDebugClientOptions) {
    this.host = options.host
    this.port = options.port
    this.token = options.token
    this.rejectUnauthorized = options.rejectUnauthorized ?? false
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://${this.host}:${this.port}`

      this.socket = io(url, {
        path: '/socket.io',
        transports: ['websocket'],
        auth: {
          token: this.token,
        },
        rejectUnauthorized: this.rejectUnauthorized,
        reconnection: false,
        timeout: 5000,
      })

      const timeoutHandle = setTimeout(() => {
        this.socket?.disconnect()
        reject(new Error('Connection timeout'))
      }, 5000)

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeoutHandle)
        reject(error)
      })

      this.socket.io.on('error', (error) => {
        clearTimeout(timeoutHandle)
        reject(error)
      })

      this.socket.on('connected', (data: { status: string }) => {
        clearTimeout(timeoutHandle)
        if (data.status === 'ok') {
          resolve()
        } else {
          reject(new Error('Connection failed: invalid status'))
        }
      })
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  private bufferToHexString(buffer: Buffer): string {
    return Array.from(buffer)
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ')
  }

  private hexStringToBuffer(hexString: string): Buffer {
    const bytes = hexString.split(' ').map((byte) => parseInt(byte, 16))
    return Buffer.from(bytes)
  }

  async getMd5Hash(): Promise<string> {
    if (!this.socket) {
      throw new Error('Not connected to target')
    }

    const functionCode = ModbusFunctionCode.DEBUG_GET_MD5
    const endiannessCheck = 0xdead

    const request = Buffer.alloc(5)
    request.writeUInt8(functionCode, 0)
    request.writeUInt16BE(endiannessCheck, 1)
    request.writeUInt8(0, 3)
    request.writeUInt8(0, 4)

    const commandHex = this.bufferToHexString(request)

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error('Request timeout'))
      }, 5000)

      const responseHandler = (response: { success: boolean; data?: string; error?: string }) => {
        clearTimeout(timeoutHandle)
        this.socket?.off('debug_response', responseHandler)

        if (!response.success) {
          reject(new Error(response.error || 'Unknown error'))
          return
        }

        if (!response.data) {
          reject(new Error('No data in response'))
          return
        }

        try {
          const responseBuffer = this.hexStringToBuffer(response.data)

          if (responseBuffer.length < 2) {
            reject(new Error('Invalid response: too short'))
            return
          }

          const statusCode = responseBuffer.readUInt8(0)

          if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
            reject(new Error(`Target returned error code: 0x${statusCode.toString(16)}`))
            return
          }

          const md5String = responseBuffer.slice(1).toString('utf-8').trim()
          resolve(md5String)
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      this.socket!.on('debug_response', responseHandler)
      this.socket!.emit('debug_command', { command: commandHex })
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

    const functionCode = ModbusFunctionCode.DEBUG_GET_LIST
    const numIndexes = variableIndexes.length

    const request = Buffer.alloc(3 + 2 * numIndexes)
    request.writeUInt8(functionCode, 0)
    request.writeUInt16BE(numIndexes, 1)

    for (let i = 0; i < numIndexes; i++) {
      request.writeUInt16BE(variableIndexes[i], 3 + i * 2)
    }

    const commandHex = this.bufferToHexString(request)

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        resolve({ success: false, error: 'Request timeout' })
      }, 5000)

      const responseHandler = (response: { success: boolean; data?: string; error?: string }) => {
        clearTimeout(timeoutHandle)
        this.socket?.off('debug_response', responseHandler)

        if (!response.success) {
          resolve({ success: false, error: response.error || 'Unknown error' })
          return
        }

        if (!response.data) {
          resolve({ success: false, error: 'No data in response' })
          return
        }

        try {
          const responseBuffer = this.hexStringToBuffer(response.data)

          if (responseBuffer.length < 2) {
            resolve({
              success: false,
              error: `Invalid response: too short (${responseBuffer.length} bytes, need at least 2)`,
            })
            return
          }

          const statusCode = responseBuffer.readUInt8(0)

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

          if (responseBuffer.length < 10) {
            resolve({
              success: false,
              error: `Incomplete success response (${responseBuffer.length} bytes, expected at least 10)`,
            })
            return
          }

          const lastIndex = responseBuffer.readUInt16BE(1)
          const tick = responseBuffer.readUInt32BE(3)
          const responseSize = responseBuffer.readUInt16BE(7)

          if (responseBuffer.length < 9 + responseSize) {
            resolve({
              success: false,
              error: `Incomplete variable data (expected ${responseSize} bytes, got ${responseBuffer.length - 9})`,
            })
            return
          }

          const variableData = responseBuffer.slice(9, 9 + responseSize)

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

      this.socket!.on('debug_response', responseHandler)
      this.socket!.emit('debug_command', { command: commandHex })
    })
  }
}
