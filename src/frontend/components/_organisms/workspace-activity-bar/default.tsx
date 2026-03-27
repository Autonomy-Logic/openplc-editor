import { useCallback, useEffect, useRef, useState } from 'react'

import type { DebugConnectionConfig } from '../../../../middleware/shared/ports/types'
import { useCompiler, useDebugger, useProject, useRuntime, useSimulator } from '../../../../middleware/shared/providers'
import { StopIcon } from '../../../assets/icons/interface/Stop'
import { useDebugPolling } from '../../../hooks/useDebugPolling'
import { useDebugSession } from '../../../hooks/useDebugSession'
import { useOpenPLCStore } from '../../../store'
import type { RuntimeConnection } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'
import { logCompilerEvent } from '../../../utils/debugger-session'
import { isOpenPLCRuntimeTarget, isOpenPLCRuntimeV4Target } from '../../../utils/device'
import { getErrorMessage } from '../../../utils/get-error-message'
import { prepareSavePayload } from '../../../utils/save-project'
import { ChatButton } from '../../_molecules/workspace-activity-bar/default/chat'
import { DebuggerButton } from '../../_molecules/workspace-activity-bar/default/debugger'
import { DownloadButton } from '../../_molecules/workspace-activity-bar/default/download'
import { PlayButton } from '../../_molecules/workspace-activity-bar/default/play'
import { SearchButton } from '../../_molecules/workspace-activity-bar/default/search'
import { ZoomButton } from '../../_molecules/workspace-activity-bar/default/zoom'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

const showDebuggerMessage = (
  type: 'info' | 'warning' | 'error' | 'question',
  title: string,
  message: string,
  buttons: string[],
): Promise<number> => {
  return new Promise((resolve) => {
    useOpenPLCStore.getState().modalActions.openModal('debugger-message', {
      type,
      title,
      message,
      buttons,
      onResponse: (buttonIndex: number) => resolve(buttonIndex),
    })
  })
}

const showDebuggerIpInput = (title: string, message: string, defaultValue: string): Promise<string | null> => {
  return new Promise((resolve) => {
    useOpenPLCStore.getState().modalActions.openModal('debugger-ip-input', {
      title,
      message,
      defaultValue,
      onSubmit: (value: string) => resolve(value),
      onCancel: () => resolve(null),
    })
  })
}

const disabledButtonClass = 'cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent'

type DefaultWorkspaceActivityBarProps = {
  zoom?: {
    onClick: () => void
  }
}

