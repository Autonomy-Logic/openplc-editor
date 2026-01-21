import { useOpenPLCStore } from '@root/renderer/store'
import type { RuntimeConnection } from '@root/renderer/store/slices/device/types'
import { useCallback, useEffect, useRef } from 'react'

// Unified polling interval for status checks (in milliseconds).
// Status and timing stats are fetched together when needed to reduce duplicate requests.
const STATUS_POLL_INTERVAL_MS = 2000

// Auto-disconnect after N consecutive status poll failures
const MAX_CONSECUTIVE_FAILURES = 3

/**
 * Custom hook that handles runtime status polling.
 * This hook should be used at the app level (e.g., in workspace-screen.tsx)
 * to ensure polling runs globally while connected, not just when the device config screen is open.
 *
 * Timing stats are included in the status request only when the device configuration
 * screen is visible (controlled by the includeTimingStatsInPolling flag in the store).
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

  // Poll for PLC status (includes timing stats when device config screen is visible)
  const pollStatus = useCallback(async () => {
    // Skip if a poll is already in progress (prevents request backlog)
    if (isPollingRef.current) return

    const currentState = useOpenPLCStore.getState()
    const {
      connectionStatus: currentConnectionStatus,
      jwtToken: currentJwtToken,
      ipAddress: currentIpAddress,
      includeTimingStatsInPolling,
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
      // Include timing stats only when the device configuration screen is visible
      const result = await window.bridge.runtimeGetStatus(
        currentIpAddress,
        currentJwtToken,
        includeTimingStatsInPolling,
      )

      if (result.success && result.status) {
        consecutiveFailuresRef.current = 0
        const statusValue = result.status.replace('STATUS:', '').replace('\n', '').trim()
        const validStatuses = ['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN'] as const
        if (validStatuses.includes(statusValue as (typeof validStatuses)[number])) {
          setPlcRuntimeStatus(statusValue as NonNullable<RuntimeConnection['plcStatus']>)
        } else {
          setPlcRuntimeStatus('UNKNOWN')
        }
        // Update timing stats if they were requested and returned
        if (includeTimingStatsInPolling && result.timingStats) {
          setTimingStats(result.timingStats)
        }
      } else {
        handlePollFailure()
      }
    } catch {
      handlePollFailure()
    } finally {
      isPollingRef.current = false
    }
  }, [clearConnectionState, setPlcRuntimeStatus, setTimingStats])

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
