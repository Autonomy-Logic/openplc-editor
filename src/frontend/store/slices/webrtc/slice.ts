import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { WebRTCSession, WebRTCSlice } from './types'

const initialSession: WebRTCSession = {
  sessionId: null,
  deviceId: null,
  deviceName: null,
  agentId: null,
  status: 'disconnected',
  error: null,
  reconnectAttempt: 0,
  debugChannelOpen: false,
}

const createWebRTCSlice: StateCreator<WebRTCSlice, [], [], WebRTCSlice> = (setState) => ({
  session: { ...initialSession },

  webrtcActions: {
    setSessionId: (id) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.sessionId = id
        }),
      )
    },
    setDeviceId: (id) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.deviceId = id
        }),
      )
    },
    setDeviceName: (name) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.deviceName = name
        }),
      )
    },
    setAgentId: (id) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.agentId = id
        }),
      )
    },
    setStatus: (status) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.status = status
        }),
      )
    },
    setError: (error) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.error = error
        }),
      )
    },
    setReconnectAttempt: (attempt) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.reconnectAttempt = attempt
        }),
      )
    },
    setDebugChannelOpen: (open) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.debugChannelOpen = open
        }),
      )
    },
    startSession: ({ deviceId, deviceName, agentId }) => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.deviceId = deviceId
          session.deviceName = deviceName
          session.agentId = agentId
          session.status = 'connecting'
          session.error = null
        }),
      )
    },
    endSession: () => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          session.sessionId = null
          session.agentId = null
          session.status = 'disconnected'
          session.error = null
          session.reconnectAttempt = 0
          session.debugChannelOpen = false
        }),
      )
    },
    reset: () => {
      setState(
        produce(({ session }: WebRTCSlice) => {
          Object.assign(session, initialSession)
        }),
      )
    },
  },
})

export { createWebRTCSlice }
