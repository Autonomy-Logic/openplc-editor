import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { evaluatePreBuildPlcGate } from '@root/middleware/shared/utils/build-gate/pre-build-plc-gate'
import {
  evaluateRuntimeCapabilityGate,
  requiredRuntimeFeatures,
  runtimeCapabilityStateFor,
} from '@root/middleware/shared/utils/build-gate/runtime-capability-gate'
import {
  evaluateVariablesTextGate,
  variablesTextGateStateFor,
} from '@root/middleware/shared/utils/build-gate/variables-text-gate'
import { evaluateVppBackplaneGate, vppGateStateFor } from '@root/middleware/shared/utils/build-gate/vpp-backplane-gate'
import { composeLibraryDebugHarness } from '@root/middleware/shared/utils/library-debug/compose-library-debug-harness'
import { demoModeConsoleLines } from '@root/middleware/shared/utils/licensing'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useCallback, useEffect, useRef, useState } from 'react'

import { resolveDeviceLinkCandidates } from '../../../../backend/shared/hardware/debug-spec'
import { projectCapabilities } from '../../../../middleware/shared/ports/types'
import {
  useCapabilities,
  useCompiler,
  useDebugger,
  useDevice,
  useProject,
  useRuntime,
  useSimulator,
} from '../../../../middleware/shared/providers'
import { StopIcon } from '../../../assets/icons/interface/Stop'
import { useDeviceConnect } from '../../../hooks/use-device-connect'
import { useRuntimeConnect } from '../../../hooks/use-runtime-connect'
import { useSimulatorDebugRun } from '../../../hooks/use-simulator-debug-run'
import { useDebugPolling } from '../../../hooks/useDebugPolling'
import { useDebugSession } from '../../../hooks/useDebugSession'
import {
  awaitDebugSession,
  type DebugSessionOutcome,
  SESSION_OPEN_TIMEOUT_MS,
} from '../../../services/await-debug-session'
import {
  buildDeviceResolverContext,
  describeConnectTarget,
  showDeviceDialog,
  showDeviceInput,
} from '../../../services/device-link-resolution'
import { executeSaveProject } from '../../../services/save-actions'
import { type OpenPLCStore, useOpenPLCStore, useOpenPLCStoreApi } from '../../../store'
import type { RuntimeConnection } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'
import { logCompilerEvent } from '../../../utils/debugger-session'
import { isOpenPLCRuntimeTarget } from '../../../utils/device'
import { onDeviceFlashRequest } from '../../../utils/device-connect-events'
import { buildTypeContext } from '../../../utils/generate-iec-string-to-variables'
import { getErrorMessage } from '../../../utils/get-error-message'
import { provisioningMessage } from '../../../utils/runtime-provisioning-messages'
import { type BuildOption, BuildOptionsPopover } from '../../_features/[workspace]/build-options'
import { BuildLibraryButton } from '../../_molecules/workspace-activity-bar/default/build-library'
import { ChatButton } from '../../_molecules/workspace-activity-bar/default/chat'
import { DebuggerButton } from '../../_molecules/workspace-activity-bar/default/debugger'
import { PlayButton } from '../../_molecules/workspace-activity-bar/default/play'
import { SearchButton } from '../../_molecules/workspace-activity-bar/default/search'
import { ZoomButton } from '../../_molecules/workspace-activity-bar/default/zoom'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

const AI_PENDING_CHANGES_REFUSAL =
  'The AI assistant has changes waiting for review. Keep or undo them in the AI chat before building.'

// True while an AI review is pending or the agentic loop is running.
const aiChangesUnreviewed = (store: OpenPLCStore): boolean => {
  const { ai } = store.getState()
  return ai.pendingReview !== null || ai.isAgenticLoopRunning
}

const disabledButtonClass = 'cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent'

const LIBRARY_DEBUG_BOARD = 'OpenPLC Simulator'

type DefaultWorkspaceActivityBarProps = {
  zoom?: {
    onClick: () => void
  }
}

