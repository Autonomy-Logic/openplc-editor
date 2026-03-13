/**
 * Debug Manager Component
 *
 * Single headless component that manages the entire debug lifecycle,
 * replacing the previous dual SimulatorManager + WebRTCManager pattern.
 *
 * Architecture:
 * - One useDebugSession hook (parses debug.c, builds trees, manages state)
 * - One useDebugPolling hook (polls via debugBridge, transport-agnostic)
 * - Transport selection based on board type:
 *   - Simulator board → ModbusRtuTransport (local AVR emulator)
 *   - Remote board → WebRTCTransport (with HTTP fallback)
 * - WebRTC connection lifecycle runs in background (does not block HTTP)
 *
 * Mirrors the desktop editor's MainProcessBridge pattern where one bridge
 * manages one active transport and the polling loop never knows which
 * transport is active.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useOpenPLCStore } from '../../../../store'
import { useWebRTCConnection } from '../../../../hooks/useWebRTCConnection'
import { useDebugSession } from '../../../../hooks/useDebugSession'
import { useDebugPolling } from '../../../../hooks/useDebugPolling'
import { debugBridge, ModbusRtuTransport, WebRTCTransport } from '../../../../services/debug'
import type { WebRTCTransportConfig } from '../../../../services/debug'
import { simulatorService } from '../../../../services/simulator'
import { setDebugSessionControls, clearDebugSessionControls } from '../../../../services/debug-session-controls'

export const DebugManager = () => {
  const { runtimeConnection, workspaceActions, consoleActions, webrtcActions } = useOpenPLCStore()
  const webrtcStatus = useOpenPLCStore((state) => state.session.status)
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
  // WebRTC connection (only used when NOT simulator board)
  // ─────────────────────────────────────────────────────────────────────────
  const webrtcTransportRef = useRef<WebRTCTransport | null>(null)
  const selectedDevice = runtimeConnection.selectedDevice

  const webrtc = useWebRTCConnection({
    deviceId: selectedDevice?.deviceId ?? '',
    deviceName: selectedDevice?.deviceName ?? '',
    agentId: selectedDevice?.orchestratorAgentId ?? '',
    onDebugMessage: (msg) => webrtcTransportRef.current?.onDebugMessage(msg),
  })

  const {
    connect: webrtcConnect,
    disconnect: webrtcDisconnect,
    sendDebugMessage: webrtcSendDebugMessage,
    openDebugChannel: webrtcOpenDebugChannel,
    closeDebugChannel: webrtcCloseDebugChannel,
  } = webrtc

  // ─────────────────────────────────────────────────────────────────────────
  // WebRTC upgrade helper
  // ─────────────────────────────────────────────────────────────────────────
  const tryUpgradeToWebRTC = useCallback(
    (context: string) => {
      webrtcOpenDebugChannel()
        .then((opened) => {
          if (opened) {
            console.log(`[DebugManager] Debug channel opened (${context}) — upgrading transport to WebRTC`)
            webrtcActions.setDebugTransport('webrtc')
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'info',
              message: 'WebRTC connected. Debug polling upgraded to high-speed mode.',
            })
          } else {
            console.warn(`[DebugManager] Debug channel failed to open (${context}) — staying on HTTP`)
          }
        })
        .catch((err) => {
          console.error(`[DebugManager] Debug channel upgrade error (${context}):`, err)
        })
    },
    [webrtcOpenDebugChannel, webrtcActions, consoleActions],
  )

  // ─────────────────────────────────────────────────────────────────────────
  // Debug session controls — registered once, transport-aware
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setDebugSessionControls({
      startDebug: async (deviceId, username, password, debugCContent, port) => {
        if (isSimulatorBoard) {
          // Simulator path: set up ModbusRtuTransport
          debugBridge.setTransport('simulator', new ModbusRtuTransport())
        } else {
          // Remote path: set up WebRTCTransport (starts on HTTP, WebRTC upgrades in background)
          const transportConfig: WebRTCTransportConfig = {
            sendViaDataChannel: webrtcSendDebugMessage,
            agentId: selectedDevice?.orchestratorAgentId ?? '',
            deviceId: selectedDevice?.deviceId ?? '',
            username,
            password,
            port,
            onReady: () => {
              // Auto-recovery: remote agent restarted mid-session — re-send debug_start
              const { workspace: ws, runtimeConnection: rc } = useOpenPLCStore.getState()
              if (ws.isDebuggerVisible) {
                const creds = rc.storedCredentials
                const device = rc.selectedDevice
                if (creds && device) {
                  consoleActions.addLog({
                    id: crypto.randomUUID(),
                    level: 'info',
                    message: 'Debug channel reconnected. Resuming debug session...',
                  })
                  webrtcSendDebugMessage({
                    type: 'debug_start',
                    device_id: device.deviceId,
                    username: creds.username,
                    password: creds.password,
                    port: port ?? 8443,
                  })
                } else {
                  consoleActions.addLog({
                    id: crypto.randomUUID(),
                    level: 'warning',
                    message: 'Debug channel reconnected but credentials unavailable. Please restart the debugger.',
                  })
                  workspaceActions.clearDebugState()
                }
              }
            },
          }
          const transport = new WebRTCTransport(transportConfig)
          webrtcTransportRef.current = transport
          debugBridge.setTransport('webrtc', transport)
        }

        // For remote boards, connect the transport (sends debug_start to the agent).
        // This goes via HTTP fallback initially; WebRTC DataChannel upgrade happens below.
        // For simulator, connectDebugger() is already called by useDebuggerLauncher before
        // this function, so we skip it here to avoid double-connecting.
        if (!isSimulatorBoard) {
          try {
            await debugBridge.connect()
          } catch (err) {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Debug connection failed: ${err instanceof Error ? err.message : err}`,
            })
            debugBridge.clearTransport()
            return false
          }
        }

        // Start debug session (builds trees, indexes, commits to store)
        const result = debugSessionRef.current.startDebug(deviceId, username, password, debugCContent, port)

        // If WebRTC main channel is connected, try to open debug channel in background
        if (!isSimulatorBoard) {
          const currentStatus = useOpenPLCStore.getState().session.status
          if (currentStatus === 'connected') {
            tryUpgradeToWebRTC('debug-start')
          }
        }

        return result
      },

      stopDebug: () => {
        if (!isSimulatorBoard) {
          webrtcActions.setDebugTransport('http')
          webrtcCloseDebugChannel()
          webrtcTransportRef.current = null
        }
        debugSessionRef.current.stopDebug()
        debugBridge.clearTransport()
      },

      forceVariable: (index, force, valueHex) => {
        return debugSessionRef.current.forceVariable(index, force, valueHex)
      },
    })

    return () => {
      clearDebugSessionControls()
    }
  }, [
    isSimulatorBoard,
    webrtcActions,
    consoleActions,
    workspaceActions,
    webrtcCloseDebugChannel,
    webrtcSendDebugMessage,
    selectedDevice,
    tryUpgradeToWebRTC,
  ])

  // ─────────────────────────────────────────────────────────────────────────
  // WebRTC connection lifecycle (background — only for non-simulator boards)
  // ─────────────────────────────────────────────────────────────────────────
  const prevConnectionStatusRef = useRef(runtimeConnection.connectionStatus)
  const prevSelectedDeviceRef = useRef(selectedDevice?.deviceId ?? null)

  useEffect(() => {
    if (isSimulatorBoard) return

    const prevStatus = prevConnectionStatusRef.current
    const currentStatus = runtimeConnection.connectionStatus
    prevConnectionStatusRef.current = currentStatus

    if (prevStatus !== 'connected' && currentStatus === 'connected' && selectedDevice) {
      console.log('[DebugManager] Runtime connected, establishing WebRTC in background')
      webrtcConnect().catch((err) => {
        console.error('[DebugManager] WebRTC background connection failed:', err)
      })
    }

    if (prevStatus === 'connected' && currentStatus !== 'connected') {
      console.log('[DebugManager] Runtime disconnected, closing WebRTC')
      webrtcActions.setDebugTransport('http')
      if (isDebuggerVisible) {
        workspaceActions.clearDebugState()
      }
      webrtcDisconnect().catch((err) => {
        console.error('[DebugManager] Failed to close connection:', err)
      })
    }
  }, [
    runtimeConnection.connectionStatus,
    selectedDevice,
    isSimulatorBoard,
    isDebuggerVisible,
    workspaceActions,
    webrtcActions,
    webrtcConnect,
    webrtcDisconnect,
  ])

  // Clear debug state when user switches to a different device while debugging
  useEffect(() => {
    if (isSimulatorBoard) return

    const prevDeviceId = prevSelectedDeviceRef.current
    const currentDeviceId = selectedDevice?.deviceId ?? null
    prevSelectedDeviceRef.current = currentDeviceId

    if (prevDeviceId && currentDeviceId && prevDeviceId !== currentDeviceId && isDebuggerVisible) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: 'Device changed. Clearing debug session.',
      })
      webrtcActions.setDebugTransport('http')
      workspaceActions.clearDebugState()
    }
  }, [selectedDevice?.deviceId, isSimulatorBoard, isDebuggerVisible, consoleActions, workspaceActions, webrtcActions])

  // ─────────────────────────────────────────────────────────────────────────
  // WebRTC transport status management (non-simulator only)
  // ─────────────────────────────────────────────────────────────────────────
  const prevWebrtcStatusRef = useRef(webrtcStatus)
  useEffect(() => {
    if (isSimulatorBoard) return

    const prev = prevWebrtcStatusRef.current
    prevWebrtcStatusRef.current = webrtcStatus

    // Permanent failure → downgrade to HTTP
    if (prev !== 'failed' && webrtcStatus === 'failed') {
      webrtcActions.setDebugTransport('http')
      if (isDebuggerVisible) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: 'WebRTC connection failed permanently. Debugger continuing via HTTP.',
        })
      }
    }

    // Transient failure → ensure HTTP
    if (webrtcStatus === 'error' || webrtcStatus === 'disconnected' || webrtcStatus === 'reconnecting') {
      const currentTransport = useOpenPLCStore.getState().session.debugTransport
      if (currentTransport === 'webrtc') {
        webrtcActions.setDebugTransport('http')
      }
    }
  }, [webrtcStatus, isSimulatorBoard, isDebuggerVisible, consoleActions, webrtcActions])

  // WebRTC upgrade on reconnect
  const prevWebrtcStatusForUpgradeRef = useRef(webrtcStatus)
  useEffect(() => {
    if (isSimulatorBoard) return

    const prevStatus = prevWebrtcStatusForUpgradeRef.current
    prevWebrtcStatusForUpgradeRef.current = webrtcStatus

    if (prevStatus !== 'connected' && webrtcStatus === 'connected' && isDebuggerVisible) {
      tryUpgradeToWebRTC('webrtc-reconnect')
    }
  }, [webrtcStatus, isSimulatorBoard, isDebuggerVisible, tryUpgradeToWebRTC])

  // Close debug channel when debugger becomes hidden
  const prevDebuggerVisibleRef = useRef(isDebuggerVisible)
  useEffect(() => {
    const wasVisible = prevDebuggerVisibleRef.current
    prevDebuggerVisibleRef.current = isDebuggerVisible

    if (wasVisible && !isDebuggerVisible) {
      if (!isSimulatorBoard) {
        webrtcActions.setDebugTransport('http')
        webrtcCloseDebugChannel()
      }
      webrtcTransportRef.current = null
      debugBridge.clearTransport()
    }
  }, [isDebuggerVisible, isSimulatorBoard, webrtcActions, webrtcCloseDebugChannel])

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
