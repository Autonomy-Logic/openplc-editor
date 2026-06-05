import { createStore, StoreApi } from 'zustand/vanilla'

import { createWebRTCSlice } from '../slices/webrtc/slice'
import type { WebRTCSlice } from '../slices/webrtc/types'

function makeStore(): StoreApi<WebRTCSlice> {
  return createStore<WebRTCSlice>()(createWebRTCSlice)
}

describe('createWebRTCSlice', () => {
  let store: StoreApi<WebRTCSlice>

  beforeEach(() => {
    store = makeStore()
  })

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('has all session fields set to default values', () => {
      const { session } = store.getState()
      expect(session.sessionId).toBeNull()
      expect(session.deviceId).toBeNull()
      expect(session.deviceName).toBeNull()
      expect(session.agentId).toBeNull()
      expect(session.status).toBe('disconnected')
      expect(session.error).toBeNull()
      expect(session.reconnectAttempt).toBe(0)
      expect(session.debugTransport).toBe('http')
    })
  })

  // ---------------------------------------------------------------------------
  // Individual setters
  // ---------------------------------------------------------------------------

  describe('setSessionId', () => {
    it('sets the session id', () => {
      store.getState().webrtcActions.setSessionId('sess-123')
      expect(store.getState().session.sessionId).toBe('sess-123')
    })

    it('clears the session id when passed null', () => {
      store.getState().webrtcActions.setSessionId('sess-123')
      store.getState().webrtcActions.setSessionId(null)
      expect(store.getState().session.sessionId).toBeNull()
    })
  })

  describe('setDeviceId', () => {
    it('sets the device id', () => {
      store.getState().webrtcActions.setDeviceId('dev-1')
      expect(store.getState().session.deviceId).toBe('dev-1')
    })

    it('clears the device id when passed null', () => {
      store.getState().webrtcActions.setDeviceId('dev-1')
      store.getState().webrtcActions.setDeviceId(null)
      expect(store.getState().session.deviceId).toBeNull()
    })
  })

  describe('setDeviceName', () => {
    it('sets the device name', () => {
      store.getState().webrtcActions.setDeviceName('My PLC')
      expect(store.getState().session.deviceName).toBe('My PLC')
    })

    it('clears the device name when passed null', () => {
      store.getState().webrtcActions.setDeviceName('My PLC')
      store.getState().webrtcActions.setDeviceName(null)
      expect(store.getState().session.deviceName).toBeNull()
    })
  })

  describe('setAgentId', () => {
    it('sets the agent id', () => {
      store.getState().webrtcActions.setAgentId('agent-42')
      expect(store.getState().session.agentId).toBe('agent-42')
    })

    it('clears the agent id when passed null', () => {
      store.getState().webrtcActions.setAgentId('agent-42')
      store.getState().webrtcActions.setAgentId(null)
      expect(store.getState().session.agentId).toBeNull()
    })
  })

  describe('setStatus', () => {
    it.each<'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'failed'>([
      'disconnected',
      'connecting',
      'connected',
      'reconnecting',
      'error',
      'failed',
    ])('sets status to "%s"', (status) => {
      store.getState().webrtcActions.setStatus(status)
      expect(store.getState().session.status).toBe(status)
    })
  })

  describe('setError', () => {
    it('sets an error message', () => {
      store.getState().webrtcActions.setError('connection failed')
      expect(store.getState().session.error).toBe('connection failed')
    })

    it('clears the error when passed null', () => {
      store.getState().webrtcActions.setError('connection failed')
      store.getState().webrtcActions.setError(null)
      expect(store.getState().session.error).toBeNull()
    })
  })

  describe('setReconnectAttempt', () => {
    it('sets the reconnect attempt counter', () => {
      store.getState().webrtcActions.setReconnectAttempt(3)
      expect(store.getState().session.reconnectAttempt).toBe(3)
    })

    it('resets the counter to zero', () => {
      store.getState().webrtcActions.setReconnectAttempt(5)
      store.getState().webrtcActions.setReconnectAttempt(0)
      expect(store.getState().session.reconnectAttempt).toBe(0)
    })
  })

  describe('setDebugTransport', () => {
    it('switches transport to webrtc', () => {
      store.getState().webrtcActions.setDebugTransport('webrtc')
      expect(store.getState().session.debugTransport).toBe('webrtc')
    })

    it('switches transport back to http', () => {
      store.getState().webrtcActions.setDebugTransport('webrtc')
      store.getState().webrtcActions.setDebugTransport('http')
      expect(store.getState().session.debugTransport).toBe('http')
    })
  })

  // ---------------------------------------------------------------------------
  // Compound actions
  // ---------------------------------------------------------------------------

  describe('startSession', () => {
    it('sets deviceId, deviceName, agentId, status to connecting, and clears error', () => {
      // Pre-set an error to verify it gets cleared
      store.getState().webrtcActions.setError('previous error')

      store.getState().webrtcActions.startSession({
        deviceId: 'dev-99',
        deviceName: 'Factory PLC',
        agentId: 'agent-7',
      })

      const { session } = store.getState()
      expect(session.deviceId).toBe('dev-99')
      expect(session.deviceName).toBe('Factory PLC')
      expect(session.agentId).toBe('agent-7')
      expect(session.status).toBe('connecting')
      expect(session.error).toBeNull()
    })

    it('does not modify sessionId, reconnectAttempt, or debugTransport', () => {
      store.getState().webrtcActions.setSessionId('existing-session')
      store.getState().webrtcActions.setReconnectAttempt(2)
      store.getState().webrtcActions.setDebugTransport('webrtc')

      store.getState().webrtcActions.startSession({
        deviceId: 'dev-1',
        deviceName: 'PLC',
        agentId: 'agent-1',
      })

      const { session } = store.getState()
      expect(session.sessionId).toBe('existing-session')
      expect(session.reconnectAttempt).toBe(2)
      expect(session.debugTransport).toBe('webrtc')
    })
  })

  describe('endSession', () => {
    it('clears sessionId, agentId, error, reconnectAttempt and resets status and transport', () => {
      // Set up a fully active session
      const { webrtcActions } = store.getState()
      webrtcActions.setSessionId('sess-active')
      webrtcActions.setDeviceId('dev-1')
      webrtcActions.setDeviceName('My PLC')
      webrtcActions.setAgentId('agent-1')
      webrtcActions.setStatus('connected')
      webrtcActions.setError('some error')
      webrtcActions.setReconnectAttempt(3)
      webrtcActions.setDebugTransport('webrtc')

      webrtcActions.endSession()

      const { session } = store.getState()
      expect(session.sessionId).toBeNull()
      expect(session.agentId).toBeNull()
      expect(session.status).toBe('disconnected')
      expect(session.error).toBeNull()
      expect(session.reconnectAttempt).toBe(0)
      expect(session.debugTransport).toBe('http')
    })

    it('preserves deviceId and deviceName after ending session', () => {
      const { webrtcActions } = store.getState()
      webrtcActions.setDeviceId('dev-1')
      webrtcActions.setDeviceName('PLC-A')

      webrtcActions.endSession()

      const { session } = store.getState()
      expect(session.deviceId).toBe('dev-1')
      expect(session.deviceName).toBe('PLC-A')
    })
  })

  describe('reset', () => {
    it('resets the entire session back to initial state', () => {
      // Populate every field
      const { webrtcActions } = store.getState()
      webrtcActions.setSessionId('sess-1')
      webrtcActions.setDeviceId('dev-1')
      webrtcActions.setDeviceName('PLC-X')
      webrtcActions.setAgentId('agent-1')
      webrtcActions.setStatus('connected')
      webrtcActions.setError('timeout')
      webrtcActions.setReconnectAttempt(5)
      webrtcActions.setDebugTransport('webrtc')

      webrtcActions.reset()

      const { session } = store.getState()
      expect(session.sessionId).toBeNull()
      expect(session.deviceId).toBeNull()
      expect(session.deviceName).toBeNull()
      expect(session.agentId).toBeNull()
      expect(session.status).toBe('disconnected')
      expect(session.error).toBeNull()
      expect(session.reconnectAttempt).toBe(0)
      expect(session.debugTransport).toBe('http')
    })
  })
})
