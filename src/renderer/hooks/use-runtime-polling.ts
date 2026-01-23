import { useOpenPLCStore } from '@root/renderer/store'
import type { RuntimeConnection } from '@root/renderer/store/slices/device/types'
import { isV4Logs, LOG_BUFFER_CAP } from '@root/types/PLC/runtime-logs'
import { useCallback, useEffect, useRef } from 'react'

// Unified polling interval for both status and logs (in milliseconds).
// Status and logs are fetched together every 2 seconds to minimize runtime load.
// Timing stats are included in the status request only when the board settings
// screen is visible (controlled by the includeTimingStatsInPolling flag).
const POLL_INTERVAL_MS = 2000

// Number of consecutive poll failures before showing connection lost modal
const MAX_CONSECUTIVE_FAILURES = 5

/**
 * Custom hook that handles runtime status and logs polling.
 * This hook should be used at the app level (e.g., in workspace-screen.tsx)
 * to ensure polling runs globally while connected, not just when the device config screen is open.
 *
 * Both status and logs are polled together in a single interval to reduce
 * the number of requests to the runtime.
 *
 * After MAX_CONSECUTIVE_FAILURES failed poll attempts, the connection is
 * automatically terminated and a warning modal is shown to the user.
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
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
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

  // Handle connection loss after max failures
  const handleConnectionLost = useCallback(() => {
    // Capture IP address before clearing connection state
    const { runtimeConnection } = useOpenPLCStore.getState()
    const ipAddress = runtimeConnection.ipAddress ?? 'Unknown'

    // Stop polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    // Clear connection state
    clearConnectionState()
    // Hide PLC logs tab and clear logs
    const { workspaceActions } = useOpenPLCStore.getState()
    workspaceActions.setPlcLogsVisible(false)
    workspaceActions.clearPlcLogs()
    // Show warning modal with captured IP address
    openModal('runtime-connection-lost', { ipAddress })
  }, [clearConnectionState, openModal])

  // Combined poll for both PLC status and logs
  const poll = useCallback(async () => {
    // Skip if a poll is already in progress (prevents request backlog)
    if (isPollingRef.current) return

    const currentState = useOpenPLCStore.getState()
    const {
      runtimeConnection: {
        connectionStatus: currentConnectionStatus,
        jwtToken: currentJwtToken,
        ipAddress: currentIpAddress,
        includeTimingStatsInPolling,
      },
      workspace: { plcLogsLastId, plcLogs },
      workspaceActions,
    } = currentState

    if (currentConnectionStatus !== 'connected' || !currentJwtToken || !currentIpAddress) {
      return
    }

    isPollingRef.current = true

    const handlePollFailure = () => {
      consecutiveFailuresRef.current += 1
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        handleConnectionLost()
      } else {
        setPlcRuntimeStatus('UNKNOWN')
      }
    }

    try {
      // Detect if we're connected to v4 runtime (v4 returns array, v3 returns string)
      const isV4Runtime = isV4Logs(plcLogs) || plcLogs === ''
      const minId = isV4Runtime && plcLogsLastId !== null ? plcLogsLastId + 1 : undefined

      // Fetch status and logs in parallel
      // Include timing stats only when the device configuration screen is visible
      const [statusResult, logsResult] = await Promise.all([
        window.bridge.runtimeGetStatus(currentIpAddress, currentJwtToken, includeTimingStatsInPolling),
        // Fetch logs (incremental for v4 runtime)
        window.bridge.runtimeGetLogs(currentIpAddress, currentJwtToken, minId),
      ])

      // Process status result
      let currentPlcStatus: string | null = null
      if (statusResult.success && statusResult.status) {
        // Reset failure counter on success
        consecutiveFailuresRef.current = 0
        const statusValue = statusResult.status.replace('STATUS:', '').replace('\n', '').trim()
        const validStatuses = ['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN'] as const
        if (validStatuses.includes(statusValue as (typeof validStatuses)[number])) {
          currentPlcStatus = statusValue
          setPlcRuntimeStatus(statusValue as NonNullable<RuntimeConnection['plcStatus']>)
        } else {
          currentPlcStatus = 'UNKNOWN'
          setPlcRuntimeStatus('UNKNOWN')
        }
        // Update timing stats if they were requested and returned
        if (includeTimingStatsInPolling && statusResult.timingStats) {
          setTimingStats(statusResult.timingStats)
        } else if (!includeTimingStatsInPolling) {
          // Clear stale timing stats when no longer polling for them
          setTimingStats(null)
        }
      } else {
        handlePollFailure()
        return // Skip logs processing if status failed
      }

      // Process logs result
      if (logsResult.success && logsResult.logs !== undefined) {
        const newLogs = logsResult.logs

        if (isV4Logs(newLogs)) {
          // V4 runtime: structured logs with levels
          if (newLogs.length > 0) {
            // Detect runtime restart: if any returned ID is less than lastSeenId
            const hasRestartedRuntime =
              plcLogsLastId !== null && newLogs.some((log) => log.id !== null && log.id < plcLogsLastId)

            if (hasRestartedRuntime) {
              // Runtime restarted, clear logs and start fresh
              // Cap to last LOG_BUFFER_CAP entries if initial fetch is larger
              const cappedLogs = newLogs.length > LOG_BUFFER_CAP ? newLogs.slice(-LOG_BUFFER_CAP) : newLogs
              workspaceActions.setPlcLogs(cappedLogs)
            } else {
              // Append new logs to existing
              workspaceActions.appendPlcLogs(newLogs)
            }

            // Update lastId cursor to the highest ID in the new logs
            const maxId = newLogs.reduce((max, log) => {
              if (log.id !== null && log.id > max) {
                return log.id
              }
              return max
            }, plcLogsLastId ?? -1)

            if (maxId >= 0) {
              workspaceActions.setPlcLogsLastId(maxId)
            }
          }
        } else {
          // V3 runtime: plain string logs (no incremental fetching)
          // For v3, only update logs when PLC is RUNNING (use freshly fetched status)
          if (currentPlcStatus === 'RUNNING') {
            workspaceActions.setPlcLogs(newLogs)
          }
        }
      }
    } catch {
      handlePollFailure()
    } finally {
      isPollingRef.current = false
    }
  }, [handleConnectionLost, setPlcRuntimeStatus])

  // Start/stop polling based on connection status
  useEffect(() => {
    const { workspaceActions } = useOpenPLCStore.getState()

    if (connectionStatus === 'connected' && jwtToken && runtimeIpAddress) {
      // Reset failure counter on new connection
      consecutiveFailuresRef.current = 0

      // Initial poll
      void poll()

      // Start periodic polling (status + logs together)
      pollIntervalRef.current = setInterval(() => {
        void poll()
      }, POLL_INTERVAL_MS)

      // Show PLC logs tab
      workspaceActions.setPlcLogsVisible(true)
    } else {
      // Stop polling when disconnected
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }

      // Hide PLC logs tab and clear logs
      workspaceActions.setPlcLogsVisible(false)
      workspaceActions.clearPlcLogs()
    }

    // Cleanup on unmount
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [connectionStatus, jwtToken, runtimeIpAddress, poll])

  return {
    isConnected: connectionStatus === 'connected',
    plcStatus: useOpenPLCStore((state) => state.runtimeConnection.plcStatus),
  }
}
