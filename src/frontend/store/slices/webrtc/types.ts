import type { WebRTCConnectionStatus } from '../../../../middleware/shared/ports/types'

export type { WebRTCConnectionStatus }

// ---------------------------------------------------------------------------
// WebRTC session state
// ---------------------------------------------------------------------------

export type WebRTCSession = {
  sessionId: string | null
  deviceId: string | null
  deviceName: string | null
  agentId: string | null
  status: WebRTCConnectionStatus
  error: string | null
  reconnectAttempt: number
  /**
   * Is the WebRTC DEBUG data channel open?
   *
   * A fact about this WebRTC session, deliberately not a medium name: which
   * medium the debug poller then rides is derived from this once, by the web
   * connection manager, and published as `deviceConnection.debugTransport`.
   * Naming a medium here as well gave two fields the same vocabulary and let
   * them disagree.
   */
  debugChannelOpen: boolean
}

export type WebRTCState = {
  session: WebRTCSession
}

// ---------------------------------------------------------------------------
// WebRTC actions
// ---------------------------------------------------------------------------

export type WebRTCActions = {
  setSessionId: (id: string | null) => void
  setDeviceId: (id: string | null) => void
  setDeviceName: (name: string | null) => void
  setAgentId: (id: string | null) => void
  setStatus: (status: WebRTCConnectionStatus) => void
  setError: (error: string | null) => void
  setReconnectAttempt: (attempt: number) => void
  setDebugChannelOpen: (open: boolean) => void
  startSession: (params: { deviceId: string; deviceName: string; agentId: string }) => void
  endSession: () => void
  reset: () => void
}

// ---------------------------------------------------------------------------
// WebRTC slice
// ---------------------------------------------------------------------------

export type WebRTCSlice = WebRTCState & {
  webrtcActions: WebRTCActions
}
