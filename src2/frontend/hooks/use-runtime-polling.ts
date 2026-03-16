import { useCallback, useEffect, useRef } from 'react'

import type { PlcStatus } from '../../middleware/shared/ports/types'
import { useRuntime } from '../../middleware/shared/providers'
import { useOpenPLCStore } from '../store'

// Unified polling interval for both status and logs (in milliseconds).
const POLL_INTERVAL_MS = 2000

// Number of consecutive poll failures before showing connection lost modal
const MAX_CONSECUTIVE_FAILURES = 5

/**
 * Custom hook that handles runtime status and logs polling.
 * Uses the RuntimePort abstraction so the same hook works on both
 * the Electron editor (IPC) and the web app (HTTP/WebRTC).
 *
 * Should be called once at the workspace level to ensure global polling.
 */
export const useRuntimePolling = () => {
  const runtime = useRuntime()
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const setPlcRuntimeStatus = useOpenPLCStore((state) => state.deviceActions.setPlcRuntimeStatus)
  const setTimingStats = useOpenPLCStore((state) => state.deviceActions.setTimingStats)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const consecutiveFailuresRef = useRef<number>(0)
  const isPollingRef = useRef(false)

  const clearConnectionState = useCallback(() => {
    const { deviceActions } = useOpenPLCStore.getState()
    consecutiveFailuresRef.current = 0
    deviceActions.setRuntimeJwtToken(null)
    deviceActions.setRuntimeConnectionStatus('disconnected')
    deviceActions.setPlcRuntimeStatus(null)
    deviceActions.setTimingStats(null)
  }, [])

  const handleConnectionLost = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    clearConnectionState()
    const { workspaceActions } = useOpenPLCStore.getState()
    workspaceActions.setPlcLogsVisible(false)
    workspaceActions.clearPlcLogs()
    openModal('runtime-connection-lost', null)
  }, [clearConnectionState, openModal])

  const poll = useCallback(async () => {
    if (isPollingRef.current) return

    const currentState = useOpenPLCStore.getState()
    const {
      runtimeConnection: { connectionStatus: curStatus, jwtToken: curToken, includeTimingStatsInPolling },
      workspace: { plcLogsLastId, plcLogs },
      workspaceActions,
    } = currentState

    if (curStatus !== 'connected' || !curToken) return

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
      // Determine if we need incremental log fetching (v4 runtime)
      const isV4 = Array.isArray(plcLogs) || plcLogs === ''
      const minId = isV4 && plcLogsLastId !== null ? plcLogsLastId + 1 : undefined

      const [statusResult, logsResult] = await Promise.all([
        runtime.getStatus(includeTimingStatsInPolling),
        runtime.getLogs(minId),
      ])

      // Process status
      if (statusResult.success && statusResult.status) {
        consecutiveFailuresRef.current = 0
        const rawStatus =
          typeof statusResult.status === 'string'
            ? statusResult.status.replace('STATUS:', '').replace('\n', '').trim()
            : statusResult.status
        const validStatuses: PlcStatus[] = ['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN']
        const plcStatus: PlcStatus = validStatuses.includes(rawStatus as PlcStatus)
          ? (rawStatus as PlcStatus)
          : 'UNKNOWN'
        setPlcRuntimeStatus(plcStatus)

        if (includeTimingStatsInPolling && statusResult.timingStats) {
          setTimingStats(statusResult.timingStats)
        } else if (!includeTimingStatsInPolling) {
          setTimingStats(null)
        }
      } else {
        handlePollFailure()
        return
      }

      // Process logs
      if (logsResult.success && logsResult.logs !== undefined) {
        const newLogs = logsResult.logs
        if (Array.isArray(newLogs)) {
          if (newLogs.length > 0) {
            const hasRestarted =
              plcLogsLastId !== null && newLogs.some((log) => log.id !== null && log.id < plcLogsLastId)

            if (hasRestarted) {
              const capped = newLogs.length > 1000 ? newLogs.slice(-1000) : newLogs
              workspaceActions.setPlcLogs(capped)
            } else {
              workspaceActions.appendPlcLogs(newLogs)
            }

            const maxId = newLogs.reduce(
              (max, log) => (log.id !== null && log.id > max ? log.id : max),
              plcLogsLastId ?? -1,
            )
            if (maxId >= 0) {
              workspaceActions.setPlcLogsLastId(maxId)
            }
          }
        } else {
          workspaceActions.setPlcLogs(newLogs)
        }
      }
    } catch {
      handlePollFailure()
    } finally {
      isPollingRef.current = false
    }
  }, [runtime, handleConnectionLost, setPlcRuntimeStatus, setTimingStats])

  useEffect(() => {
    const { workspaceActions } = useOpenPLCStore.getState()

    if (connectionStatus === 'connected' && jwtToken) {
      consecutiveFailuresRef.current = 0
      void poll()

      pollIntervalRef.current = setInterval(() => {
        void poll()
      }, POLL_INTERVAL_MS)

      workspaceActions.setPlcLogsVisible(true)
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      workspaceActions.setPlcLogsVisible(false)
      workspaceActions.clearPlcLogs()
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [connectionStatus, jwtToken, poll])

  return {
    isConnected: connectionStatus === 'connected',
    plcStatus: useOpenPLCStore((state) => state.runtimeConnection.plcStatus),
  }
}
