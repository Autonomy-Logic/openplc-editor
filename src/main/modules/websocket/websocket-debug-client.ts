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
      const url = `https://${this.host}:${this.port}/api/debug`

      this.socket = io(url, {
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

      this.socket.on('connect_error', (error: Error) => {
        clearTimeout(timeoutHandle)
        reject(error)
      })

      this.socket.io.on('error', (error: Error) => {
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

        console.log('[WebSocket Debug] getMd5Hash response:', response)

        if (!response.success) {
          console.error('[WebSocket Debug] getMd5Hash failed:', response.error)
          reject(new Error(response.error || 'Unknown error'))
          return
        }

        if (!response.data) {
          console.error('[WebSocket Debug] getMd5Hash no data in response')
          reject(new Error('No data in response'))
          return
        }

        try {
          const responseBuffer = this.hexStringToBuffer(response.data)
          console.log(
            '[WebSocket Debug] getMd5Hash response buffer length:',
            responseBuffer.length,
            'hex:',
            response.data,
          )

          if (responseBuffer.length < 2) {
            reject(new Error('Invalid response: too short'))
            return
          }

          const responseFunctionCode = responseBuffer.readUInt8(0)
          const statusCode = responseBuffer.readUInt8(1)
          console.log(
            '[WebSocket Debug] getMd5Hash fcode:',
            `0x${responseFunctionCode.toString(16)}`,
            'status:',
            `0x${statusCode.toString(16)}`,
          )

          if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_MD5 as number)) {
            reject(new Error('Function code mismatch'))
            return
          }

          if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
            reject(new Error(`Target returned error code: 0x${statusCode.toString(16)}`))
            return
          }

          const md5String = responseBuffer.slice(2).toString('utf-8').trim()
          console.log('[WebSocket Debug] getMd5Hash success:', md5String)
          resolve(md5String)
        } catch (error) {
          console.error('[WebSocket Debug] getMd5Hash parse error:', error)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      console.log('[WebSocket Debug] getMd5Hash sending command:', commandHex)
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

        console.log('[WebSocket Debug] getVariablesList response:', response)

        if (!response.success) {
          console.error('[WebSocket Debug] getVariablesList failed:', response.error)
          resolve({ success: false, error: response.error || 'Unknown error' })
          return
        }

        if (!response.data) {
          console.error('[WebSocket Debug] getVariablesList no data in response')
          resolve({ success: false, error: 'No data in response' })
          return
        }

        try {
          const responseBuffer = this.hexStringToBuffer(response.data)
          console.log(
            '[WebSocket Debug] getVariablesList response buffer length:',
            responseBuffer.length,
            'hex:',
            response.data.substring(0, 100),
          )

          if (responseBuffer.length < 2) {
            resolve({
              success: false,
              error: `Invalid response: too short (${responseBuffer.length} bytes, need at least 2)`,
            })
            return
          }

          const responseFunctionCode = responseBuffer.readUInt8(0)
          const statusCode = responseBuffer.readUInt8(1)
          console.log(
            '[WebSocket Debug] getVariablesList fcode:',
            `0x${responseFunctionCode.toString(16)}`,
            'status:',
            `0x${statusCode.toString(16)}`,
          )

          if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_LIST as number)) {
            console.error(
              '[WebSocket Debug] getVariablesList function code mismatch, expected 0x44, got:',
              `0x${responseFunctionCode.toString(16)}`,
            )
            resolve({ success: false, error: 'Function code mismatch' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
            console.error('[WebSocket Debug] getVariablesList ERROR_OUT_OF_BOUNDS')
            resolve({ success: false, error: 'ERROR_OUT_OF_BOUNDS' })
            return
          }

          if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
            console.error('[WebSocket Debug] getVariablesList ERROR_OUT_OF_MEMORY')
            resolve({ success: false, error: 'ERROR_OUT_OF_MEMORY' })
            return
          }

          if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
            console.error('[WebSocket Debug] getVariablesList unknown error code:', `0x${statusCode.toString(16)}`)
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

          const lastIndex = responseBuffer.readUInt16BE(2)
          const tick = responseBuffer.readUInt32BE(4)
          const responseSize = responseBuffer.readUInt16BE(8)
          console.log(
            '[WebSocket Debug] getVariablesList lastIndex:',
            lastIndex,
            'tick:',
            tick,
            'responseSize:',
            responseSize,
          )

          if (responseBuffer.length < 10 + responseSize) {
            resolve({
              success: false,
              error: `Incomplete variable data (expected ${responseSize} bytes, got ${responseBuffer.length - 10})`,
            })
            return
          }

          const variableData = responseBuffer.slice(10, 10 + responseSize)
          console.log('[WebSocket Debug] getVariablesList success, data bytes:', variableData.length)

          resolve({
            success: true,
            tick,
            lastIndex,
            data: variableData,
          })
        } catch (error) {
          console.error('[WebSocket Debug] getVariablesList parse error:', error)
          resolve({ success: false, error: String(error) })
        }
      }

      console.log(
        '[WebSocket Debug] getVariablesList sending command for',
        numIndexes,
        'variables, indexes:',
        variableIndexes,
        'hex:',
        commandHex,
      )
      this.socket!.on('debug_response', responseHandler)
      this.socket!.emit('debug_command', { command: commandHex })
    })
  }
}
