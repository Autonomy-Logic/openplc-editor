/**
 * Debug Transport -- HTTP fallback for debug commands
 *
 * When WebRTC DataChannel is unavailable, debug commands are sent via
 * the run_command HTTP endpoint with api="debug". The agent's
 * DebugSessionManager routes these to persistent Socket.IO sessions.
 */

import { api } from './axios'

/** Polling interval when using WebRTC debug DataChannel (fast, low latency). */
export const WEBRTC_POLL_INTERVAL_MS = 200

/** Polling interval when using HTTP via Edge API (slower, avoids server overload). */
export const HTTP_POLL_INTERVAL_MS = 2000

/**
 * Send a debug command via the HTTP run_command endpoint.
 *
 * Wraps the debug message in a run_command payload with api="debug"
 * and extracts the debug_response from the response.
 *
 * @param agentId - The orchestrator agent ID
 * @param deviceId - The runtime device ID
 * @param debugMessage - The debug message (same schema as WebRTC DataChannel)
 * @returns The debug response, or null on error
 */
export async function sendDebugCommandViaHttp(
  agentId: string,
  deviceId: string,
  debugMessage: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const { data: result } = await api.post('/orchestrators/run-command', {
      agent_id: agentId,
      device_id: deviceId,
      method: 'POST',
      api: 'debug',
      data: debugMessage,
    })

    const response = result.response
    if (response?.status === 'success' && response.debug_response) {
      return response.debug_response as Record<string, unknown>
    }

    if (response?.status === 'error') {
      console.error('[DebugTransport] Agent returned error:', response.debug_response ?? response)
      return response.debug_response as Record<string, unknown> | null
    }

    return null
  } catch (err) {
    console.error('[DebugTransport] HTTP debug command failed:', err)
    return null
  }
}
