import { StopIcon } from '../../../assets'
import { cn } from '../../../utils'
import { useOpenPLCStore } from '../../../store'
import type { RuntimeConnection } from '../../../store/slices/device/types'
import { useCompiler, useRuntime, useSimulator, useDebugger } from '../../../../middleware/shared/providers'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ChatButton,
  DebuggerButton,
  DownloadButton,
  PlayButton,
  SearchButton,
  ZoomButton,
} from '../../_molecules/workspace-activity-bar/default'
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
    workspace: { editingState },
    consoleActions: { addLog },
  } = useOpenPLCStore()

  const compiler = useCompiler()
  const runtime = useRuntime()
  const simulator = useSimulator()
  const debuggerPort = useDebugger()

  const [isCompiling, setIsCompiling] = useState(false)
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)
  const [simulatorRunning, setSimulatorRunning] = useState(false)
  const pendingSimulatorDebugRef = useRef(false)

  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  const currentBoardInfo = availableBoards.get(deviceDefinitions.configuration.deviceBoard)
  const isSimulatorBoard = currentBoardInfo?.compiler === 'simulator'

  // Sync simulatorRunning when the simulator stops externally
  useEffect(() => {
    const unsub = simulator.onStopped(() => {
      pendingSimulatorDebugRef.current = false
      setSimulatorRunning(false)
      // Clean up debugger state if it was connected via simulator
      const { workspace, workspaceActions } = useOpenPLCStore.getState()
      if (workspace.isDebuggerVisible) {
        void debuggerPort.disconnect()
        workspaceActions.setDebuggerVisible(false)
        workspaceActions.clearDebugState()
      }
    })
    return unsub
  }, [simulator, debuggerPort])

  const handleBuild = useCallback(async () => {
    if (isCompiling) return
    setIsCompiling(true)

    addLog({ id: crypto.randomUUID(), level: 'info', message: 'Build process started' })

    try {
      const boardTarget = deviceDefinitions.configuration.deviceBoard
      const projectPath = projectMeta.path

      const result = await compiler.compileProgram(
        {
          projectData,
          boardTarget,
          projectPath,
          compileOnly: !isSimulatorBoard,
        },
        (event) => {
          if (event.message) {
            event.message
              .trim()
              .split('\n')
              .forEach((line) => {
                addLog({ id: crypto.randomUUID(), level: event.level ?? 'info', message: line })
              })
          }
          if (event.firmwarePath && isSimulatorBoard) {
            void simulator.loadFirmware(event.firmwarePath).then((loadResult) => {
              if (loadResult.success) {
                setSimulatorRunning(true)
                addLog({ id: crypto.randomUUID(), level: 'info', message: 'Simulator is running.' })
                if (pendingSimulatorDebugRef.current) {
                  pendingSimulatorDebugRef.current = false
                  void connectDebuggerAfterBuild()
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
        addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: result.error ?? 'Compilation failed',
        })
      }
    } catch (err: unknown) {
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Build error: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsCompiling(false)
    }
  }, [compiler, projectData, projectMeta, deviceDefinitions, isSimulatorBoard, simulator, addLog, isCompiling])

  const handleBuildRef = useRef(handleBuild)
  handleBuildRef.current = handleBuild

  const connectDebuggerAfterBuild = async () => {
    const { workspaceActions, consoleActions: logActions } = useOpenPLCStore.getState()
    const boardTarget = deviceDefinitions.configuration.deviceBoard
    const projectPath = projectMeta.path

    logActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Connecting debugger...' })

    try {
      // Read debug file and set up variable mapping
      const debugFileResult = await debuggerPort.readDebugFile(projectPath, boardTarget)
      if (!debugFileResult.success || !debugFileResult.content) {
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to read debug file: ${debugFileResult.error ?? 'No content'}`,
        })
        return
      }

      workspaceActions.setDebugCContent(debugFileResult.content)

      // Connect debugger
      const connectResult = await debuggerPort.connect()
      if (!connectResult.success) {
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Debugger connection failed: ${connectResult.error ?? 'Unknown error'}`,
        })
        return
      }

      workspaceActions.setDebuggerVisible(true)
      logActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Debugger connected.' })
    } catch (err: unknown) {
      logActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Debugger error: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

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
        useOpenPLCStore.getState().deviceActions.setPlcRuntimeStatus(
          statusResult.status as NonNullable<RuntimeConnection['plcStatus']>,
        )
      }
    } catch (error: unknown) {
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `PLC control error: ${String(error)}`,
      })
    }
  }, [runtime, jwtToken, connectionStatus, plcStatus, addLog])

  const handleSimulatorControl = useCallback(async (): Promise<void> => {
    try {
      if (simulatorRunning) {
        // Stop: disconnect debugger first, then stop simulator
        const { workspace, workspaceActions } = useOpenPLCStore.getState()
        if (workspace.isDebuggerVisible) {
          await debuggerPort.disconnect()
          workspaceActions.setDebuggerVisible(false)
          workspaceActions.clearDebugState()
        }
        await simulator.stop()
        setSimulatorRunning(false)
        addLog({ id: crypto.randomUUID(), level: 'info', message: 'Simulator stopped.' })
      } else {
        // Start: build, load firmware, then auto-connect debugger
        pendingSimulatorDebugRef.current = true
        handleBuildRef.current().catch(() => {
          pendingSimulatorDebugRef.current = false
        })
      }
    } catch (error: unknown) {
      pendingSimulatorDebugRef.current = false
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Simulator control error: ${String(error)}`,
      })
    }
  }, [simulator, debuggerPort, simulatorRunning, addLog])

  const handleDebuggerClick = useCallback(async () => {
    if (isDebuggerProcessing) return
    setIsDebuggerProcessing(true)

    try {
      const { workspace, workspaceActions } = useOpenPLCStore.getState()

      if (workspace.isDebuggerVisible) {
        // Disconnect
        await debuggerPort.disconnect()
        workspaceActions.setDebuggerVisible(false)
        workspaceActions.clearDebugState()
        return
      }

      // Verify MD5 before connecting
      const boardTarget = deviceDefinitions.configuration.deviceBoard
      const projectPath = projectMeta.path

      const md5Result = await debuggerPort.readProgramMd5(projectPath, boardTarget)
      if (!md5Result.success || !md5Result.md5) {
        const choice = await showDebuggerMessage(
          'warning',
          'Debug Data Not Found',
          'No debug data found. Would you like to compile the project first?',
          ['Compile', 'Cancel'],
        )
        if (choice === 0) {
          await handleBuildRef.current()
        }
        return
      }

      const verifyResult = await debuggerPort.verifyMd5(md5Result.md5)
      if (!verifyResult.success) {
        const choice = await showDebuggerMessage(
          'warning',
          'Program Mismatch',
          'The running program does not match the compiled program. Do you want to recompile?',
          ['Recompile', 'Continue Anyway', 'Cancel'],
        )
        if (choice === 0) {
          await handleBuildRef.current()
          return
        }
        if (choice === 2) return
      }

      await connectDebuggerAfterBuild()
    } catch (err: unknown) {
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Debugger error: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsDebuggerProcessing(false)
    }
  }, [debuggerPort, deviceDefinitions, projectMeta, isDebuggerProcessing, addLog])

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
          disabled={
            isSimulatorBoard
              ? isCompiling || isDebuggerProcessing
              : connectionStatus !== 'connected'
          }
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
