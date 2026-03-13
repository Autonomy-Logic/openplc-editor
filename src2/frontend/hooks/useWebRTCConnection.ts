/**
 * WebRTC Connection Hook
 *
 * Thin React bridge over WebRTCConnectionManager. The hook creates a manager
 * instance, keeps its callbacks in sync with React props, and returns stable
 * method references that never change identity (empty dependency arrays).
 */

import { useCallback, useEffect, useRef } from 'react'

import { useOpenPLCStore } from '../store'
import { WebRTCConnectionManager } from '../services/api/webrtc'
import type { WebRTCConnectionStatus } from '../store/slices/webrtc/types'

export interface UseWebRTCConnectionOptions {
  deviceId: string
  deviceName: string
  agentId: string
  onStatusChange?: (status: WebRTCConnectionStatus) => void
  onError?: (error: string) => void
  onMessage?: (message: unknown) => void
  onDebugMessage?: (message: unknown) => void
}

export interface UseWebRTCConnectionReturn {
  status: WebRTCConnectionStatus
  sessionId: string | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sendMessage: (message: unknown) => void
  sendDebugMessage: (message: unknown) => boolean
  openDebugChannel: () => Promise<boolean>
  closeDebugChannel: () => void
}

/**
 * Hook for managing WebRTC connection to a device.
 *
 * All returned methods are stable references (they never change identity),
 * so consumers don't need ref-forwarding workarounds.
 */
export function useWebRTCConnection(options: UseWebRTCConnectionOptions): UseWebRTCConnectionReturn {
  const { deviceId, deviceName, agentId, onStatusChange, onError, onMessage, onDebugMessage } = options

  const { session, webrtcActions } = useOpenPLCStore()

  const managerRef = useRef<WebRTCConnectionManager | null>(null)

  // Create / recreate manager when device identity changes.
  // The effect cleanup disposes the old manager (tears down connection + timers).
  useEffect(() => {
    if (!deviceId || !agentId) {
      // No valid device — dispose any existing manager
      if (managerRef.current) {
        managerRef.current.dispose()
        managerRef.current = null
      }
      return
    }

    managerRef.current = new WebRTCConnectionManager({
      deviceId,
      deviceName,
      agentId,
      webrtcActions,
      callbacks: { onStatusChange, onError, onMessage, onDebugMessage },
    })

    return () => {
      managerRef.current?.dispose()
      managerRef.current = null
    }
    // Only recreate when the device/agent identity changes.
    // webrtcActions is stable (defined in the Zustand slice creator).
    // Callbacks are synced separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, agentId])

  // Keep callbacks up to date without recreating the manager.
  useEffect(() => {
    managerRef.current?.updateCallbacks({ onStatusChange, onError, onMessage, onDebugMessage })
  }, [onStatusChange, onError, onMessage, onDebugMessage])

  // --- Stable method references (empty deps → never change identity) ---

  const connect = useCallback(async () => {
    if (!managerRef.current) throw new Error('WebRTCConnectionManager not initialized')
    return managerRef.current.connect()
  }, [])

  const disconnect = useCallback(async () => {
    if (!managerRef.current) return
    return managerRef.current.disconnect()
  }, [])

  const sendMessage = useCallback((message: unknown) => {
    managerRef.current?.sendMessage(message)
  }, [])

  const sendDebugMessage = useCallback((message: unknown): boolean => {
    return managerRef.current?.sendDebugMessage(message) ?? false
  }, [])

  const openDebugChannel = useCallback((): Promise<boolean> => {
    return managerRef.current?.openDebugChannel() ?? Promise.resolve(false)
  }, [])

  const closeDebugChannel = useCallback(() => {
    managerRef.current?.closeDebugChannel()
  }, [])

  return {
    status: session.status,
    sessionId: session.sessionId,
    connect,
    disconnect,
    sendMessage,
    sendDebugMessage,
    openDebugChannel,
    closeDebugChannel,
  }
}

export default useWebRTCConnection
