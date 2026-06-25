/**
 * WebSocket Debug Transport — speaks the OpenPLC v4 runtime's
 * Socket.IO `/api/debug` namespace over TLS.
 *
 * Canonical, platform-agnostic — moved here from
 * `backend/editor/websocket/websocket-debug-client.ts` so openplc-web's
 * future direct-WS path (when the orchestrator's NAT punch-through
 * lands) can reuse the exact same code editor runs today.  No Node
 * `Buffer` use; `Uint8Array` end-to-end.  `socket.io-client` works
 * unchanged in both Electron's main process and the browser.
 *
 * Implements `DebugTransport` so callers route through one contract
 * regardless of underlying transport (WS vs. WebRTC datachannel vs.
 * HTTP fallback vs. simulator RTU pipe).
 *
 * Wire details — every operation here is a Modbus PDU built /
 * parsed by `backend/shared/debug/modbus-pdu.ts`.  The Socket.IO
 * envelope carries the PDU as a hex-encoded space-separated string
 * (e.g. `"45 DE AD 00 00"`); that is a transport-level encoding,
 * not part of the protocol, and lives only here.
 */

import { io, type Socket } from 'socket.io-client'

import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import {
  buildGetListRequest,
  buildGetMd5Request,
  buildSetVariableRequest,
  parseGetListResponse,
  parseGetMd5Response,
  parseSetVariableResponse,
} from './modbus-pdu'
import type { DebugSetResult, DebugTransport, DebugTransportResult, Md5ProbeResult } from './types'

const REQUEST_TIMEOUT_MS = 5000
const CONNECT_TIMEOUT_MS = 5000

export interface WebSocketDebugTransportOptions {
  host: string
  port: number
  token: string
  /** Defaults to false (accept self-signed certs).  Real runtimes
   *  ship a self-signed cert generated at install time, so the
   *  editor's main process and the orchestrator proxy both keep
   *  this off.  Set to `true` only when targeting a runtime with a
   *  trusted certificate chain. */
  rejectUnauthorized?: boolean
}

/** Bytes → "AA BB CC" hex string (the Socket.IO debug envelope). */
function bytesToHexSpaced(buf: Uint8Array): string {
  const out = new Array<string>(buf.length)
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i].toString(16).toUpperCase().padStart(2, '0')
  }
  return out.join(' ')
}

/** "AA BB CC" hex string → Uint8Array.  Tolerates extra whitespace. */
function hexSpacedToBytes(hex: string): Uint8Array {
  const parts = hex.split(/\s+/).filter(Boolean)
  const out = new Uint8Array(parts.length)
  for (let i = 0; i < parts.length; i++) {
    out[i] = parseInt(parts[i], 16)
  }
  return out
}

export class WebSocketDebugTransport implements DebugTransport {
  private host: string
  private port: number
  private token: string
  private socket: Socket | null = null
  private rejectUnauthorized: boolean

  constructor(options: WebSocketDebugTransportOptions) {
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
        auth: { token: this.token },
        rejectUnauthorized: this.rejectUnauthorized,
        reconnection: false,
        timeout: CONNECT_TIMEOUT_MS,
      })

      const timeoutHandle = setTimeout(() => {
        this.socket?.disconnect()
        reject(new Error('Connection timeout'))
      }, CONNECT_TIMEOUT_MS)

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
        if (data.status === 'ok') resolve()
        else reject(new Error('Connection failed: invalid status'))
      })
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  async getMd5Hash(): Promise<Md5ProbeResult> {
    if (!this.socket) throw new Error('Not connected to target')

    return this.sendCommand(buildGetMd5Request(), (bytes) => parseGetMd5Response(bytes), 'reject')
  }

  async getVariablesList(variableIndexes: number[]): Promise<DebugTransportResult> {
    if (!this.socket) return { success: false, error: 'Not connected to target' }

    return this.sendCommand(buildGetListRequest(variableIndexes), (bytes) => parseGetListResponse(bytes), 'resolve')
  }

  async setVariable(variableIndex: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult> {
    if (!this.socket) return { success: false, error: 'Not connected to target' }

    return this.sendCommand(
      buildSetVariableRequest(variableIndex, force, valueBuffer),
      (bytes) => parseSetVariableResponse(bytes),
      'resolve',
    )
  }

  /**
   * Send a Modbus PDU over the `debug_command` event and parse the
   * matching `debug_response`.  `errorMode` controls whether a
   * runtime / parser error rejects the promise (used by
   * `getMd5Hash`, where any error means we can't proceed) or
   * resolves it as a structured failure (used by polling /
   * setVariable, where the caller wants a Result envelope).
   *
   * Single chokepoint for the Socket.IO envelope handling — every
   * client method routes through here, so the hex encoding /
   * timeout / event registration logic lives in exactly one place.
   */
  private sendCommand<T extends DebugTransportResult | DebugSetResult>(
    pdu: Uint8Array,
    parse: (bytes: Uint8Array) => T,
    errorMode: 'resolve',
  ): Promise<T>
  private sendCommand<T extends Md5ProbeResult>(
    pdu: Uint8Array,
    parse: (bytes: Uint8Array) => T,
    errorMode: 'reject',
  ): Promise<T>
  private sendCommand<T>(
    pdu: Uint8Array,
    parse: (bytes: Uint8Array) => T,
    errorMode: 'resolve' | 'reject',
  ): Promise<T> {
    const commandHex = bytesToHexSpaced(pdu)

    return new Promise<T>((resolve, reject) => {
      const fail = (error: string) => {
        if (errorMode === 'reject') {
          reject(new Error(error))
        } else {
          resolve({ success: false, error } as unknown as T)
        }
      }

      const timeoutHandle = setTimeout(() => fail('Request timeout'), REQUEST_TIMEOUT_MS)

      const responseHandler = (response: { success: boolean; data?: string; error?: string }) => {
        clearTimeout(timeoutHandle)
        this.socket?.off('debug_response', responseHandler)

        if (!response.success) {
          fail(response.error || 'Unknown error')
          return
        }
        if (!response.data) {
          fail('No data in response')
          return
        }

        try {
          resolve(parse(hexSpacedToBytes(response.data)))
        } catch (error) {
          fail(getErrorMessage(error))
        }
      }

      this.socket!.on('debug_response', responseHandler)
      this.socket!.emit('debug_command', { command: commandHex })
    })
  }
}
