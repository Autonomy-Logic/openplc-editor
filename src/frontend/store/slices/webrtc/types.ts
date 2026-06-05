import type { WebRTCConnectionStatus } from '../../../../middleware/shared/ports/types'

export type { WebRTCConnectionStatus }

export type DebugTransport = 'http' | 'webrtc'

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
  debugTransport: DebugTransport
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
  setDebugTransport: (transport: DebugTransport) => void
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