export const DefaultWorkspaceActivityBar = ({ zoom }: DefaultWorkspaceActivityBarProps) => {
  const {
    project: { data: projectData, meta: projectMeta },
    deviceDefinitions,
    deviceAvailableOptions: { availableBoards },
    consoleActions: { addLog },
  } = useOpenPLCStore()

  const compiler = useCompiler()
  const runtime = useRuntime()
  const simulator = useSimulator()
  const debuggerPort = useDebugger()
  const projectPort = useProject()
  const debugSession = useDebugSession()
  useDebugPolling({ debugTreesRef: debugSession.debugTreesRef })

  const [isCompiling, setIsCompiling] = useState(false)
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)
  const [simulatorRunning, setSimulatorRunning] = useState(false)
  const pendingSimulatorDebugRef = useRef(false)

  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const editingState = useOpenPLCStore((state) => state.workspace.editingState)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  const currentBoardInfo = availableBoards.get(deviceDefinitions.configuration.deviceBoard)
  const isSimulatorBoard = currentBoardInfo?.compiler === 'simulator'

  // Sync simulatorRunning when the simulator stops externally
  useEffect(() => {
    const unsub = simulator.onStopped(() => {
      pendingSimulatorDebugRef.current = false
      setSimulatorRunning(false)
      const { workspace } = useOpenPLCStore.getState()
      if (workspace.isDebuggerVisible) {
        void debugSession.stopSession()
      }
    })
    return unsub
  }, [simulator, debugSession])

  // Stop simulator if the board is switched away while it's running
  const prevIsSimulatorBoardRef = useRef(isSimulatorBoard)
  useEffect(() => {
    const wasSimulator = prevIsSimulatorBoardRef.current
    prevIsSimulatorBoardRef.current = isSimulatorBoard

    if (wasSimulator && !isSimulatorBoard && simulator.isRunning()) {
      addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: 'Board changed from simulator. Stopping simulator.',
      })
      void simulator.stop()
      if (isDebuggerVisible) {
        const { workspaceActions } = useOpenPLCStore.getState()
        workspaceActions.clearDebugState()
      }
    }
  }, [isSimulatorBoard, isDebuggerVisible, simulator, addLog])

  const executeSave = useCallback(async (): Promise<boolean> => {
    const state = useOpenPLCStore.getState()
    const { workspaceActions, fileActions, editors } = state
    const activeEditor = editors[0] ?? { type: 'available', meta: { name: '' } }
    try {
      workspaceActions.setEditingState('save-request')
      const payload = prepareSavePayload({
        projectPath: projectMeta.path,
        projectName: projectMeta.name,
        projectData,
        deviceConfiguration: deviceDefinitions.configuration,
        devicePinMapping: deviceDefinitions.pinMapping.pins,
        editors,
        activeEditor,
      })
      const res = await projectPort.saveProject(payload)
      if (res.success) {
        workspaceActions.setEditingState('saved')
        fileActions.setAllToSaved()
        return true
      }
      workspaceActions.setEditingState('unsaved')
      addLog({ id: crypto.randomUUID(), level: 'error', message: `Save failed: ${res.error ?? 'Unknown error'}` })
      return false
    } catch {
      workspaceActions.setEditingState('unsaved')
      return false
    }
  }, [projectPort, projectMeta, projectData, deviceDefinitions, addLog])

  // ---------------------------------------------------------------------------
  // Build (Compile)
  // ---------------------------------------------------------------------------

  const handleBuild = useCallback(async () => {
    if (isCompiling) return

    if (editingState === 'unsaved') {
      const saved = await executeSave()
      if (!saved) return
    }

    setIsCompiling(true)
    addLog({ id: crypto.randomUUID(), level: 'info', message: 'Build process started' })

    try {
      const result = await compiler.compileProgram(
        {
          projectData,
          boardTarget: deviceDefinitions.configuration.deviceBoard,
          projectPath: projectMeta.path,
          compileOnly: deviceDefinitions.configuration.compileOnly,
          isSimulator: isSimulatorBoard,
          runtimeIpAddress: deviceDefinitions.configuration.runtimeIpAddress || null,
          runtimeJwtToken: jwtToken || null,
        },
        (event) => {
          if (event.plcStatus) {
            useOpenPLCStore
              .getState()
              .deviceActions.setPlcRuntimeStatus(event.plcStatus as NonNullable<RuntimeConnection['plcStatus']>)
          }
          logCompilerEvent(event, addLog)
          if (event.firmwarePath && isSimulatorBoard) {
            void simulator.loadFirmware(event.firmwarePath).then((loadResult) => {
              if (loadResult.success) {
                setSimulatorRunning(true)
                addLog({ id: crypto.randomUUID(), level: 'info', message: 'Simulator is running.' })
                if (pendingSimulatorDebugRef.current) {
                  pendingSimulatorDebugRef.current = false
                  void debugSession.connectAndStart()
                }
              } else {
                pendingSimulatorDebugRef.current = false
                addLog({
                  id: crypto.randomUUID(),
                  level: 'error',
                  message: `Failed to start simulator: ${loadResult.error ?? 'Unknown error'}`,
                })
              }
            })
          }
        },
      )

      if (!result.success) {
        addLog({ id: crypto.randomUUID(), level: 'error', message: result.error ?? 'Compilation failed' })
      }
    } catch (err: unknown) {
      addLog({ id: crypto.randomUUID(), level: 'error', message: `Build error: ${getErrorMessage(err)}` })
    } finally {
      setIsCompiling(false)
    }
  }, [
    compiler,
    projectData,
    projectMeta,
    deviceDefinitions,
    isSimulatorBoard,
    simulator,
    debugSession,
    addLog,
    isCompiling,
    editingState,
    executeSave,
    jwtToken,
  ])

  const handleBuildRef = useRef(handleBuild)
  handleBuildRef.current = handleBuild

  // ---------------------------------------------------------------------------
  // PLC control (Start/Stop for runtime targets)
  // ---------------------------------------------------------------------------

  const handlePlcControl = useCallback(async (): Promise<void> => {
    if (!jwtToken || connectionStatus !== 'connected') return

    try {
      if (plcStatus === 'RUNNING') {
        const result = await runtime.stopPlc()
        if (!result.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Failed to stop PLC: ${result.error ?? 'Unknown error'}`,
          })
          return
        }
      } else {
        const result = await runtime.startPlc()
        if (!result.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Failed to start PLC: ${result.error ?? 'Unknown error'}`,
          })
          return
        }
      }

      const statusResult = await runtime.getStatus()
      if (statusResult.success && statusResult.status) {
        useOpenPLCStore
          .getState()
          .deviceActions.setPlcRuntimeStatus(statusResult.status as NonNullable<RuntimeConnection['plcStatus']>)
      }
    } catch (error: unknown) {
      addLog({ id: crypto.randomUUID(), level: 'error', message: `PLC control error: ${getErrorMessage(error)}` })
    }
  }, [runtime, jwtToken, connectionStatus, plcStatus, addLog])

  // ---------------------------------------------------------------------------
  // Simulator control (Start/Stop simulator + auto-debug)
  // ---------------------------------------------------------------------------

  const handleSimulatorControl = useCallback(async (): Promise<void> => {
    try {
      if (simulatorRunning) {
        await debugSession.stopSession()
        setSimulatorRunning(false)
        addLog({ id: crypto.randomUUID(), level: 'info', message: 'Simulator stopped.' })
      } else {
        pendingSimulatorDebugRef.current = true
        handleBuildRef.current().catch(() => {
          pendingSimulatorDebugRef.current = false
        })
      }
    } catch (error: unknown) {
      pendingSimulatorDebugRef.current = false
      addLog({ id: crypto.randomUUID(), level: 'error', message: `Simulator control error: ${getErrorMessage(error)}` })
    }
  }, [debugSession, simulatorRunning, addLog])

  // ---------------------------------------------------------------------------
  // MD5 verification — runs after debug compilation for non-simulator
  // ---------------------------------------------------------------------------

  const handleMd5Verification = async (
    projectPath: string,
    boardTarget: string,
    debugConfig: DebugConnectionConfig,
    isRuntimeTarget: boolean,
  ) => {
    const { consoleActions, runtimeConnection, deviceActions } = useOpenPLCStore.getState()

    try {
      // If runtime target + PLC stopped, offer to start
      if (isRuntimeTarget && runtimeConnection.plcStatus === 'STOPPED' && runtimeConnection.jwtToken) {
        const response = await showDebuggerMessage(
          'question',
          'PLC Stopped',
          'The PLC is currently stopped. The debugger requires the PLC to be running. Would you like to start the PLC now?',
          ['Yes', 'No'],
        )
        if (response === 1) {
          consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Debugger session cancelled.' })
          setIsDebuggerProcessing(false)
          return
        }

        consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Starting PLC...' })
        const startResult = await runtime.startPlc()
        if (!startResult.success) {
          await showDebuggerMessage(
            'error',
            'Start PLC Failed',
            `Could not start the PLC: ${startResult.error || 'Unknown error'}`,
            ['OK'],
          )
          setIsDebuggerProcessing(false)
          return
        }
        deviceActions.setPlcRuntimeStatus('RUNNING')
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      // Read local MD5
      consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Verifying program MD5...' })
      const md5Result = await debuggerPort.readProgramMd5(projectPath, boardTarget)
      if (!md5Result.success || !md5Result.md5) {
        await showDebuggerMessage('error', 'MD5 Extraction Failed', md5Result.error ?? 'Could not extract MD5', ['OK'])
        setIsDebuggerProcessing(false)
        return
      }

      // Connect debug transport before MD5 verification — the web platform
      // needs an active transport (WebRTC or HTTP fallback) to query the device.
      // connect() is idempotent: connectAndStart will reuse this connection.
      const preConnectResult = await debuggerPort.connect(debugConfig)
      if (!preConnectResult.success) {
        await showDebuggerMessage(
          'error',
          'Connection Error',
          `Could not connect to debug target: ${preConnectResult.error ?? 'Unknown error'}`,
          ['OK'],
        )
        setIsDebuggerProcessing(false)
        return
      }

      const verifyResult = await debuggerPort.verifyMd5(md5Result.md5, debugConfig)
      if (!verifyResult.success) {
        await debuggerPort.disconnect()
        await showDebuggerMessage(
          'error',
          'Connection Error',
          `Could not verify MD5: ${verifyResult.error ?? 'Unknown error'}`,
          ['OK'],
        )
        setIsDebuggerProcessing(false)
        return
      }

      if (verifyResult.match) {
        consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'MD5 verified. Starting debugger...' })
        await debugSession.connectAndStart(debugConfig)
        setIsDebuggerProcessing(false)
      } else {
        // Disconnect before re-upload; the recursive call will reconnect
        await debuggerPort.disconnect()

        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `MD5 mismatch. Target: ${verifyResult.targetMd5}, Expected: ${md5Result.md5}`,
        })
        const response = await showDebuggerMessage(
          'warning',
          'Program Mismatch',
          'The program on the target does not match. Upload the current project?',
          ['Yes', 'No'],
        )
        if (response === 0) {
          const runtimeIpAddress = deviceDefinitions.configuration.runtimeIpAddress || null
          const runtimeJwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || null
          const compileResult = await compiler.compileProgram(
            {
              projectData,
              boardTarget,
              projectPath,
              compileOnly: false,
              isSimulator: false,
              runtimeIpAddress,
              runtimeJwtToken,
            },
            (event) => logCompilerEvent(event, consoleActions.addLog),
          )
          if (compileResult.success) {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'info',
              message: 'Upload completed. Re-verifying...',
            })
            await new Promise((resolve) => setTimeout(resolve, 2000))
            void handleMd5Verification(projectPath, boardTarget, debugConfig, isRuntimeTarget)
          } else {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Upload failed: ${compileResult.error ?? 'Unknown error'}`,
            })
            setIsDebuggerProcessing(false)
          }
        } else {
          setIsDebuggerProcessing(false)
        }
      }
    } catch (error: unknown) {
      await debuggerPort.disconnect()
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `MD5 verification error: ${getErrorMessage(error)}`,
      })
      setIsDebuggerProcessing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Debugger click — full orchestration for non-simulator targets
  // ---------------------------------------------------------------------------

  const handleDebuggerClick = useCallback(async () => {
    if (isSimulatorBoard) return

    const { workspace, project, deviceDefinitions: devDefs, consoleActions, deviceActions } = useOpenPLCStore.getState()

    // Toggle off
    if (workspace.isDebuggerVisible) {
      await debugSession.stopSession()
      return
    }

    if (isDebuggerProcessing) return
    setIsDebuggerProcessing(true)

    try {
      if (editingState === 'unsaved') {
        const saved = await executeSave()
        if (!saved) {
          setIsDebuggerProcessing(false)
          return
        }
      }

      const boardTarget = devDefs.configuration.deviceBoard
      const projectPath = project.meta.path
      const boardInfo = availableBoards.get(boardTarget)
      const isRuntimeTarget = isOpenPLCRuntimeTarget(boardInfo)

      // Resolve connection config
      let debugConfig: DebugConnectionConfig = { connectionType: 'tcp', connectionParams: {} }

      if (isRuntimeTarget) {
        const rtConn = useOpenPLCStore.getState().runtimeConnection
        const runtimeIpAddress = devDefs.configuration.runtimeIpAddress
        if (!runtime.isReadyForDebug?.() || rtConn.connectionStatus !== 'connected') {
          await showDebuggerMessage('warning', 'Connection Required', 'Connect to the target first.', ['OK'])
          setIsDebuggerProcessing(false)
          return
        }
        if (isOpenPLCRuntimeV4Target(boardTarget)) {
          const token = rtConn.jwtToken || undefined
          if (!token) {
            await showDebuggerMessage(
              'error',
              'Authentication Required',
              'JWT token missing. Reconnect to the runtime.',
              ['OK'],
            )
            setIsDebuggerProcessing(false)
            return
          }
          debugConfig = {
            connectionType: 'websocket',
            connectionParams: { ipAddress: runtimeIpAddress, jwtToken: token },
          }
        } else {
          debugConfig = { connectionType: 'tcp', connectionParams: { ipAddress: runtimeIpAddress } }
        }
      } else {
        // Embedded hardware — determine TCP or RTU
        const { modbusTCP, modbusRTU, communicationPreferences } = devDefs.configuration.communicationConfiguration
        if (!communicationPreferences.enabledRTU && !communicationPreferences.enabledTCP) {
          await showDebuggerMessage('warning', 'Modbus Required', 'Modbus must be enabled for debugging.', ['OK'])
          setIsDebuggerProcessing(false)
          return
        }

        let useModbusTcp = communicationPreferences.enabledTCP
        if (communicationPreferences.enabledRTU && communicationPreferences.enabledTCP) {
          const resp = await showDebuggerMessage('question', 'Select Protocol', 'Which Modbus protocol?', [
            'RTU (Serial)',
            'TCP',
          ])
          useModbusTcp = resp === 1
        }

        if (useModbusTcp) {
          let targetIp: string | undefined
          if (communicationPreferences.enabledDHCP) {
            const previousIp = useOpenPLCStore.getState().deviceDefinitions.temporaryDhcpIp || ''
            const result = await showDebuggerIpInput('Target IP Address', 'Enter the target device IP:', previousIp)
            if (!result) {
              setIsDebuggerProcessing(false)
              return
            }
            targetIp = result
            deviceActions.setTemporaryDhcpIp(targetIp)
          } else {
            targetIp = modbusTCP.tcpStaticHostConfiguration.ipAddress || undefined
            if (!targetIp) {
              await showDebuggerMessage('error', 'Configuration Error', 'No IP configured for Modbus TCP.', ['OK'])
              setIsDebuggerProcessing(false)
              return
            }
          }
          debugConfig = { connectionType: 'tcp', connectionParams: { ipAddress: targetIp } }
        } else {
          const rtuPort = devDefs.configuration.communicationPort
          const rtuSlaveId = modbusRTU.rtuSlaveId ?? undefined
          if (!rtuPort) {
            await showDebuggerMessage('error', 'Configuration Error', 'No port selected for Modbus RTU.', ['OK'])
            setIsDebuggerProcessing(false)
            return
          }
          if (rtuSlaveId === undefined) {
            await showDebuggerMessage('error', 'Configuration Error', 'No slave ID configured for Modbus RTU.', ['OK'])
            setIsDebuggerProcessing(false)
            return
          }
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Using RTU: Port=${rtuPort}, Baud=${modbusRTU.rtuBaudRate}, SlaveID=${rtuSlaveId}`,
          })
          debugConfig = {
            connectionType: 'rtu',
            connectionParams: { port: rtuPort, baudRate: parseInt(modbusRTU.rtuBaudRate, 10), slaveId: rtuSlaveId },
          }
        }
      }

      // Debug compilation
      consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Starting debug compilation...' })
      const debugCompileResult = await compiler.compileForDebug({ projectData, boardTarget, projectPath }, (event) =>
        logCompilerEvent(event, consoleActions.addLog),
      )
      if (!debugCompileResult.success) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Debug compilation failed: ${debugCompileResult.error ?? 'Unknown error'}`,
        })
        setIsDebuggerProcessing(false)
        return
      }

      void handleMd5Verification(projectPath, boardTarget, debugConfig, isRuntimeTarget)
    } catch (error: unknown) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Debugger init error: ${getErrorMessage(error)}`,
      })
      setIsDebuggerProcessing(false)
    }
  }, [
    debuggerPort,
    runtime,
    compiler,
    debugSession,
    projectData,
    deviceDefinitions,
    projectMeta,
    availableBoards,
    isSimulatorBoard,
    isDebuggerProcessing,
    editingState,
    executeSave,
    addLog,
  ])

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Search'>
        <SearchButton />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Open/Close Toolbox'>
        <ZoomButton {...zoom} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent={isSimulatorBoard ? 'Use Start to build and run' : 'Compile'}>
        <DownloadButton
          disabled={isCompiling || isSimulatorBoard}
          className={cn((isCompiling || isSimulatorBoard) && disabledButtonClass)}
          onClick={() => void handleBuild()}
        />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton
        tooltipContent={
          isSimulatorBoard
            ? simulatorRunning
              ? 'Stop Simulator'
              : 'Start Simulator'
            : connectionStatus !== 'connected'
              ? 'Connect to runtime first'
              : plcStatus === 'RUNNING'
                ? 'Stop PLC'
                : 'Start PLC'
        }
      >
        <PlayButton
          onClick={isSimulatorBoard ? () => void handleSimulatorControl() : () => void handlePlcControl()}
          disabled={isSimulatorBoard ? isCompiling || isDebuggerProcessing : connectionStatus !== 'connected'}
          className={cn(
            isSimulatorBoard
              ? isCompiling || isDebuggerProcessing
                ? disabledButtonClass
                : ''
              : connectionStatus !== 'connected'
                ? disabledButtonClass
                : '',
          )}
        >
          {(isSimulatorBoard ? simulatorRunning : plcStatus === 'RUNNING') ? <StopIcon /> : null}
        </PlayButton>
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent={isSimulatorBoard ? 'Use Start to debug' : 'Debugger'}>
        <DebuggerButton
          onClick={() => void handleDebuggerClick()}
          disabled={isDebuggerProcessing || isSimulatorBoard}
          isActive={isDebuggerVisible}
          className={cn((isDebuggerProcessing || isSimulatorBoard) && disabledButtonClass)}
        />
      </TooltipSidebarWrapperButton>
      <ChatButton />
    </>
  )
}
