import { useOpenPLCStore } from '@root/renderer/store'
import type { RuntimeConnection } from '@root/renderer/store/slices/device/types'
import { useCallback, useEffect, useRef } from 'react'

// Polling intervals in milliseconds
const STATUS_POLL_INTERVAL_MS = 2000

// Auto-disconnect after N consecutive status poll failures
const MAX_CONSECUTIVE_FAILURES = 3

/**
 * Custom hook that handles runtime status polling.
 * This hook should be used at the app level (e.g., in workspace-screen.tsx)
 * to ensure polling runs globally while connected, not just when the device config screen is open.
 *
 * Status polling runs continuously while connected (without timing stats).
 * Timing stats should be polled separately only when the device configuration screen is visible.
 */
export const useRuntimePolling = () => {
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const runtimeIpAddress = useOpenPLCStore((state) => state.runtimeConnection.ipAddress)
  const setPlcRuntimeStatus = useOpenPLCStore((state) => state.deviceActions.setPlcRuntimeStatus)
  const setRuntimeJwtToken = useOpenPLCStore((state) => state.deviceActions.setRuntimeJwtToken)
  const setRuntimeConnectionStatus = useOpenPLCStore((state) => state.deviceActions.setRuntimeConnectionStatus)
  const setTimingStats = useOpenPLCStore((state) => state.deviceActions.setTimingStats)

  const statusPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const consecutiveFailuresRef = useRef<number>(0)
  const isPollingRef = useRef(false)

  // Helper to clear connection state on disconnect
  const clearConnectionState = useCallback(() => {
    consecutiveFailuresRef.current = 0
    setRuntimeJwtToken(null)
    setRuntimeConnectionStatus('disconnected')
    setPlcRuntimeStatus(null)
    setTimingStats(null)
  }, [setRuntimeJwtToken, setRuntimeConnectionStatus, setPlcRuntimeStatus, setTimingStats])

  // Poll for PLC status (without timing stats to avoid mutex contention)
  const pollStatus = useCallback(async () => {
    // Skip if a poll is already in progress (prevents request backlog)
    if (isPollingRef.current) return

    const currentState = useOpenPLCStore.getState()
    const {
      connectionStatus: currentConnectionStatus,
      jwtToken: currentJwtToken,
      ipAddress: currentIpAddress,
    } = currentState.runtimeConnection

    if (currentConnectionStatus !== 'connected' || !currentJwtToken || !currentIpAddress) {
      return
    }

    isPollingRef.current = true

    const handlePollFailure = () => {
      consecutiveFailuresRef.current += 1
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        clearConnectionState()
      } else {
        setPlcRuntimeStatus('UNKNOWN')
      }
    }

    try {
      // Call runtimeGetStatus WITHOUT include_stats to avoid mutex contention
      // The device configuration screen will poll with include_stats=true when visible
      const result = await window.bridge.runtimeGetStatus(currentIpAddress, currentJwtToken, false)

      if (result.success && result.status) {
        consecutiveFailuresRef.current = 0
        const statusValue = result.status.replace('STATUS:', '').replace('\n', '').trim()
        const validStatuses = ['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN'] as const
        if (validStatuses.includes(statusValue as (typeof validStatuses)[number])) {
          setPlcRuntimeStatus(statusValue as NonNullable<RuntimeConnection['plcStatus']>)
        } else {
          setPlcRuntimeStatus('UNKNOWN')
        }
        // Note: We don't update timing stats here since we're not requesting them
        // Timing stats are only updated when the device config screen polls with include_stats=true
      } else {
        handlePollFailure()
      }
    } catch {
      handlePollFailure()
    } finally {
      isPollingRef.current = false
    }
  }, [clearConnectionState, setPlcRuntimeStatus])

  // Start/stop polling based on connection status
  useEffect(() => {
    if (connectionStatus === 'connected' && jwtToken && runtimeIpAddress) {
      // Reset failure counter on new connection
      consecutiveFailuresRef.current = 0

      // Initial status fetch
      void pollStatus()

      // Start periodic status polling
      statusPollIntervalRef.current = setInterval(() => {
        void pollStatus()
      }, STATUS_POLL_INTERVAL_MS)
    } else {
      // Stop polling when disconnected
      if (statusPollIntervalRef.current) {
        clearInterval(statusPollIntervalRef.current)
        statusPollIntervalRef.current = null
      }
    }

    // Cleanup on unmount
    return () => {
      if (statusPollIntervalRef.current) {
        clearInterval(statusPollIntervalRef.current)
        statusPollIntervalRef.current = null
      }
    }
  }, [connectionStatus, jwtToken, runtimeIpAddress, pollStatus])

  return {
    isConnected: connectionStatus === 'connected',
    plcStatus: useOpenPLCStore((state) => state.runtimeConnection.plcStatus),
  }
}
