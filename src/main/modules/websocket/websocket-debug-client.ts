import {
  buildGetListPdu,
  buildGetMd5Pdu,
  buildSetVariablePdu,
  bytesToHexString,
  hexStringToBytes,
  parseGetListResponse,
  parseGetMd5Response,
  parseSetVariableResponse,
} from '@shared/modbus/modbus-pdu'
import { io, Socket } from 'socket.io-client'

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

  private sendCommand(commandHex: string): Promise<string> {
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

        resolve(response.data)
      }

      this.socket!.on('debug_response', responseHandler)
      this.socket!.emit('debug_command', { command: commandHex })
    })
  }

  async getMd5Hash(): Promise<string> {
    if (!this.socket) {
      throw new Error('Not connected to target')
    }

    const commandHex = bytesToHexString(buildGetMd5Pdu())
    const responseHex = await this.sendCommand(commandHex)
    const responsePdu = hexStringToBytes(responseHex)
    return parseGetMd5Response(responsePdu).md5
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

    const commandHex = bytesToHexString(buildGetListPdu(variableIndexes))

    try {
      const responseHex = await this.sendCommand(commandHex)
      const responsePdu = hexStringToBytes(responseHex)
      const result = parseGetListResponse(responsePdu)

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
    const commandHex = bytesToHexString(buildSetVariablePdu(variableIndex, force, value))

    try {
      const responseHex = await this.sendCommand(commandHex)
      const responsePdu = hexStringToBytes(responseHex)
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
