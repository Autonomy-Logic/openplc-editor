/**
 * WebRTC Command Service
 *
 * Sends commands over WebRTC data channel with correlation ID matching.
 * Used as primary transport when WebRTC is connected, with HTTP fallback.
 */

import { useOpenPLCStore } from '../../../store'

import { sendChunkedMessage } from './webrtc-chunked-message'

interface PendingRequest {
  resolve: (response: CommandResponse) => void
  reject: (error: Error) => void
  timeout: number
}

export interface CommandResponse {
  type: 'command_response'
  correlation_id: number
  status: 'success' | 'error'
  http_response?: {
    status_code: number
    headers: Record<string, string>
    body: unknown
    ok: boolean
    content_type: string
  }
  error?: string
}

export interface RunCommandPayload {
  device_id: string
  method: string
  api: string
  port?: number
  headers?: Record<string, string>
  data?: Record<string, unknown>
  params?: Record<string, string>
  files?: Record<string, unknown>
}

// Store for pending requests awaiting responses
const pendingRequests = new Map<number, PendingRequest>()
let correlationCounter = 0

// Reference to the data channel (set by useWebRTCConnection)
let dataChannelRef: RTCDataChannel | null = null

/**
 * Set the data channel reference for sending commands.
 * Called by useWebRTCConnection when channel opens/closes.
 */
export function setDataChannel(channel: RTCDataChannel | null): void {
  dataChannelRef = channel
  if (!channel) {
    // Clear any pending requests when channel is unregistered
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('WebRTC data channel closed'))
    }
    pendingRequests.clear()
  }
}

/**
 * Generate a unique correlation ID for request/response matching.
 */
export function generateCorrelationId(): number {
  correlationCounter = (correlationCounter + 1) % 1000000
  return Date.now() * 1000 + correlationCounter
}

/**
 * Handle incoming command response from the agent.
 * Called by useWebRTCConnection when receiving command_response messages.
 */
export function handleCommandResponse(message: CommandResponse): void {
  const pending = pendingRequests.get(message.correlation_id)
  if (pending) {
    clearTimeout(pending.timeout)
    pendingRequests.delete(message.correlation_id)
    pending.resolve(message)
  } else {
    console.warn('[WebRTC Command] Received response for unknown correlation_id:', message.correlation_id)
  }
}

/**
 * Send a command over the WebRTC data channel.
 *
 * @param command - The command payload
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Promise that resolves with the command response
 * @throws Error if data channel not available or timeout
 */
export async function sendCommandViaWebRTC(
  command: RunCommandPayload,
  timeoutMs: number = 30000,
): Promise<CommandResponse> {
  if (!dataChannelRef || dataChannelRef.readyState !== 'open') {
    throw new Error('WebRTC data channel not available')
  }

  const correlationId = generateCorrelationId()

  const message = JSON.stringify({
    type: 'run_command',
    correlation_id: correlationId,
    ...command,
  })

  // Set up response listener before sending to avoid race conditions
  const responsePromise = new Promise<CommandResponse>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingRequests.delete(correlationId)
      reject(new Error('WebRTC command timeout'))
    }, timeoutMs)

    pendingRequests.set(correlationId, { resolve, reject, timeout })
  })

  try {
    await sendChunkedMessage(dataChannelRef, message)
  } catch (err) {
    // Clean up pending request if send fails
    const pending = pendingRequests.get(correlationId)
    if (pending) {
      clearTimeout(pending.timeout)
      pendingRequests.delete(correlationId)
    }
    throw err
  }

  return responsePromise
}

/**
 * Check if WebRTC is connected to the specified orchestrator agent.
 *
 * @param agentId - The orchestrator agent ID to check
 * @returns true if connected to the specified agent
 */
export function isWebRTCConnectedToAgent(agentId: string): boolean {
  const { session } = useOpenPLCStore.getState()
  return session.status === 'connected' && session.agentId === agentId
}

/**
 * Check if WebRTC data channel is currently available.
 */
export function isWebRTCChannelAvailable(): boolean {
  return dataChannelRef !== null && dataChannelRef.readyState === 'open'
}
