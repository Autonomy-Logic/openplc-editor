/**
 * WebRTC Signaling Service
 *
 * Handles communication with the autonomy-edge-backend for WebRTC session management.
 * This service manages:
 * - Session creation (SDP offer/answer exchange)
 * - ICE candidate forwarding
 * - Session termination
 * - Server-Sent Events for receiving ICE candidates from the agent
 */

import { api } from '../axios'

export interface HttpResponse<T> {
  statusCode: number
  data: T
}

export interface CreateSessionParams {
  deviceId: string
  sdp: string
}

export interface CreateSessionResponse {
  sessionId: string
  sdp?: string
  sdpType?: 'answer'
  error?: string
  status: 'success' | 'error'
}

export interface IceCandidateParams {
  sessionId: string
  candidate: string
  sdpMid: string
  sdpMLineIndex: number
}

export interface IceCandidateResponse {
  success: boolean
  message: string
}

export interface CloseSessionResponse {
  success: boolean
  message: string
}

export interface IceCandidateEvent {
  type: 'ice-candidate'
  candidate: string
  sdpMid: string
  sdpMLineIndex: number
}

/**
 * Create a new WebRTC session with the specified device.
 * This sends the browser's SDP offer to the backend, which forwards it to the
 * orchestrator agent. The agent creates its peer connection and returns an SDP answer.
 */
export async function createWebRTCSession(params: CreateSessionParams): Promise<CreateSessionResponse> {
  try {
    const { data } = await api.post<HttpResponse<CreateSessionResponse>>('/webrtc/sessions', {
      deviceId: params.deviceId,
      sdp: params.sdp,
    })
    return data.data
  } catch (err) {
    console.error('[WebRTC Signaling] Failed to create session:', err)
    throw err
  }
}

/**
 * Forward an ICE candidate to the orchestrator agent via the backend.
 * ICE candidates are used to establish the peer-to-peer connection.
 */
export async function sendIceCandidate(params: IceCandidateParams): Promise<IceCandidateResponse> {
  try {
    const { data } = await api.post<HttpResponse<IceCandidateResponse>>(`/webrtc/sessions/${params.sessionId}/ice`, {
      candidate: params.candidate,
      sdpMid: params.sdpMid,
      sdpMLineIndex: params.sdpMLineIndex,
    })
    return data.data
  } catch (err) {
    console.error('[WebRTC Signaling] Failed to send ICE candidate:', err)
    throw err
  }
}

/**
 * Close a WebRTC session and notify the orchestrator agent.
 */
export async function closeWebRTCSession(sessionId: string): Promise<CloseSessionResponse> {
  const { data } = await api.delete<HttpResponse<CloseSessionResponse>>(`/webrtc/sessions/${sessionId}`)
  return data.data
}

/**
 * Subscribe to ICE candidates from the orchestrator agent via Server-Sent Events.
 * Returns an EventSource that emits ice-candidate events.
 *
 * @param sessionId - The WebRTC session ID
 * @param onCandidate - Callback for receiving ICE candidates
 * @param onError - Callback for handling errors
 * @returns Cleanup function to close the EventSource
 */
export function subscribeToIceCandidates(
  sessionId: string,
  onCandidate: (event: IceCandidateEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const baseURL = import.meta.env?.VITE_EDGE_API_URL || 'http://localhost:3333'
  const sseUrl = `${baseURL}/webrtc/sessions/${sessionId}/events`

  const eventSource = new EventSource(sseUrl, {
    withCredentials: true,
  })

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as IceCandidateEvent
      if (data.type === 'ice-candidate') {
        onCandidate(data)
      }
    } catch (err) {
      console.error('[WebRTC Signaling] Failed to parse ICE candidate event:', err)
    }
  }

  eventSource.onerror = (error) => {
    console.error('[WebRTC Signaling] SSE error:', error)
    console.error('[WebRTC Signaling] SSE readyState:', eventSource.readyState)
    if (onError) {
      onError(error)
    }
  }

  // Return cleanup function
  return () => {
    eventSource.close()
  }
}
