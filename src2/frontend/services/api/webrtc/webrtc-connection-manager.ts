/**
 * WebRTC Connection Manager
 *
 * A plain TypeScript class that owns the full WebRTC connection lifecycle:
 * - RTCPeerConnection creation with STUN configuration
 * - Data channel management (main + debug)
 * - SDP offer/answer exchange via the signaling service
 * - ICE candidate exchange
 * - Keep-alive ping/pong
 * - Reconnection state machine (3 attempts with 40s ICE timeout)
 *
 * This class has zero React dependencies. A thin hook (`useWebRTCConnection`)
 * creates an instance and bridges it to React state.
 */

import type { WebRTCActions, WebRTCConnectionStatus } from '../../../store/slices/webrtc/types'
import { ChunkReassembler } from './webrtc-chunked-message'
import { handleCommandResponse,setDataChannel } from './webrtc-command'
import {
  closeWebRTCSession,
  createWebRTCSession,
  sendIceCandidate,
  subscribeToIceCandidates,
} from './webrtc-signaling'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebRTCManagerCallbacks {
  onStatusChange?: (status: WebRTCConnectionStatus) => void
  onError?: (error: string) => void
  onMessage?: (message: unknown) => void
  onDebugMessage?: (message: unknown) => void
}

export interface WebRTCManagerConfig {
  deviceId: string
  deviceName: string
  agentId: string
  webrtcActions: WebRTCActions
  callbacks: WebRTCManagerCallbacks
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const PING_INTERVAL_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 1000
/** Time to wait for ICE to reach connected/completed state after signaling. */
const ICE_TIMEOUT_MS = 40000

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class WebRTCConnectionManager {
  // Configuration
  private readonly deviceId: string
  private readonly deviceName: string
  private readonly agentId: string
  private readonly webrtcActions: WebRTCActions

  // Mutable callbacks — updated by the hook when React props change
  private callbacks: WebRTCManagerCallbacks

  // WebRTC objects
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private debugChannel: RTCDataChannel | null = null
  private cleanupSse: (() => void) | null = null
  private chunkReassembler: ChunkReassembler | null = null

  // Timers
  private pingInterval: number | null = null
  private staleCleanupInterval: number | null = null
  private reconnectTimeout: number | null = null
  private iceTimeout: number | null = null

  // Reconnection state machine
  private reconnectAttempt = 0
  private isReconnecting = false

  // Session ID (stored locally so disconnect doesn't depend on React store)
  private sessionId: string | null = null

  // Lifecycle flag — guards async continuations after dispose
  private disposed = false

  constructor(config: WebRTCManagerConfig) {
    this.deviceId = config.deviceId
    this.deviceName = config.deviceName
    this.agentId = config.agentId
    this.webrtcActions = config.webrtcActions
    this.callbacks = { ...config.callbacks }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Replace callback references (called by the hook when React props change).
   */
  updateCallbacks(callbacks: Partial<WebRTCManagerCallbacks>): void {
    Object.assign(this.callbacks, callbacks)
  }

  /**
   * Connect to the device via WebRTC.
   * @param isRetry — true when called from scheduleReconnect (preserves attempt counter)
   */
  async connect(isRetry = false): Promise<void> {
    if (!this.deviceId || !this.agentId) {
      console.error('[WebRTC] Missing required parameters — deviceId:', this.deviceId, 'agentId:', this.agentId)
      throw new Error('Missing deviceId or agentId for WebRTC connection')
    }

    // Cancel any pending reconnection to prevent races
    this.cancelReconnect()

    // Reset reconnect counter only on fresh (non-retry) connection attempts
    if (!isRetry) {
      this.reconnectAttempt = 0
      this.webrtcActions.setReconnectAttempt(0)
    }

    // Tear down any existing resources before creating new ones
    this.cleanup()

    try {
      // Start session in store
      this.webrtcActions.startSession({
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        agentId: this.agentId,
      })
      this.updateStatus('connecting')

      // 1. Create peer connection with STUN servers
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      this.pc = pc

      // 2. Create data channel BEFORE creating offer (required by WebRTC spec)
      const channel = pc.createDataChannel('data')
      this.channel = channel

      // 3. Set up data channel event handlers
      channel.onopen = () => {
        if (this.disposed) return
        console.log('[WebRTC] Data channel opened successfully!')
        // Clear ICE timeout — connection is established
        this.clearIceTimeout()
        // Reset reconnection counter on successful connection
        this.reconnectAttempt = 0
        this.webrtcActions.setReconnectAttempt(0)
        this.updateStatus('connected')
        setDataChannel(channel)
        this.startPingInterval()
      }

      channel.onclose = () => {
        if (this.disposed) return
        console.log('[WebRTC] Data channel closed')
        setDataChannel(null)
        this.stopPingInterval()
        this.updateStatus('disconnected')
      }

      channel.onerror = (event) => {
        if (this.disposed) return
        console.error('[WebRTC] Data channel error:', event)
        this.handleError('Data channel error')
      }

      // Chunk reassembler for receiving large messages
      this.chunkReassembler = new ChunkReassembler()

      // Periodically clean up stale chunk transfers
      this.staleCleanupInterval = window.setInterval(() => {
        this.chunkReassembler?.cleanupStale()
      }, PING_INTERVAL_MS)

      channel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)

          // Check for chunk protocol messages
          if (this.chunkReassembler?.isChunkMessage(msg.type)) {
            const assembled = this.chunkReassembler.handleChunkMessage(msg)
            if (assembled) {
              const fullMsg = JSON.parse(assembled)
              this.dispatchMessage(fullMsg)
            }
            return
          }

          this.dispatchMessage(msg)
        } catch (err) {
          console.error('[WebRTC] Failed to parse message:', err)
        }
      }

      // 4. Set up ICE connection state monitoring
      pc.oniceconnectionstatechange = () => {
        if (this.disposed) return
        const state = pc.iceConnectionState
        if (state === 'connected' || state === 'completed') {
          // ICE connected — clear the timeout (data channel onopen will set status)
          this.clearIceTimeout()
        } else if (state === 'failed' || state === 'disconnected') {
          console.error('[WebRTC] ICE connection failed or disconnected')
          this.clearIceTimeout()
          this.handleError('ICE connection failed')
        }
      }

      pc.onconnectionstatechange = () => {
        if (this.disposed) return
        if (pc.connectionState === 'failed') {
          console.error('[WebRTC] Peer connection failed')
          this.clearIceTimeout()
          this.handleError('Connection failed')
        }
      }

      // 5. Create and set local description (SDP offer)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // 6. Wait for ICE gathering to complete (or timeout)
      await waitForIceGathering(pc, 5000)

      if (this.disposed) return

      // 7. Send offer to backend and get answer
      const response = await createWebRTCSession({
        deviceId: this.deviceId,
        sdp: pc.localDescription!.sdp,
      })

      if (this.disposed) return

      if (response.status !== 'success' || !response.sdp) {
        console.error('[WebRTC] Backend returned error or missing SDP')
        throw new Error(response.error || 'Failed to create WebRTC session')
      }

      // Store session ID locally and in the store
      this.sessionId = response.sessionId
      this.webrtcActions.setSessionId(response.sessionId)

      // 8. Set remote description (SDP answer from agent)
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: response.sdp,
      })

      if (this.disposed) return

      // 9. Subscribe to ICE candidates from agent via SSE
      this.cleanupSse = subscribeToIceCandidates(
        response.sessionId,
        async (event) => {
          try {
            if (pc.remoteDescription) {
              await pc.addIceCandidate({
                candidate: event.candidate,
                sdpMid: event.sdpMid,
                sdpMLineIndex: event.sdpMLineIndex,
              })
            } else {
              console.warn('[WebRTC] Cannot add ICE candidate — no remote description yet')
            }
          } catch (err) {
            console.warn('[WebRTC] Failed to add ICE candidate:', err)
          }
        },
        (error) => {
          console.error('[WebRTC] SSE error:', error)
        },
      )

      // 10. Forward local ICE candidates to agent via backend
      pc.onicecandidate = async (event) => {
        if (event.candidate && response.sessionId) {
          try {
            await sendIceCandidate({
              sessionId: response.sessionId,
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid || '0',
              sdpMLineIndex: event.candidate.sdpMLineIndex || 0,
            })
          } catch (err) {
            console.warn('[WebRTC] Failed to send ICE candidate:', err)
          }
        }
      }

      // 11. Start ICE timeout — if data channel doesn't open within ICE_TIMEOUT_MS, fail
      this.startIceTimeout()
    } catch (err) {
      if (this.disposed) return
      console.error('[WebRTC] Connection failed:', err)
      this.clearIceTimeout()
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      this.handleError(errorMessage)
      throw err
    }
  }

  /**
   * Disconnect from the device (explicit user action).
   */
  async disconnect(): Promise<void> {
    const sessionId = this.sessionId

    // Cancel any pending reconnection attempts
    this.cancelReconnect()
    this.clearIceTimeout()

    // Cleanup WebRTC resources
    this.cleanup()

    // Notify backend to close session
    if (sessionId) {
      try {
        await closeWebRTCSession(sessionId)
      } catch (err) {
        console.warn('[WebRTC] Failed to close session on backend:', err)
      }
    }

    // Update store
    this.webrtcActions.endSession()
    this.sessionId = null
  }

  /**
   * Send a message over the main data channel.
   */
  sendMessage(message: unknown): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(message))
    }
  }

  /**
   * Send a message over the debug data channel.
   * Returns true if the message was sent, false otherwise.
   */
  sendDebugMessage(message: unknown): boolean {
    if (this.debugChannel?.readyState === 'open') {
      this.debugChannel.send(JSON.stringify(message))
      return true
    }
    return false
  }

  /**
   * Open the debug data channel on the existing peer connection.
   * Created lazily — only when the user starts debugging.
   * Returns true when the channel opens, false on failure or timeout.
   */
  openDebugChannel(): Promise<boolean> {
    // Already open
    if (this.debugChannel?.readyState === 'open') {
      return Promise.resolve(true)
    }

    // Close any existing channel in a non-open state
    if (this.debugChannel) {
      this.debugChannel.close()
      this.debugChannel = null
    }

    // No peer connection available
    const pc = this.pc
    if (!pc || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
      console.warn('[WebRTC Debug] Cannot open debug channel: no active peer connection')
      return Promise.resolve(false)
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        console.error('[WebRTC Debug] Debug channel open timed out (5s)')
        resolve(false)
      }, 5000)

      const debugChannel = pc.createDataChannel('debug')
      this.debugChannel = debugChannel

      debugChannel.onopen = () => {
        clearTimeout(timeout)
        console.log('[WebRTC Debug] Debug channel opened')
        resolve(true)
      }

      debugChannel.onclose = () => {
        console.log('[WebRTC Debug] Debug channel closed')
        if (this.debugChannel === debugChannel) {
          this.debugChannel = null
        }
      }

      debugChannel.onerror = (event) => {
        clearTimeout(timeout)
        console.error('[WebRTC Debug] Debug channel error:', event)
        if (this.debugChannel === debugChannel) {
          this.debugChannel = null
        }
        resolve(false)
      }

      debugChannel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (this.callbacks.onDebugMessage) {
            this.callbacks.onDebugMessage(msg)
          } else {
            console.log('[WebRTC Debug]', msg.type, msg)
          }
        } catch (err) {
          console.error('[WebRTC Debug] Failed to parse message:', err)
        }
      }
    })
  }

  /**
   * Close the debug data channel without affecting the main connection.
   */
  closeDebugChannel(): void {
    if (this.debugChannel) {
      this.debugChannel.close()
      this.debugChannel = null
      console.log('[WebRTC Debug] Debug channel closed by request')
    }
  }

  /**
   * Tear down everything. Called by the hook on unmount.
   * After this, no async continuation will modify state.
   */
  dispose(): void {
    this.disposed = true
    this.cancelReconnect()
    this.clearIceTimeout()
    this.cleanup()
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  /**
   * Dispatch a parsed message to the appropriate handler.
   */
  private dispatchMessage(msg: { type: string; [key: string]: unknown }): void {
    if (msg.type === 'ready' || msg.type === 'pong') {
      // No-op: routine protocol messages
    } else if (msg.type === 'ping') {
      this.channel?.send(JSON.stringify({ type: 'pong' }))
    } else if (msg.type === 'command_response') {
      handleCommandResponse(msg as unknown as Parameters<typeof handleCommandResponse>[0])
    } else if (msg.type === 'error') {
      this.handleError((msg.message as string) || 'Unknown error from agent')
    } else {
      this.callbacks.onMessage?.(msg)
    }
  }

  /**
   * Update status in the store and notify the callback.
   */
  private updateStatus(status: WebRTCConnectionStatus): void {
    this.webrtcActions.setStatus(status)
    this.callbacks.onStatusChange?.(status)
  }

  /**
   * Handle an error: log it, update store, clean up resources, and
   * optionally schedule a reconnection attempt.
   */
  private handleError(error: string, shouldReconnect: boolean = true): void {
    console.error('[WebRTC] Error:', error)
    this.webrtcActions.setError(error)
    if (!shouldReconnect) {
      this.webrtcActions.setStatus('error')
    }
    this.callbacks.onError?.(error)

    // Clean up stale resources — connect() always creates fresh ones
    this.cleanup()

    // Schedule reconnection (unless disabled or already in progress)
    if (shouldReconnect && !this.isReconnecting) {
      this.scheduleReconnect()
    }
  }

  /**
   * Start ICE connection timeout.
   * If the data channel doesn't open within ICE_TIMEOUT_MS, fail the attempt.
   */
  private startIceTimeout(): void {
    this.clearIceTimeout()
    this.iceTimeout = window.setTimeout(() => {
      this.iceTimeout = null
      if (this.disposed) return
      // Only fire if we haven't connected yet
      if (this.channel?.readyState !== 'open') {
        console.error(`[WebRTC] ICE timeout: data channel did not open within ${ICE_TIMEOUT_MS / 1000}s`)
        this.handleError('ICE connection timeout')
      }
    }, ICE_TIMEOUT_MS)
  }

  /**
   * Clear the ICE timeout timer.
   */
  private clearIceTimeout(): void {
    if (this.iceTimeout) {
      clearTimeout(this.iceTimeout)
      this.iceTimeout = null
    }
  }

  /**
   * Schedule a reconnection attempt.
   * 3 attempts, 1 second apart. After 3 failures, give up permanently.
   */
  private scheduleReconnect(): void {
    if (this.disposed) return
    if (this.isReconnecting) return
    if (this.reconnectTimeout) return

    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[WebRTC] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up permanently`)
      this.webrtcActions.setStatus('failed')
      this.webrtcActions.setError(`WebRTC connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`)
      return
    }

    console.log(
      `[WebRTC] Scheduling reconnection attempt ${this.reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY_MS}ms`,
    )

    this.webrtcActions.setStatus('reconnecting')

    this.reconnectTimeout = window.setTimeout(async () => {
      this.reconnectTimeout = null
      if (this.disposed) return

      this.isReconnecting = true
      this.reconnectAttempt++
      this.webrtcActions.setReconnectAttempt(this.reconnectAttempt)

      try {
        await this.connect(true)
        console.log('[WebRTC] Signaling completed, waiting for data channel...')
      } catch (err) {
        console.error('[WebRTC] Reconnection attempt failed:', err)
        // connect() already called handleError → cleanup.
        // handleError's scheduleReconnect was skipped because isReconnecting was true.
        // Check if we should try again.
        this.isReconnecting = false
        if (this.reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect()
        } else {
          console.log(`[WebRTC] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up permanently`)
          this.webrtcActions.setStatus('failed')
          this.webrtcActions.setError(`WebRTC connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`)
        }
        return
      }

      this.isReconnecting = false
    }, RECONNECT_DELAY_MS)
  }

  /**
   * Cancel any pending reconnection attempts.
   */
  private cancelReconnect(): void {
    this.isReconnecting = false
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }

  /**
   * Clean up WebRTC resources (peer connection, channels, SSE, timers).
   * Does NOT cancel reconnection — use cancelReconnect() for that.
   */
  private cleanup(): void {
    this.stopPingInterval()
    this.clearIceTimeout()

    if (this.staleCleanupInterval) {
      clearInterval(this.staleCleanupInterval)
      this.staleCleanupInterval = null
    }

    this.chunkReassembler = null

    setDataChannel(null)

    if (this.cleanupSse) {
      this.cleanupSse()
      this.cleanupSse = null
    }

    if (this.debugChannel) {
      this.debugChannel.close()
      this.debugChannel = null
    }

    if (this.channel) {
      this.channel.close()
      this.channel = null
    }

    if (this.pc) {
      this.pc.close()
      this.pc = null
    }
  }

  private startPingInterval(): void {
    this.stopPingInterval()
    this.pingInterval = window.setInterval(() => {
      if (this.channel?.readyState === 'open') {
        this.channel.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL_MS)
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for ICE gathering to complete or timeout.
 */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      resolve()
    }, timeoutMs)

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout)
        resolve()
      }
    }
  })
}