export const DefaultWorkspaceActivityBar = ({ zoom }: DefaultWorkspaceActivityBarProps) => {
  const store = useOpenPLCStoreApi()
  const {
    project: { data: projectData, meta: projectMeta },
    deviceDefinitions,
    deviceAvailableOptions: { availableBoards },
    consoleActions: { addLog, requestConsoleFollow },
  } = useOpenPLCStore()

  const projectCaps = projectCapabilities(projectMeta)

  const compiler = useCompiler()
  const runtime = useRuntime()
  const simulator = useSimulator()
  const debuggerPort = useDebugger()
  const device = useDevice()
  const projectPort = useProject()
  const capabilities = useCapabilities()
  const debugSession = useDebugSession()
  useDebugPolling({ debugTreesRef: debugSession.debugTreesRef })

  const [isCompiling, setIsCompiling] = useState(false)
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)
  const pendingSimulatorDebugRef = useRef(false)
  const debugSessionRidesDeviceRef = useRef(false)

  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const switchPosition = useOpenPLCStore((state) => state.runtimeConnection.switchPosition)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)
  const canEdit = useOpenPLCStore((state) => state.workspace.canEdit)

  const currentBoardInfo = availableBoards.get(deviceDefinitions.configuration.deviceBoard)
  const isSimulatorBoard = resolveTargetCapabilities(currentBoardInfo).isInProcessSimulator

  const deviceConnect = useDeviceConnect(currentBoardInfo)
  const runtimeConnect = useRuntimeConnect()

  const needsDeviceSelection = useOpenPLCStore(
    (state) => capabilities.hasOrchestratorDevices && state.runtimeConnection.selectedDevice === null,
  )

  const selectedDeviceName = useOpenPLCStore((state) => state.runtimeConnection.selectedDevice?.deviceName ?? null)

  const offerSimulatorStart = isSimulatorBoard && selectedDeviceName === null

  const deviceConnectionStatus = useOpenPLCStore((state) => state.deviceConnection.status)

  const plcStateControlSupported = resolveTargetCapabilities(currentBoardInfo).plcStateControl
  const plcTransitioning = plcStatus === 'TRANSITIONING'
  const plcControlBlocked = !plcStateControlSupported || deviceConnectionStatus !== 'connected' || plcTransitioning
  const plcControlBlockedReason = !plcStateControlSupported
    ? 'This target does not support Start/Stop from the editor'
    : deviceConnectionStatus !== 'connected'
      ? 'Connect to the target first'
      : 'PLC is changing state...'

  const simulatorRun = useSimulatorDebugRun({
    debugSession,
    onDebugAttached: () => {
      debugSessionRidesDeviceRef.current = true
    },
    onStopped: () => {
      pendingSimulatorDebugRef.current = false
      debugSessionRidesDeviceRef.current = false
    },
  })
  const simulatorRunning = simulatorRun.isRunning

  useEffect(() => {
    if (deviceConnectionStatus === 'connected') return
    if (!debugSessionRidesDeviceRef.current) return
    if (!store.getState().workspace.isDebuggerVisible) return

    addLog({
      level: 'warning',
      message: 'Device disconnected — stopping the debug session (serial debugging runs over the device connection).',
    })
    debugSessionRidesDeviceRef.current = false
    void debugSession.stopSession()
  }, [deviceConnectionStatus, debugSession, addLog, store])

  const prevIsSimulatorBoardRef = useRef(isSimulatorBoard)
  useEffect(() => {
    const wasSimulator = prevIsSimulatorBoardRef.current
    prevIsSimulatorBoardRef.current = isSimulatorBoard

    if (wasSimulator && !isSimulatorBoard && simulator.isRunning()) {
      addLog({
        level: 'info',
        message: 'Board changed from simulator. Stopping simulator.',
      })
      void simulator.stop()
      if (isDebuggerVisible) {
        const { workspaceActions } = store.getState()
        workspaceActions.clearDebugState()
      }
    }
  }, [isSimulatorBoard, isDebuggerVisible, simulator, addLog, store])

  /**
   * True when a POU's declaration text does not parse, after logging and showing the refusal.
   * Runs after the pre-build save, so the text the user typed is on disk before the build stops.
   */
  const refusedForVariablesText = useCallback((): boolean => {
    const state = store.getState()
    const verdict = evaluateVariablesTextGate(
      variablesTextGateStateFor({
        pous: state.project.data.pous,
        editorFor: (pouName) => state.editorActions.getEditorFromEditors(pouName) ?? undefined,
        context: buildTypeContext(state.project.data.pous, state.project.data.dataTypes, state.libraries),
      }),
    )
    if (verdict.kind !== 'refuse') return false

    addLog({ level: 'error', message: `Build refused: ${verdict.reason}` })
    toast({ title: 'Build refused', description: verdict.reason, variant: 'fail' })
    return true
  }, [addLog, store])

  const executeSave = useCallback(async (): Promise<boolean> => {
    const result = await executeSaveProject(store, projectPort, capabilities, 'pre-build')
    return result.success
  }, [projectPort, capabilities, store])

  const handleBuild = useCallback(
    async (overrides?: { compileOnly?: boolean; cleanBuild?: boolean }): Promise<boolean> => {
      if (isCompiling) return false

      requestConsoleFollow()

      {
        const state = store.getState()
        const boardInfo = state.deviceAvailableOptions.availableBoards.get(
          state.deviceDefinitions.configuration.deviceBoard,
        )
        const gate = evaluateVppBackplaneGate(
          vppGateStateFor({
            board: boardInfo,
            boardName: state.deviceDefinitions.configuration.deviceBoard,
            target: state.runtimeConnection.selectedDevice,
            vplcProvidesVendorBoards: capabilities.hasOrchestratorDevices,
          }),
        )
        if (gate.kind === 'refuse') {
          addLog({ level: 'error', message: gate.reason })
          return false
        }
      }

      if (aiChangesUnreviewed(store)) {
        addLog({ level: 'error', message: AI_PENDING_CHANGES_REFUSAL })
        return false
      }

      if (canEdit) {
        const saved = await executeSave()
        if (!saved) return false
      }

      if (refusedForVariablesText()) return false

      setIsCompiling(true)

      {
        const state = store.getState()
        const boardInfo = state.deviceAvailableOptions.availableBoards.get(
          state.deviceDefinitions.configuration.deviceBoard,
        )
        const { connectionStatus: connStatus, plcStatus: runStatus } = state.runtimeConnection
        const gate = evaluatePreBuildPlcGate({
          buildsOnDevice: !resolveTargetCapabilities(boardInfo).directUsbUpload,
          connected: connStatus === 'connected',
          running: runStatus === 'RUNNING',
        })
        if (gate.kind === 'must-stop') {
          const response = await showDeviceDialog(
            store,
            'warning',
            'Stop PLC',
            'The PLC must be stopped before continuing.',
            ['Cancel', 'Stop PLC and Continue'],
            { primaryButtonIndex: 1, dismissButtonIndex: 0 },
          )
          if (response !== 1) {
            setIsCompiling(false)
            return false
          }
          if (aiChangesUnreviewed(store)) {
            addLog({ level: 'error', message: AI_PENDING_CHANGES_REFUSAL })
            setIsCompiling(false)
            return false
          }
          const stopResult = (await debuggerPort.setPlcState?.('STOPPED')) ?? {
            success: false,
            error: 'This target does not support run/stop control',
          }
          if (!stopResult.success) {
            addLog({
              level: 'error',
              message: `Failed to stop PLC: ${stopResult.error ?? 'Unknown error'}`,
            })
            setIsCompiling(false)
            return false
          }
          store.getState().deviceActions.setPlcRuntimeStatus('STOPPED')
          addLog({ level: 'info', message: 'PLC stopped before build.' })
        }
      }

      if (aiChangesUnreviewed(store)) {
        addLog({ level: 'error', message: AI_PENDING_CHANGES_REFUSAL })
        setIsCompiling(false)
        return false
      }

      {
        const state = store.getState()
        const connected = state.runtimeConnection.connectionStatus === 'connected'
        const remoteDevices = state.project.data.remoteDevices
        let advertisedFeatures = state.runtimeConnection.runtimeFeatures ?? undefined
        let unavailableReason: string | undefined
        if (connected && requiredRuntimeFeatures(remoteDevices).length > 0) {
          const caps = await runtime.getRuntimeCapabilities()
          if (caps.features !== null) {
            state.deviceActions.setRuntimeFeatures(caps.features)
            advertisedFeatures = caps.features
          } else {
            advertisedFeatures = undefined
            unavailableReason = caps.error ?? 'no answer from the runtime'
          }
        }
        const gate = evaluateRuntimeCapabilityGate(
          runtimeCapabilityStateFor({
            remoteDevices,
            advertisement: { connected, advertisedFeatures, unavailableReason },
          }),
        )
        if (gate.kind === 'refuse') {
          addLog({ level: 'error', message: `Build refused: ${gate.reason}` })
          toast({
            title: 'Build refused',
            description: gate.reason,
            variant: 'fail',
          })
          setIsCompiling(false)
          return false
        }
        if (gate.warning !== undefined) addLog({ level: 'warning', message: gate.warning })
      }

      addLog({ level: 'info', message: 'Build process started' })

      const freshProjectData = store.getState().projectActions.getCompileReadyProjectData()

      const caps = resolveTargetCapabilities(currentBoardInfo)
      const doUpload = !isSimulatorBoard && !(overrides?.compileOnly ?? false)
      const isEthernetUpload = currentBoardInfo?.uploadMethod === 'ethernet'
      const willUpload = doUpload && caps.directUsbUpload && !isEthernetUpload
      let serialWasReleased = false
      if (willUpload && store.getState().deviceConnection.status === 'connected') {
        try {
          serialWasReleased = await device.releaseSerialPort(
            store.getState().deviceDefinitions.configuration.communicationPort ?? null,
          )
        } catch {
          // best-effort: never block a build on the handoff.
        }
      }

      const willEthUpload = doUpload && isEthernetUpload
      let ethWasConnected = false
      if (willEthUpload && store.getState().deviceConnection.status === 'connected') {
        ethWasConnected = true
        try {
          await device.disconnect()
        } catch {
          // best-effort: never block a build on the handoff.
        }
      }

      let succeeded = false
      try {
        let streamedError = false
        const result = await compiler.compileProgram(
          {
            projectData: freshProjectData,
            boardTarget: deviceDefinitions.configuration.deviceBoard,
            projectPath: projectMeta.path,
            compileOnly: overrides?.compileOnly ?? false,
            cleanBuild: overrides?.cleanBuild ?? false,
            isSimulator: isSimulatorBoard,
            runtimeIpAddress: deviceDefinitions.configuration.runtimeIpAddress || null,
            runtimeJwtToken: jwtToken || null,
            communicationPort: deviceDefinitions.configuration.communicationPort || undefined,
            vendorScreenData: deviceDefinitions.configuration.vendorScreenData,
          },
          (event) => {
            if (event.plcStatus) {
              store
                .getState()
                .deviceActions.setPlcRuntimeStatus(event.plcStatus as NonNullable<RuntimeConnection['plcStatus']>)
            }
            if (event.level === 'error' || event.stage === 'error') {
              streamedError = true
            }
            logCompilerEvent(event, addLog)
            if (event.firmwarePath && isSimulatorBoard) {
              const attachDebugger = pendingSimulatorDebugRef.current
              pendingSimulatorDebugRef.current = false
              void simulatorRun.launch(event.firmwarePath, { attachDebugger })
            }
          },
        )

        succeeded = result.success
        if (!result.success && !streamedError) {
          addLog({ level: 'error', message: result.error ?? 'Compilation failed' })
        }

        const licenseState = store.getState().deviceLicense.report?.outcome.state
        const lastCheckFoundNoLicense = licenseState === 'unlicensed' || licenseState === 'unsupported'
        if (doUpload && result.success && lastCheckFoundNoLicense) {
          for (const line of demoModeConsoleLines()) addLog({ level: 'warning', message: line })
        }

        if (willEthUpload && result.success) {
          const cfg = store.getState().deviceDefinitions.configuration
          const vsd = (cfg.vendorScreenData ?? {}) as {
            modbus_tcp?: { ip_address?: string }
            network?: { enable_dhcp?: boolean; ip_address?: string }
          }
          if (vsd.network?.enable_dhcp) {
            const entered = await showDeviceInput(
              store,
              'Device IP address',
              'This target uses DHCP, so its address is assigned by the network and the editor ' +
                'cannot know it. Enter the IP the device came up on to reconnect and for later uploads.',
              cfg.runtimeIpAddress ?? '',
            )
            const trimmed = entered?.trim()
            if (trimmed) {
              store.getState().deviceActions.setRuntimeIpAddress(trimmed, { sameDevice: true })
            }
          } else {
            const newIp = vsd.modbus_tcp?.ip_address || vsd.network?.ip_address
            if (newIp && newIp !== cfg.runtimeIpAddress) {
              store.getState().deviceActions.setRuntimeIpAddress(newIp, { sameDevice: true })
            }
          }
        }
        if (ethWasConnected && result.success) {
          await new Promise((resolve) => setTimeout(resolve, 6000))
        }
      } catch (err: unknown) {
        addLog({ level: 'error', message: `Build error: ${getErrorMessage(err)}` })
      } finally {
        if (serialWasReleased || ethWasConnected) {
          const boardTarget = deviceDefinitions.configuration.deviceBoard
          const spec = currentBoardInfo?.debug
          const candidates = resolveDeviceLinkCandidates(spec, buildDeviceResolverContext(store, boardTarget), {
            transports: caps.debuggerTransports,
            deferPrompts: true,
          })
          if (candidates.kind === 'candidates') {
            try {
              await device.connect(candidates.candidates.map((candidate) => candidate.config))
            } catch {
              // best-effort: the user can press Connect again.
            }
          }
        }
        setIsCompiling(false)
      }
      return succeeded
    },
    [
      compiler,
      projectMeta,
      deviceDefinitions,
      currentBoardInfo,
      isSimulatorBoard,
      simulatorRun,
      addLog,
      isCompiling,
      executeSave,
      refusedForVariablesText,
      canEdit,
      jwtToken,
      runtime,
      requestConsoleFollow,
      store,
    ],
  )

  const handleBuildRef = useRef(handleBuild)
  handleBuildRef.current = handleBuild

  useEffect(() => {
    return onDeviceFlashRequest(() => {
      void handleBuildRef.current()
    })
  }, [])

  const handleBuildLibrary = useCallback(async () => {
    if (isCompiling) return

    requestConsoleFollow()

    const saved = await executeSave()
    if (!saved) return

    if (refusedForVariablesText()) return

    if (!compiler.compileLibrary) {
      addLog({
        level: 'error',
        message: 'Current platform does not implement library builds.',
      })
      return
    }

    setIsCompiling(true)
    addLog({ level: 'info', message: 'Library build started' })

    try {
      const result = await compiler.compileLibrary({ projectData, projectPath: projectMeta.path }, (event) => {
        if (!event.message) return
        addLog({
          level: event.level === 'error' || event.stage === 'error' ? 'error' : 'info',
          message: event.message,
        })
      })
      if (!result.success) {
        addLog({
          level: 'error',
          message: result.error ?? 'Library build failed.',
        })
      }
    } catch (err) {
      addLog({
        level: 'error',
        message: `Library build error: ${getErrorMessage(err)}`,
      })
    } finally {
      setIsCompiling(false)
    }
  }, [
    compiler,
    projectData,
    projectMeta,
    addLog,
    isCompiling,
    canEdit,
    executeSave,
    refusedForVariablesText,
    requestConsoleFollow,
  ])

  const handleDebugLibrary = useCallback(async (): Promise<void> => {
    if (simulatorRunning) {
      await simulatorRun.stop()
      return
    }
    if (isCompiling) return

    requestConsoleFollow()

    if (canEdit) {
      const saved = await executeSave()
      if (!saved) return
    }

    if (refusedForVariablesText()) return

    const harness = composeLibraryDebugHarness(store.getState().project.data)

    for (const skip of harness.skipped) {
      addLog({ level: 'warning', message: `${skip.pouName}: ${skip.reason}` })
    }
    if (harness.blocks.length === 0) {
      addLog({
        level: 'error',
        message:
          'Nothing to debug: this library has no function blocks the simulator can run. ' +
          'Add a function block — to exercise a function, write one that calls it.',
      })
      return
    }

    setIsCompiling(true)
    addLog({
      level: 'info',
      message: `Debugging ${harness.blocks.length} block(s) on the simulator: ${harness.blocks
        .map((block) => block.pouName)
        .join(', ')}`,
    })

    store.getState().workspaceActions.setDebugHarness({
      programPou: harness.programPou,
      instances: harness.projectData.configurations.resource.instances,
    })

    try {
      let streamedError = false
      const result = await compiler.compileProgram(
        {
          projectData: harness.projectData,
          boardTarget: LIBRARY_DEBUG_BOARD,
          projectPath: projectMeta.path,
          compileOnly: false,
          isSimulator: true,
          runtimeIpAddress: null,
          runtimeJwtToken: null,
        },
        (event) => {
          if (event.level === 'error' || event.stage === 'error') streamedError = true
          logCompilerEvent(event, addLog)
          if (event.firmwarePath) {
            void simulatorRun.launch(event.firmwarePath, { attachDebugger: true }).then((launched) => {
              if (!launched) {
                store.getState().workspaceActions.setDebugHarness(null)
              }
            })
          }
        },
      )
      if (!result.success) {
        store.getState().workspaceActions.setDebugHarness(null)
        if (!streamedError) {
          addLog({ level: 'error', message: result.error ?? 'Harness compilation failed' })
        }
      }
    } catch (err: unknown) {
      store.getState().workspaceActions.setDebugHarness(null)
      addLog({ level: 'error', message: `Library debug error: ${getErrorMessage(err)}` })
    } finally {
      setIsCompiling(false)
    }
  }, [
    compiler,
    projectMeta,
    addLog,
    isCompiling,
    canEdit,
    executeSave,
    refusedForVariablesText,
    requestConsoleFollow,
    simulatorRun,
    simulatorRunning,
    store,
  ])

  const warnSwitchInStop = useCallback(
    async (deviceName: string, switchLabel?: string): Promise<void> => {
      await showDeviceDialog(
        store,
        'warning',
        'Device is in STOP',
        `The ${switchLabel ?? 'mode switch'} on ${deviceName} is in the STOP position. ` +
          'The PLC cannot be started from the editor while the switch is in STOP.\n\n' +
          'Flip the switch to RUN and try again.',
        ['OK'],
      )
    },
    [store],
  )

  const handlePlcControl = useCallback(async (): Promise<void> => {
    const boardTarget = deviceDefinitions.configuration.deviceBoard
    const boardInfo = availableBoards.get(boardTarget)
    const caps = resolveTargetCapabilities(boardInfo)
    if (!caps.plcStateControl) return

    const switchLabel = (boardInfo as { stateControl?: { modeSwitch?: { label?: string } } } | undefined)?.stateControl
      ?.modeSwitch?.label

    try {
      if (plcStatus === 'TRANSITIONING') return

      const wantRun = plcStatus !== 'RUNNING'

      if (wantRun && switchPosition === 'stop') {
        await warnSwitchInStop(boardTarget, switchLabel)
        return
      }

      const result = await debuggerPort.setPlcState?.(wantRun ? 'RUNNING' : 'STOPPED')
      if (!result) return

      if (result.unsupported) {
        addLog({
          level: 'info',
          message: 'This firmware predates run/stop control. Rebuild and upload the program to enable Start/Stop.',
        })
        return
      }
      if (result.refusedBySwitch) {
        await warnSwitchInStop(boardTarget, switchLabel)
        return
      }
      if (!result.success) {
        addLog({
          level: 'error',
          message: `Failed to ${wantRun ? 'start' : 'stop'} PLC: ${result.error ?? 'Unknown error'}`,
        })
        return
      }

      if (result.state !== undefined) {
        store
          .getState()
          .deviceActions.setPlcRuntimeStatus(
            (result.state === 1 ? 'RUNNING' : result.state === 2 ? 'ERROR' : 'STOPPED') as NonNullable<
              RuntimeConnection['plcStatus']
            >,
          )
      }
    } catch (error: unknown) {
      addLog({ level: 'error', message: `PLC control error: ${getErrorMessage(error)}` })
    }
  }, [
    deviceDefinitions.configuration.deviceBoard,
    availableBoards,
    plcStatus,
    switchPosition,
    debuggerPort,
    addLog,
    warnSwitchInStop,
    store,
  ])

  const handleSimulatorControl = useCallback(async (): Promise<void> => {
    if (simulatorRunning) {
      await simulatorRun.stop()
      return
    }
    pendingSimulatorDebugRef.current = true
    handleBuildRef.current().catch(() => {
      pendingSimulatorDebugRef.current = false
    })
  }, [simulatorRun, simulatorRunning])

  const handleMd5Verification = async (projectPath: string, boardTarget: string, isRuntimeTarget: boolean) => {
    const { consoleActions, runtimeConnection, deviceActions } = store.getState()

    try {
      if (isRuntimeTarget && runtimeConnection.plcStatus === 'STOPPED' && runtimeConnection.jwtToken) {
        const response = await showDeviceDialog(
          store,
          'question',
          'PLC Stopped',
          'The PLC is currently stopped. The debugger requires the PLC to be running. Would you like to start the PLC now?',
          ['Yes', 'No'],
        )
        if (response === 1) {
          consoleActions.addLog({ level: 'info', message: 'Debugger session cancelled.' })
          setIsDebuggerProcessing(false)
          return
        }

        consoleActions.addLog({ level: 'info', message: 'Starting PLC...' })
        const startResult = (await debuggerPort.setPlcState?.('RUNNING')) ?? {
          success: false,
          error: 'This target does not support run/stop control',
        }
        if (!startResult.success) {
          await showDeviceDialog(
            store,
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

      consoleActions.addLog({ level: 'info', message: 'Verifying program MD5...' })
      const md5Result = await debuggerPort.readProgramMd5(projectPath, boardTarget)
      if (!md5Result.success || !md5Result.md5) {
        await showDeviceDialog(store, 'error', 'MD5 Extraction Failed', md5Result.error ?? 'Could not extract MD5', [
          'OK',
        ])
        setIsDebuggerProcessing(false)
        return
      }

      const preConnectResult = await debuggerPort.connect()
      if (!preConnectResult.success) {
        await showDeviceDialog(
          store,
          'error',
          "Can't Start Debugger",
          `Can't start the debugger — ${preConnectResult.error ?? 'unknown error'}.`,
          ['OK'],
        )
        setIsDebuggerProcessing(false)
        return
      }

      const verifyResult = await debuggerPort.verifyMd5(md5Result.md5)
      if (!verifyResult.success) {
        await debuggerPort.disconnect()
        await showDeviceDialog(
          store,
          'error',
          'Connection Error',
          `Could not verify MD5: ${verifyResult.error ?? 'Unknown error'}`,
          ['OK'],
        )
        setIsDebuggerProcessing(false)
        return
      }

      if (verifyResult.match) {
        consoleActions.addLog({ level: 'info', message: 'MD5 verified. Starting debugger...' })
        store.getState().workspaceActions.setDebugTargetEndian(verifyResult.targetEndian ?? 'le')
        await debugSession.connectAndStart()
        setIsDebuggerProcessing(false)
      } else {
        await debuggerPort.disconnect()

        consoleActions.addLog({
          level: 'warning',
          message: `MD5 mismatch. Target: ${verifyResult.targetMd5}, Expected: ${md5Result.md5}`,
        })

        {
          const state = store.getState()
          const gate = evaluateVppBackplaneGate(
            vppGateStateFor({
              board: state.deviceAvailableOptions.availableBoards.get(boardTarget),
              boardName: boardTarget,
              target: state.runtimeConnection.selectedDevice,
              vplcProvidesVendorBoards: capabilities.hasOrchestratorDevices,
            }),
          )
          if (gate.kind === 'refuse') {
            consoleActions.addLog({ level: 'error', message: gate.reason })
            setIsDebuggerProcessing(false)
            return
          }
        }

        if (aiChangesUnreviewed(store)) {
          consoleActions.addLog({ level: 'error', message: AI_PENDING_CHANGES_REFUSAL })
          setIsDebuggerProcessing(false)
          return
        }

        const response = await showDeviceDialog(
          store,
          'warning',
          'Program Mismatch',
          'The program on the target does not match. Upload the current project?',
          ['Yes', 'No'],
        )
        if (response === 0) {
          if (aiChangesUnreviewed(store)) {
            consoleActions.addLog({ level: 'error', message: AI_PENDING_CHANGES_REFUSAL })
            setIsDebuggerProcessing(false)
            return
          }
          const uploaded = await handleBuildRef.current({ compileOnly: false })
          if (uploaded) {
            consoleActions.addLog({
              level: 'info',
              message: 'Upload completed. Re-verifying...',
            })
            await new Promise((resolve) => setTimeout(resolve, 2000))
            void handleMd5Verification(projectPath, boardTarget, isRuntimeTarget)
          } else {
            consoleActions.addLog({ level: 'error', message: 'Upload failed: the program was not uploaded.' })
            setIsDebuggerProcessing(false)
          }
        } else {
          setIsDebuggerProcessing(false)
        }
      }
    } catch (error: unknown) {
      await debuggerPort.disconnect()
      consoleActions.addLog({
        level: 'error',
        message: `MD5 verification error: ${getErrorMessage(error)}`,
      })
      setIsDebuggerProcessing(false)
    }
  }

  const handleDebuggerClick = useCallback(async () => {
    const { workspace, project, deviceDefinitions: devDefs, consoleActions } = store.getState()

    if (workspace.isDebuggerVisible) {
      debugSessionRidesDeviceRef.current = false
      await debugSession.stopSession()
      return
    }

    if (isDebuggerProcessing) return

    if (aiChangesUnreviewed(store)) {
      consoleActions.addLog({ level: 'error', message: AI_PENDING_CHANGES_REFUSAL })
      return
    }

    setIsDebuggerProcessing(true)

    try {
      if (canEdit) {
        const saved = await executeSave()
        if (!saved) {
          setIsDebuggerProcessing(false)
          return
        }
      }

      if (refusedForVariablesText()) {
        setIsDebuggerProcessing(false)
        return
      }

      let boardTarget = devDefs.configuration.deviceBoard
      const projectPath = project.meta.path
      let boardInfo = availableBoards.get(boardTarget)

      const isRuntime =
        isOpenPLCRuntimeTarget(boardInfo) || (capabilities.hasOrchestratorDevices && selectedDeviceName !== null)

      debugSessionRidesDeviceRef.current = !isRuntime

      const sessionStatus = store.getState().deviceConnection.status
      addLog({
        level: 'info',
        message: `[connection] debug session requested for ${boardTarget}; session is "${sessionStatus}"`,
      })

      if (sessionStatus !== 'connected') {
        if (!offerSimulatorStart && needsDeviceSelection) {
          await showDeviceDialog(
            store,
            'warning',
            'No Device Selected',
            'Select a device to connect to before starting the debugger. The debugger runs over the ' +
              'device connection, so there has to be a device for it to run over.',
            ['OK'],
          )
          setIsDebuggerProcessing(false)
          return
        }

        if (isRuntime && !devDefs.configuration.runtimeIpAddress && selectedDeviceName === null) {
          await showDeviceDialog(
            store,
            'warning',
            'No IP Address',
            "Set the runtime's IP address in the device configuration before starting the debugger.",
            ['OK'],
          )
          setIsDebuggerProcessing(false)
          return
        }

        const targetName =
          selectedDeviceName !== null
            ? `"${selectedDeviceName}"`
            : describeConnectTarget(store, boardTarget, boardInfo, isRuntime)
        const offer = await showDeviceDialog(
          store,
          'question',
          offerSimulatorStart ? 'Simulator Not Running' : 'Not Connected',
          offerSimulatorStart
            ? 'The debugger runs against the running simulator. Would you like to start the simulator now?'
            : isRuntime
              ? `The debugger runs over the runtime connection. Would you like to connect to ${targetName} now?`
              : `The debugger runs over the device connection. Would you like to connect to ${targetName} now?`,
          ['Yes', 'No'],
        )
        if (offer !== 0) {
          addLog({ level: 'info', message: 'Debugger session cancelled.' })
          setIsDebuggerProcessing(false)
          return
        }

        if (offerSimulatorStart) {
          setIsDebuggerProcessing(false)
          pendingSimulatorDebugRef.current = true
          void handleSimulatorControl()
          return
        }

        let outcome: DebugSessionOutcome = 'failed'
        if (isRuntime) {
          const connectOutcome = await runtimeConnect.connect()
          if (connectOutcome === 'provisioning-flow') {
            addLog({ level: 'info', message: provisioningMessage('debugger-request-ended', {}).body })
            setIsDebuggerProcessing(false)
            return
          }
          outcome = await awaitDebugSession(store, 'runtime')
        } else if (await deviceConnect.connect()) {
          outcome = await awaitDebugSession(store, 'device')
        }
        if (outcome !== 'connected') {
          if (outcome === 'cancelled') addLog({ level: 'info', message: 'Debugger session cancelled.' })
          if (outcome === 'timeout') {
            addLog({
              level: 'warning',
              message: `Debugger not started: the session did not open within ${SESSION_OPEN_TIMEOUT_MS / 1000} s.`,
            })
          }
          setIsDebuggerProcessing(false)
          return
        }
        boardTarget = store.getState().deviceDefinitions.configuration.deviceBoard
        boardInfo = store.getState().deviceAvailableOptions.availableBoards.get(boardTarget)
      }

      if (resolveTargetCapabilities(boardInfo).isInProcessSimulator) {
        setIsDebuggerProcessing(false)
        return
      }

      const freshProjectData = store.getState().projectActions.getCompileReadyProjectData()
      consoleActions.addLog({ level: 'info', message: 'Starting debug compilation...' })
      const debugCompileResult = await compiler.compileForDebug(
        { projectData: freshProjectData, boardTarget, projectPath },
        (event) => logCompilerEvent(event, consoleActions.addLog),
      )
      if (!debugCompileResult.success) {
        consoleActions.addLog({
          level: 'error',
          message: `Debug compilation failed: ${debugCompileResult.error ?? 'Unknown error'}`,
        })
        setIsDebuggerProcessing(false)
        return
      }

      void handleMd5Verification(projectPath, boardTarget, isRuntime)
    } catch (error: unknown) {
      consoleActions.addLog({
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
    canEdit,
    executeSave,
    refusedForVariablesText,
    addLog,
    currentBoardInfo,
    store,
  ])

  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Search'>
        <SearchButton />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Open/Close Toolbox'>
        <ZoomButton {...zoom} />
      </TooltipSidebarWrapperButton>
      {projectCaps.hasProgramBuild && (
        <>
          <BuildOptionsPopover
            disabled={isCompiling || isSimulatorBoard}
            triggerTooltip={
              isSimulatorBoard ? 'Use Start to build and run' : isCompiling ? 'Compiling…' : 'Build options'
            }
            uploadAvailable={(() => {
              const caps = resolveTargetCapabilities(currentBoardInfo)
              if (caps.directUsbUpload) return true
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
                : plcControlBlocked
                  ? plcControlBlockedReason
                  : plcStatus === 'RUNNING'
                    ? 'Stop PLC'
                    : 'Start PLC'
            }
          >
            <PlayButton
              onClick={isSimulatorBoard ? () => void handleSimulatorControl() : () => void handlePlcControl()}
              disabled={isSimulatorBoard ? isCompiling || isDebuggerProcessing : plcControlBlocked}
              className={cn(
                isSimulatorBoard
                  ? isCompiling || isDebuggerProcessing
                    ? disabledButtonClass
                    : ''
                  : plcControlBlocked
                    ? disabledButtonClass
                    : '',
              )}
            >
              {(isSimulatorBoard ? simulatorRunning : plcStatus === 'RUNNING') ? <StopIcon /> : null}
            </PlayButton>
          </TooltipSidebarWrapperButton>
          <TooltipSidebarWrapperButton tooltipContent='Debugger'>
            <DebuggerButton
              onClick={() => void handleDebuggerClick()}
              disabled={isDebuggerProcessing}
              isActive={isDebuggerVisible}
              className={cn(isDebuggerProcessing && disabledButtonClass)}
            />
          </TooltipSidebarWrapperButton>
        </>
      )}
      {projectCaps.hasLibraryBuild && (
        <TooltipSidebarWrapperButton tooltipContent={isCompiling ? 'Building library…' : 'Build Library'}>
          <BuildLibraryButton
            onClick={() => void handleBuildLibrary()}
            disabled={isCompiling}
            className={cn(isCompiling && disabledButtonClass)}
          />
        </TooltipSidebarWrapperButton>
      )}
      {projectCaps.hasLibraryDebug && (
        <TooltipSidebarWrapperButton
          tooltipContent={
            simulatorRunning ? 'Stop Debugging' : isCompiling ? 'Building harness…' : 'Debug Library on Simulator'
          }
        >
          <DebuggerButton
            onClick={() => void handleDebugLibrary()}
            disabled={isCompiling}
            isActive={isDebuggerVisible}
            className={cn(isCompiling && disabledButtonClass)}
          />
        </TooltipSidebarWrapperButton>
      )}
      <TooltipSidebarWrapperButton tooltipContent='AI Chat'>
        <ChatButton />
      </TooltipSidebarWrapperButton>
    </>
  )
}
