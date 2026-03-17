/**
 * WebRTC Debug Transport — wraps the existing JSON debug protocol.
 *
 * The WebRTC agent uses a JSON-based protocol (debug_get_list, debug_values_response,
 * etc.) that differs from the raw Modbus protocol used by other transports. This
 * transport encapsulates that protocol behind the standard DebugTransport interface
 * using a promise-based request/response queue (like the desktop editor's Modbus
 * sendRequestMutex).
 *
 * Supports automatic fallback to HTTP when the WebRTC DataChannel is unavailable.
 * The JSON translation layer is kept working as-is — when we later replace it with
 * direct Modbus-over-DataChannel, we simply swap this transport implementation.
 */

import { bytesToHex, hexToBytes } from '../../../utils/hex'
import { sendDebugCommandViaHttp } from '../../api/debug-transport'
import type { DebugSetResult, DebugTransport, DebugTransportResult } from '../types'

// Timeout for individual debug requests (matches desktop editor's 5000ms Modbus timeout)
const REQUEST_TIMEOUT_MS = 5000
// Timeout for connection handshake
const CONNECT_TIMEOUT_MS = 10_000

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface WebRTCTransportConfig {
  /** Send a message via WebRTC DataChannel. Returns true if sent. */
  sendViaDataChannel: (message: unknown) => boolean
  /** Agent ID for HTTP fallback */
  agentId: string
  /** Device ID for HTTP fallback and debug_start */
  deviceId: string
  /** Username for debug_start authentication */
  username: string
  /** Password for debug_start authentication */
  password: string
  /** Port for debug_start (default: 8443) */
  port?: number
  /** Called when the agent sends debug_ready (e.g. after runtime restart) */
  onReady?: () => void
}

export class WebRTCTransport implements DebugTransport {
  private config: WebRTCTransportConfig
  private disconnected = false

  // Pending request queues — one per message type
  private pendingConnect: PendingRequest<void> | null = null
  private pendingMd5: PendingRequest<string> | null = null
  private pendingGetList: PendingRequest<DebugTransportResult> | null = null
  private pendingSetVariable: PendingRequest<DebugSetResult> | null = null

  // Mutex to serialize getVariablesList calls (like desktop's sendRequestMutex)
  private getListMutex: Promise<void> = Promise.resolve()

  constructor(config: WebRTCTransportConfig) {
    this.config = config
  }

