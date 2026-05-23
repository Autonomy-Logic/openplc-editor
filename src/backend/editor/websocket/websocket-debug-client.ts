import { buildGetMd5Request, parseGetMd5Response } from '@root/backend/shared/debug/modbus-pdu'
import type { Md5ProbeResult } from '@root/backend/shared/debug/types'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
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

  async getMd5Hash(): Promise<Md5ProbeResult> {
    if (!this.socket) {
      throw new Error('Not connected to target')
    }

    // Shared builders + parser — same code openplc-web routes
    // through.  The 2-byte 0xDEAD endianness sentinel the runtime
    // appends after the MD5 chars is stripped here AND classifies
    // target endian; without that, TextDecoder spilled two U+FFFD
    // replacement chars into the cached MD5 string and verification
    // always failed.  See `backend/shared/debug/modbus-pdu.ts`.
    const pdu = buildGetMd5Request()
    const commandHex = this.bufferToHexString(Buffer.from(pdu))

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
          // Buffer is a Uint8Array subclass — pass-through into the
          // shared parser.  Errors (function-code mismatch, status,
          // length) surface as exceptions that the catch below turns
          // into a reject.
          resolve(parseGetMd5Response(new Uint8Array(responseBuffer)))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(getErrorMessage(error)))
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

    // Phase 4 PDU: each address is (arr:u8, elem:u16) — 3 bytes.
    // Editor packs DebugAddr as (arr << 16) | elem.
    const request = Buffer.alloc(3 + 3 * numIndexes)
    request.writeUInt8(functionCode, 0)
    request.writeUInt16BE(numIndexes, 1)

    for (let i = 0; i < numIndexes; i++) {
      const packed = variableIndexes[i]
      const arr = (packed >>> 16) & 0xff
      const elem = packed & 0xffff
      request.writeUInt8(arr, 3 + i * 3)
      request.writeUInt16BE(elem, 3 + i * 3 + 1)
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

          const responseFunctionCode = responseBuffer.readUInt8(0)
          const statusCode = responseBuffer.readUInt8(1)

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

          if (responseBuffer.length < 10 + responseSize) {
            resolve({
              success: false,
              error: `Incomplete variable data (expected ${responseSize} bytes, got ${responseBuffer.length - 10})`,
            })
            return
          }

          const variableData = responseBuffer.slice(10, 10 + responseSize)

          resolve({
            success: true,
            tick,
            lastIndex,
            data: variableData,
          })
        } catch (error) {
          resolve({ success: false, error: getErrorMessage(error) })
        }
      }

      this.socket!.on('debug_response', responseHandler)
      this.socket!.emit('debug_command', { command: commandHex })
    })
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

    const functionCode = ModbusFunctionCode.DEBUG_SET

    // Phase 4 PDU: [FC, arr:u8, elem:u16, force:u8, len:u16, value...]
    const arr = (variableIndex >>> 16) & 0xff
    const elem = variableIndex & 0xffff

    const dataLength = force && valueBuffer ? valueBuffer.length : 1
    const request = Buffer.alloc(7 + dataLength)

    request.writeUInt8(functionCode, 0)
    request.writeUInt8(arr, 1)
    request.writeUInt16BE(elem, 2)
    request.writeUInt8(force ? 1 : 0, 4)
    request.writeUInt16BE(dataLength, 5)

    if (force && valueBuffer) {
      for (let i = 0; i < valueBuffer.length; i++) {
        request.writeUInt8(valueBuffer[i], 7 + i)
      }
    } else {
      request.writeUInt8(0, 7)
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

          const responseFunctionCode = responseBuffer.readUInt8(0)
          const statusCode = responseBuffer.readUInt8(1)

          if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_SET as number)) {
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

          resolve({ success: true })
        } catch (error) {
          resolve({ success: false, error: getErrorMessage(error) })
        }
      }

      this.socket!.on('debug_response', responseHandler)
      this.socket!.emit('debug_command', { command: commandHex })
    })
  }
}
