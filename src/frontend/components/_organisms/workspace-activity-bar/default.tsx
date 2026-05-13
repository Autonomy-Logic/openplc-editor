import { useCallback, useEffect, useRef, useState } from 'react'

import type { DebugConnectionConfig } from '../../../../middleware/shared/ports/types'
import { projectCapabilities } from '../../../../middleware/shared/ports/types'
import { useCompiler, useDebugger, useProject, useRuntime, useSimulator } from '../../../../middleware/shared/providers'
import { StopIcon } from '../../../assets/icons/interface/Stop'
import { useDebugPolling } from '../../../hooks/useDebugPolling'
import { useDebugSession } from '../../../hooks/useDebugSession'
import { executeSaveProject } from '../../../services/save-actions'
import { useOpenPLCStore } from '../../../store'
import type { RuntimeConnection } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'
import { logCompilerEvent } from '../../../utils/debugger-session'
import { isArduinoTarget, isOpenPLCRuntimeTarget, isOpenPLCRuntimeV4Target } from '../../../utils/device'
import { getErrorMessage } from '../../../utils/get-error-message'
import { type BuildOption,BuildOptionsPopover } from '../../_features/[workspace]/build-options'
import { ChatButton } from '../../_molecules/workspace-activity-bar/default/chat'
import { DebuggerButton } from '../../_molecules/workspace-activity-bar/default/debugger'
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

  // Project-type capability matrix.  Drives which set of action
  // buttons the activity bar shows — the program path (Build /
  // Run / Debug) for PLC projects, the library path (Build
  // Library) for library projects.  See `projectCapabilities` in
  // `middleware/shared/ports/types.ts`.
  const projectCaps = projectCapabilities(projectMeta)

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
    const result = await executeSaveProject(projectPort)
    return result.success
  }, [projectPort])

  // ---------------------------------------------------------------------------
  // Build (Compile)
  // ---------------------------------------------------------------------------

  const handleBuild = useCallback(async (overrides?: { compileOnly?: boolean; cleanBuild?: boolean }) => {
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
          compileOnly: overrides?.compileOnly ?? deviceDefinitions.configuration.compileOnly,
          cleanBuild: overrides?.cleanBuild ?? false,
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
        // Surface the active transport in the store so transport-specific
        // pollers (useDebugPolling) can size their batches against the
        // real frame budget rather than guessing from the board target.
        useOpenPLCStore.getState().workspaceActions.setDebugConnectionType(debugConfig.connectionType)
        // Persist the target's byte order — detected from the MD5
        // response trailer in the runtime — so the swap layer at the
        // read / write boundaries flips on BE targets.  Default to
        // `'le'` when the trailer was missing or malformed (older
        // runtimes); detectTargetEndian already logged a warning.
        useOpenPLCStore
          .getState()
          .workspaceActions.setDebugTargetEndian(verifyResult.targetEndian ?? 'le')
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

    const { workspace, project, deviceDefinitions: devDefs, consoleActions } = useOpenPLCStore.getState()

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
        if (isOpenPLCRuntimeV4Target(boardTarget, boardInfo)) {
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
        // Non-runtime, non-simulator boards are expected to come back as
        // VPP Arduino-family packages, each owning its own debug-connection
        // surface. Refuse gracefully until that's wired in.
        await showDebuggerMessage(
          'warning',
          'Debugging Not Available',
          'Debugging for this target is not supported in the core editor. The selected board\'s VPP package must provide a debug adapter.',
          ['OK'],
        )
        setIsDebuggerProcessing(false)
        return
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
      {/* Program-build affordances: hidden for library projects.
          Library builds use a dedicated button (Phase 7 wires the
          actual compile dispatch — for Phase 3 we render a disabled
          placeholder that surfaces in the right spot). */}
      {projectCaps.hasProgramBuild && (
        <>
          <BuildOptionsPopover
            disabled={isCompiling || isSimulatorBoard}
            triggerTooltip={
              isSimulatorBoard ? 'Use Start to build and run' : isCompiling ? 'Compiling…' : 'Build options'
            }
            // Arduino targets always allow upload (arduino-cli connects via USB
            // at upload time). Runtime v3/v4 targets must be connected first
            // since the upload goes over the network to the on-device webserver.
            uploadAvailable={(() => {
              const arduino = isArduinoTarget(currentBoardInfo)
              if (arduino) return true
              return connectionStatus === 'connected'
            })()}
            uploadDisabledReason='must be connected to the device to upload'
            onSelect={(option: BuildOption) => {
              switch (option) {
                case 'build-only':
                  void handleBuild({ compileOnly: true, cleanBuild: false })
                  break
                case 'build-upload':
                  void handleBuild({ compileOnly: false, cleanBuild: false })
                  break
                case 'clean-upload':
                  void handleBuild({ compileOnly: false, cleanBuild: true })
                  break
              }
            }}
          />
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
        </>
      )}
      {/* Library-build affordance: shown only for library projects.
          The actual compile dispatch (`compileLibrary`) lands in
          Phase 7 — for Phase 3 the click handler emits a console
          log placeholder so the affordance is visible and reachable
          without any half-wired backend behaviour. */}
      {projectCaps.hasLibraryBuild && (
        <TooltipSidebarWrapperButton tooltipContent='Build Library'>
          <BuildOptionsPopover
            disabled={true}
            triggerTooltip='Build Library — wiring in progress'
            uploadAvailable={false}
            uploadDisabledReason='library builds do not upload'
            onSelect={() => {
              addLog({
                id: crypto.randomUUID(),
                level: 'info',
                message: 'Library build not yet wired (Phase 7).',
              })
            }}
          />
        </TooltipSidebarWrapperButton>
      )}
      <TooltipSidebarWrapperButton tooltipContent='AI Chat'>
        <ChatButton />
      </TooltipSidebarWrapperButton>
    </>
  )
}