  /**
   * Connect to the debug session on the remote runtime.
   * Sends debug_start and waits for debug_connected + debug_md5_response.
   */
  async connect(): Promise<void> {
    this.disconnected = false

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingConnect = null
        reject(new Error('Debug connection timed out'))
      }, CONNECT_TIMEOUT_MS)

      this.pendingConnect = { resolve, reject, timeout }

      this.sendMessage({
        type: 'debug_start',
        device_id: this.config.deviceId,
        username: this.config.username,
        password: this.config.password,
        port: this.config.port ?? 8443,
      })
    })
  }

  /**
   * Disconnect the debug session.
   */
  disconnect(): void {
    this.disconnected = true
    this.sendMessage({ type: 'debug_stop' })
    this.rejectAllPending(new Error('Transport disconnected'))
  }

  /**
   * Get the MD5 hash from the runtime.
   */
  async getMd5Hash(): Promise<string> {
    if (this.disconnected) {
      throw new Error('Transport disconnected')
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMd5 = null
        reject(new Error('MD5 request timed out'))
      }, REQUEST_TIMEOUT_MS)

      this.pendingMd5 = { resolve, reject, timeout }

      this.sendMessage({ type: 'debug_get_md5' })
    })
  }

  /**
   * Poll variable values. Serialized via mutex to prevent concurrent requests.
   */
  async getVariablesList(indexes: number[]): Promise<DebugTransportResult> {
    if (this.disconnected) {
      return { success: false, error: 'Transport disconnected' }
    }

    return new Promise<DebugTransportResult>((resolve, reject) => {
      this.getListMutex = this.getListMutex.then(
        () => this.getVariablesListImpl(indexes).then(resolve, reject),
        () => this.getVariablesListImpl(indexes).then(resolve, reject),
      )
    })
  }

  private async getVariablesListImpl(indexes: number[]): Promise<DebugTransportResult> {
    if (this.disconnected) {
      return { success: false, error: 'Transport disconnected' }
    }

    return new Promise<DebugTransportResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingGetList = null
        reject(new Error('Get variables list request timed out'))
      }, REQUEST_TIMEOUT_MS)

      this.pendingGetList = { resolve, reject, timeout }

      this.sendMessage({
        type: 'debug_get_list',
        indexes,
      })
    })
  }

  /**
   * Force or release a variable.
   */
  async setVariable(index: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult> {
    if (this.disconnected) {
      return { success: false, error: 'Transport disconnected' }
    }

    const valueHex = force && valueBuffer ? bytesToHex(valueBuffer) : '00'

    return new Promise<DebugSetResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSetVariable = null
        reject(new Error('Set variable request timed out'))
      }, REQUEST_TIMEOUT_MS)

      this.pendingSetVariable = { resolve, reject, timeout }

      this.sendMessage({
        type: 'debug_set',
        index,
        force,
        value: valueHex,
      })
    })
  }

  /**
   * Handle an incoming debug message from the agent.
   * Called by the WebRTC DataChannel onmessage handler or HTTP response.
   * Resolves the appropriate pending promise.
   */
  onDebugMessage(rawMessage: unknown): void {
    const message = rawMessage as Record<string, unknown>
    const type = message.type as string

    switch (type) {
      case 'debug_connected':
        // Connection established — resolve the connect promise
        if (this.pendingConnect) {
          clearTimeout(this.pendingConnect.timeout)
          const pending = this.pendingConnect
          this.pendingConnect = null
          pending.resolve()
        }
        break

      case 'debug_md5_response':
        if (this.pendingMd5) {
          clearTimeout(this.pendingMd5.timeout)
          const pending = this.pendingMd5
          this.pendingMd5 = null
          pending.resolve(message.md5 as string)
        }
        break

      case 'debug_values_response': {
        if (this.pendingGetList) {
          clearTimeout(this.pendingGetList.timeout)
          const pending = this.pendingGetList
          this.pendingGetList = null

          const dataHex = message.data as string | undefined
          const tick = message.tick as number | undefined

          if (!dataHex) {
            pending.resolve({ success: true, tick, data: new Uint8Array(0) })
          } else {
            pending.resolve({
              success: true,
              tick,
              data: hexToBytes(dataHex),
              // WebRTC JSON protocol doesn't include lastIndex — all requested variables are returned
            })
          }
        }
        break
      }

      case 'debug_set_response':
        if (this.pendingSetVariable) {
          clearTimeout(this.pendingSetVariable.timeout)
          const pending = this.pendingSetVariable
          this.pendingSetVariable = null
          pending.resolve({ success: (message.success as boolean) ?? true })
        }
        break

      case 'debug_error': {
        const errorMsg = (message.error as string) || 'Unknown debug error'

        // Memory errors resolve getVariablesList with error (don't reject)
        if (errorMsg.includes('ERROR_OUT_OF_MEMORY') && this.pendingGetList) {
          clearTimeout(this.pendingGetList.timeout)
          const pending = this.pendingGetList
          this.pendingGetList = null
          pending.resolve({ success: false, error: 'ERROR_OUT_OF_MEMORY' })
          break
        }

        // Connection-phase errors reject connect
        if (this.pendingConnect) {
          clearTimeout(this.pendingConnect.timeout)
          const pending = this.pendingConnect
          this.pendingConnect = null
          pending.reject(new Error(errorMsg))
          break
        }

        // Reject whichever request is pending (check all types)
        if (this.pendingGetList) {
          clearTimeout(this.pendingGetList.timeout)
          const pending = this.pendingGetList
          this.pendingGetList = null
          pending.resolve({ success: false, error: errorMsg })
        }
        if (this.pendingMd5) {
          clearTimeout(this.pendingMd5.timeout)
          const pending = this.pendingMd5
          this.pendingMd5 = null
          pending.reject(new Error(errorMsg))
        }
        if (this.pendingSetVariable) {
          clearTimeout(this.pendingSetVariable.timeout)
          const pending = this.pendingSetVariable
          this.pendingSetVariable = null
          pending.resolve({ success: false, error: errorMsg })
        }
        break
      }

      case 'debug_disconnected':
        this.rejectAllPending(new Error('Debug session disconnected by remote'))
        break

      case 'debug_ready':
        // Auto-recovery: the remote agent restarted and is ready for a new debug session
        if (this.config.onReady) {
          this.config.onReady()
        }
        break

      case 'debug_info_response':
        // Informational — no pending request to resolve
        break

      default:
        console.log('[WebRTCTransport] Unknown message type:', type)
    }
  }

  /**
   * Send a debug message via WebRTC DataChannel (preferred) or HTTP fallback.
   */
  private sendMessage(message: unknown): void {
    const sent = this.config.sendViaDataChannel(message)
    if (sent) return

    // HTTP fallback — route response back through onDebugMessage,
    // or reject the pending promise on failure.
    void sendDebugCommandViaHttp(this.config.agentId, this.config.deviceId, message as Record<string, unknown>)
      .then((response) => {
        if (response) {
          this.onDebugMessage(response)
        }
      })
      .catch((err) => {
        console.error('[WebRTCTransport] HTTP debug command failed:', err)
        // Reject the pending promise that initiated this send so it doesn't hang until timeout
        this.rejectFirstPending(new Error(`HTTP fallback failed: ${err instanceof Error ? err.message : err}`))
      })
  }

  /**
   * Reject all pending requests (e.g. on disconnect or remote disconnection).
   */
  private rejectAllPending(error: Error): void {
    const pendingRequests = [
      this.pendingConnect,
      this.pendingMd5,
      this.pendingGetList,
      this.pendingSetVariable,
    ] as const

    for (const pending of pendingRequests) {
      if (pending) {
        clearTimeout(pending.timeout)
        pending.reject(error)
      }
    }

    this.pendingConnect = null
    this.pendingMd5 = null
    this.pendingGetList = null
    this.pendingSetVariable = null
  }

  /**
   * Reject the first pending promise found (used when HTTP fallback fails
   * and we don't know which request type triggered the send).
   */
  private rejectFirstPending(error: Error): void {
    // Order: getList is the most frequent (polling), then setVariable, md5, connect
    const candidates = [
      { ref: 'pendingGetList' as const, resolveWithError: true },
      { ref: 'pendingSetVariable' as const, resolveWithError: true },
      { ref: 'pendingMd5' as const, resolveWithError: false },
      { ref: 'pendingConnect' as const, resolveWithError: false },
    ]

    for (const { ref, resolveWithError } of candidates) {
      const pending = this[ref]
      if (pending) {
        clearTimeout(pending.timeout)
        // For polling/set results, resolve with error (don't reject — the polling loop handles it)
        // For md5/connect, reject (the caller has try/catch)
        if (resolveWithError) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(pending as PendingRequest<any>).resolve({ success: false, error: error.message })
        } else {
          pending.reject(error)
        }
        this[ref] = null
        break
      }
    }
  }

  /**
   * Update the config (e.g. when WebRTC reconnects with new channel references).
   */
  updateConfig(partial: Partial<WebRTCTransportConfig>): void {
    Object.assign(this.config, partial)
  }
}
