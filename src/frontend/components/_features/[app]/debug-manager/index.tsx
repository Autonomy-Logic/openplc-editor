/**
 * Debug Manager Component
 *
 * Headless component managing the debug lifecycle. Platform-agnostic:
 * all transport and connection concerns are handled by the adapter layer
 * (DebuggerPort). This component only manages session controls and
 * simulator lifecycle.
 *
 * Architecture:
 * - One useDebugSession hook (parses debug.c, builds trees, manages state)
 * - One useDebugPolling hook (polls via DebuggerPort, transport-agnostic)
 * - Transport selection delegated to the platform adapter via DebugConnectionConfig
 */

import { useEffect, useRef } from 'react'

import {
  clearDebugSessionControls,
  setDebugSessionControls,
} from '../../../../../backend/shared/debug/debug-session-controls'
import { simulatorService } from '../../../../../backend/shared/simulator/simulator-service'
import { useDebugPolling } from '../../../../hooks/useDebugPolling'
import { useDebugSession } from '../../../../hooks/useDebugSession'
import { useOpenPLCStore } from '../../../../store'

export const DebugManager = () => {
  const { workspaceActions, consoleActions } = useOpenPLCStore()
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  // Detect if the current board is the simulator
  const isSimulatorBoard = useOpenPLCStore((state) => {
    const boardName = state.deviceDefinitions.configuration.deviceBoard
    const boardInfo = state.deviceAvailableOptions.availableBoards.get(boardName)
    return boardInfo?.compiler === 'simulator'
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Single debug session + single polling loop (transport-agnostic)
  // ─────────────────────────────────────────────────────────────────────────
  const debugSession = useDebugSession()
  useDebugPolling({ debugTreesRef: debugSession.debugTreesRef })

  const debugSessionRef = useRef(debugSession)
  debugSessionRef.current = debugSession

  // ─────────────────────────────────────────────────────────────────────────
  // Debug session controls — bridge to useDebuggerLauncher
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setDebugSessionControls({
      startDebug: async (deviceId, username, password, _debugCContent, port) => {
        const config = isSimulatorBoard
          ? { connectionType: 'simulator' as const, connectionParams: {} }
          : {
              connectionType: 'webrtc' as const,
              connectionParams: {
                deviceId,
                username,
                password,
                port: port ? String(port) : undefined,
              },
            }
        const result = await debugSessionRef.current.connectAndStart(config)
        return result.success
      },

      stopDebug: () => {
        void debugSessionRef.current.stopSession()
      },

      forceVariable: (index, force, valueHex) => {
        return debugSessionRef.current.forceVariable(index, force, valueHex)
      },
    })

    return () => {
      clearDebugSessionControls()
    }
  }, [isSimulatorBoard])

  // ─────────────────────────────────────────────────────────────────────────
  // Simulator lifecycle (only when simulator board is selected)
  // ─────────────────────────────────────────────────────────────────────────

  // Subscribe to simulator stop events to clear debug state
  useEffect(() => {
    if (!isSimulatorBoard) return
    const unsub = simulatorService.onStopped(() => {
      const { workspace } = useOpenPLCStore.getState()
      if (workspace.isDebuggerVisible) {
        workspaceActions.clearDebugState()
      }
    })
    return unsub
  }, [isSimulatorBoard, workspaceActions])

  // Stop simulator if the board is switched away while it's running
  const prevIsSimulatorBoardRef = useRef(isSimulatorBoard)
  useEffect(() => {
    const wasSimulator = prevIsSimulatorBoardRef.current
    prevIsSimulatorBoardRef.current = isSimulatorBoard

    if (wasSimulator && !isSimulatorBoard && simulatorService.isRunning()) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: 'Board changed from simulator. Stopping simulator.',
      })
      simulatorService.stop()
      if (isDebuggerVisible) {
        workspaceActions.clearDebugState()
      }
    }
  }, [isSimulatorBoard, isDebuggerVisible, consoleActions, workspaceActions])

  return null
}
