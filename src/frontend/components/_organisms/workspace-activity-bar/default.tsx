import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type DebugResolverContext,
  type DebugSpec,
  resolveDebugConnection,
} from '../../../../backend/shared/hardware/debug-spec'
import type { DebugConnectionConfig } from '../../../../middleware/shared/ports/types'
import { projectCapabilities } from '../../../../middleware/shared/ports/types'
import {
  useCapabilities,
  useCompiler,
  useDebugger,
  useProject,
  useRuntime,
  useSimulator,
} from '../../../../middleware/shared/providers'
import { StopIcon } from '../../../assets/icons/interface/Stop'
import { useDebugPolling } from '../../../hooks/useDebugPolling'
import { useDebugSession } from '../../../hooks/useDebugSession'
import { executeSaveProject } from '../../../services/save-actions'
import { useOpenPLCStore } from '../../../store'
import type { RuntimeConnection } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'
import { logCompilerEvent } from '../../../utils/debugger-session'
import { getErrorMessage } from '../../../utils/get-error-message'
import { type BuildOption, BuildOptionsPopover } from '../../_features/[workspace]/build-options'
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
  options?: { primaryButtonIndex?: number; dismissButtonIndex?: number },
): Promise<number> => {
  return new Promise((resolve) => {
    useOpenPLCStore.getState().modalActions.openModal('debugger-message', {
      type,
      title,
      message,
      buttons,
      ...options,
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
    consoleActions: { addLog, requestConsoleFollow },
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
  const capabilities = useCapabilities()
  const debugSession = useDebugSession()
  useDebugPolling({ debugTreesRef: debugSession.debugTreesRef })

  const [isCompiling, setIsCompiling] = useState(false)
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)
  const [simulatorRunning, setSimulatorRunning] = useState(false)
  const pendingSimulatorDebugRef = useRef(false)

  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)
  const canEdit = useOpenPLCStore((state) => state.workspace.canEdit)

  const currentBoardInfo = availableBoards.get(deviceDefinitions.configuration.deviceBoard)
  const isSimulatorBoard = resolveTargetCapabilities(currentBoardInfo).isInProcessSimulator

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
    const result = await executeSaveProject(projectPort, capabilities)
    return result.success
  }, [projectPort])

  // ---------------------------------------------------------------------------
  // Build (Compile)
  // ---------------------------------------------------------------------------

  const handleBuild = useCallback(
    async (overrides?: { compileOnly?: boolean; cleanBuild?: boolean }) => {
      if (isCompiling) return

      // Reveal the console and re-attach it to the tail so build output is
      // visible from the first line, even if the console was collapsed or the
      // user had scrolled up. One-shot — it won't fight a later manual scroll.
      requestConsoleFollow()

      // Always save the full project before building. The compile
      // pipeline reads source from disk (project.json, devices/*.json,
      // pous/**, ...) so any in-memory edit that hasn't been flushed
      // yet compiles from the previous session's bytes.
      //
      // We used to gate this on `editingState === 'unsaved'`, but that
      // flag was effect-driven and lagged behind store mutations by a
      // render (a quick "change a vendor-screen field → click Build"
      // could miss the save). Each editor's dirty-tracking is also
      // independent — Monaco buffers, vendor screens, the manifest,
      // ladder/FBD nodes — so a workspace-level boolean was always a
      // lossy summary. `executeSaveProject` is the same call the
      // library-build path makes for the same reason: walks every
      // project file and flushes the in-memory state to disk. Cost is
      // a few JSON.stringify + file writes; save is idempotent when
      // nothing changed.
      //
      // Viewers without write permission (public projects they don't
      // own) can compile their in-memory edits but can't push them
      // back; skip the pre-build save for them so the doomed backend
      // write never gates the build.
      if (canEdit) {
        const saved = await executeSave()
        if (!saved) return
      }

      setIsCompiling(true)

      // Targets that build through the device runtime (everything except the
      // arduino-cli / in-process-simulator pipelines, i.e. directUsbUpload)
      // run the FINAL build step ON the device. If the runtime is actively
      // scanning a program, that heavy on-device work can stall the build or
      // make the running program miss scan cycles / deadlines. So when we're
      // connected to a RUNNING runtime, require the user to stop the PLC first
      // and, on their consent, stop it before compiling.
      {
        const state = useOpenPLCStore.getState()
        const boardInfo = state.deviceAvailableOptions.availableBoards.get(
          state.deviceDefinitions.configuration.deviceBoard,
        )
        const requiresRuntimeConnection = !resolveTargetCapabilities(boardInfo).directUsbUpload
        const { connectionStatus: connStatus, plcStatus: runStatus } = state.runtimeConnection
        if (requiresRuntimeConnection && connStatus === 'connected' && runStatus === 'RUNNING') {
          const response = await showDebuggerMessage(
            'warning',
            'Stop PLC',
            'The PLC must be stopped before continuing.',
            ['Cancel', 'Stop PLC and Continue'],
            // Cancel is first (left, neutral); proceed is the blue primary on
            // the right; Escape / click-away routes to Cancel.
            { primaryButtonIndex: 1, dismissButtonIndex: 0 },
          )
          if (response !== 1) {
            // User declined — abort the build and leave the PLC running.
            setIsCompiling(false)
            return
          }
          const stopResult = await runtime.stopPlc()
          if (!stopResult.success) {
            addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Failed to stop PLC: ${stopResult.error ?? 'Unknown error'}`,
            })
            setIsCompiling(false)
            return
          }
          useOpenPLCStore.getState().deviceActions.setPlcRuntimeStatus('STOPPED')
          addLog({ id: crypto.randomUUID(), level: 'info', message: 'PLC stopped before build.' })
        }
      }

      addLog({ id: crypto.randomUUID(), level: 'info', message: 'Build process started' })

      // Compile-time alias resolution: snapshot the project with every
      // variable's `location` resolved to a concrete IEC address (alias name
      // → current address, literal → verbatim, missing → unlocated). The
      // compile pipeline reads `variable.location` verbatim — it never sees
      // aliases.
      const freshProjectData = useOpenPLCStore.getState().projectActions.getCompileReadyProjectData()

      try {
        // Track whether the compile stream already surfaced an error so we
        // don't log a second, generic "Compilation failed" after a failed
        // build (the stream already reported the real error).
        let streamedError = false
        const result = await compiler.compileProgram(
          {
            projectData: freshProjectData,
            boardTarget: deviceDefinitions.configuration.deviceBoard,
            projectPath: projectMeta.path,
            // `compileOnly` is dictated entirely by the sidebar build
            // menu (Build / Build & Upload / Clean Build & Upload).
            // Default to `false` so the few callers that invoke
            // `handleBuild()` with no overrides also get an upload.
            compileOnly: overrides?.compileOnly ?? false,
            cleanBuild: overrides?.cleanBuild ?? false,
            isSimulator: isSimulatorBoard,
            runtimeIpAddress: deviceDefinitions.configuration.runtimeIpAddress || null,
            runtimeJwtToken: jwtToken || null,
            // Live serial-port picker value from the device store.
            // Threaded through so arduino-cli upload uses the
            // picker's current selection even when the user hasn't
            // saved the project yet (the legacy disk-read path lags
            // the live store by one save cycle).
            communicationPort: deviceDefinitions.configuration.communicationPort || undefined,
            // User-authored configuration-screen data — the shared
            // compile pipeline emits `vpp_config.h` from this for
            // arduino-cli VPP boards (Arduino Opta, P1AM).  Same
            // store path on editor + web, single source of truth.
            vendorScreenData: deviceDefinitions.configuration.vendorScreenData,
          },
          (event) => {
            if (event.plcStatus) {
              useOpenPLCStore
                .getState()
                .deviceActions.setPlcRuntimeStatus(event.plcStatus as NonNullable<RuntimeConnection['plcStatus']>)
            }
            if (event.level === 'error' || event.stage === 'error') {
              streamedError = true
            }
            logCompilerEvent(event, addLog)
            if (event.firmwarePath && isSimulatorBoard) {
              void simulator.loadFirmware(event.firmwarePath).then((loadResult) => {
                if (loadResult.success) {
                  setSimulatorRunning(true)
                  addLog({ id: crypto.randomUUID(), level: 'info', message: 'Simulator is running.' })
                  if (pendingSimulatorDebugRef.current) {
                    pendingSimulatorDebugRef.current = false
                    // Simulator's debug spec resolves to the trivial
                    // `{ connectionType: 'simulator' }` config — see
                    // the hals.json entry.  Pass it explicitly so the
                    // session's downstream MD5-verification path has
                    // the right transport instead of falling back to
                    // `connectAndStart`'s internal default.
                    void debugSession.connectAndStart({ connectionType: 'simulator', connectionParams: {} })
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

        if (!result.success && !streamedError) {
          addLog({ id: crypto.randomUUID(), level: 'error', message: result.error ?? 'Compilation failed' })
        }
      } catch (err: unknown) {
        addLog({ id: crypto.randomUUID(), level: 'error', message: `Build error: ${getErrorMessage(err)}` })
      } finally {
        setIsCompiling(false)
      }
    },
    [
      compiler,
      projectData,
      projectMeta,
      deviceDefinitions,
      isSimulatorBoard,
      simulator,
      debugSession,
      addLog,
      isCompiling,
      executeSave,
      canEdit,
      jwtToken,
      runtime,
      requestConsoleFollow,
    ],
  )

  const handleBuildRef = useRef(handleBuild)
  handleBuildRef.current = handleBuild

  // ---------------------------------------------------------------------------
  // Build Library (.stlib)
  // ---------------------------------------------------------------------------

  const handleBuildLibrary = useCallback(
    async (overrides?: { cleanBuild?: boolean }) => {
      if (isCompiling) return

      // Reveal the console and re-attach to the tail (see handleBuild).
      requestConsoleFollow()

      // Always save before building.  The manifest tab and any POU
      // bodies may have edits the workspace-level `editingState`
      // doesn't track (each editor manages its own dirty flag against
      // its file-slice entry), and the build pipeline reads everything
      // off disk — `library.json`, `pous/**`, and the rest — so a
      // stale on-disk copy would compile from the previous session's
      // content.  `executeSaveProject` is the same full-project save
      // the PLC build invokes; it walks every file the project owns
      // and flushes the in-memory buffer to disk before the build
      // starts.
      const saved = await executeSave()
      if (!saved) return

      if (!compiler.compileLibrary) {
        addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: 'Current platform does not implement library builds.',
        })
        return
      }

      setIsCompiling(true)
      addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: overrides?.cleanBuild ? 'Library build started (clean)' : 'Library build started',
      })

      try {
        const result = await compiler.compileLibrary(
          { projectData, projectPath: projectMeta.path, cleanBuild: overrides?.cleanBuild ?? false },
          (event) => {
            if (!event.message) return
            addLog({
              id: crypto.randomUUID(),
              level: event.level === 'error' || event.stage === 'error' ? 'error' : 'info',
              message: event.message,
            })
          },
        )
        if (!result.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: result.error ?? 'Library build failed.',
          })
        } else if (result.verification && !result.verification.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'warning',
            message: `Library built, but verification reported: ${result.verification.message ?? 'unknown'}`,
          })
        }
      } catch (err) {
        addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Library build error: ${getErrorMessage(err)}`,
        })
      } finally {
        setIsCompiling(false)
      }
    },
    [compiler, projectData, projectMeta, addLog, isCompiling, executeSave, requestConsoleFollow],
  )

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
        useOpenPLCStore.getState().workspaceActions.setDebugTargetEndian(verifyResult.targetEndian ?? 'le')
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
          // See the handleBuild call above — compile-time alias resolution.
          const freshProjectData = useOpenPLCStore.getState().projectActions.getCompileReadyProjectData()
          const compileResult = await compiler.compileProgram(
            {
              projectData: freshProjectData,
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
  // Debug-spec resolver — surface picker / prompt / error dialogs and
  // return a connection-ready DebugConnectionConfig, or null if the
  // user cancelled or no config could be resolved.
  // ---------------------------------------------------------------------------

  // Renderer-local prompt cache for the DHCP-IP-style flows.  Keyed
  // by `<packageId>|<deviceId>|<cacheKey>` (or `builtin|<board>|<cacheKey>`
  // for hals.json entries) so two boards sharing a `cacheKey` value
  // don't see each other's last-entered IP.  Lives on a ref so it
  // survives across re-renders without triggering them.
  const promptCacheRef = useRef<Record<string, Record<string, string>>>({})

  const resolveDebugConfigWithUx = useCallback(
    async (boardTarget: string, spec: DebugSpec | undefined): Promise<DebugConnectionConfig | null> => {
      if (!spec) {
        await showDebuggerMessage(
          'warning',
          'Debugging Not Available',
          "This board hasn't declared a debug spec.  The VPP package (or hals.json entry) must provide a `debug` block.",
          ['OK'],
        )
        return null
      }

      // Build resolver context from current store state on each call —
      // captures the user's freshest screen edits without forcing the
      // user to save first.
      const buildContext = (): DebugResolverContext => {
        const store = useOpenPLCStore.getState()
        const cfg = store.deviceDefinitions.configuration
        const rtConn = store.runtimeConnection
        // `vendorScreenData` is already keyed by section ID (e.g.
        // `modbus_rtu`); resolver state's `screens` shape matches
        // 1:1 so we pass it straight through.
        const screens = (cfg.vendorScreenData ?? {}) as Record<string, Record<string, unknown>>
        const cacheBucketKey = `${cfg.deviceBoard}`
        const promptCache = promptCacheRef.current[cacheBucketKey] ?? {}
        return {
          state: {
            configuration: {
              deviceBoard: cfg.deviceBoard,
              ...(cfg.communicationPort ? { communicationPort: cfg.communicationPort } : {}),
              ...(cfg.runtimeIpAddress ? { runtimeIpAddress: cfg.runtimeIpAddress } : {}),
            },
            screens,
            runtimeConnection: {
              ...(rtConn.connectionStatus ? { connectionStatus: rtConn.connectionStatus } : {}),
              ...(rtConn.jwtToken ? { jwtToken: rtConn.jwtToken } : {}),
            },
            promptCache,
          },
          capabilities: {
            runtimeConnected: runtime.isReadyForDebug?.() === true && rtConn.connectionStatus === 'connected',
            jwtToken: Boolean(rtConn.jwtToken),
          },
        }
      }

      let selectedChannelIndex: number | undefined
      // Loop: pickers/prompts re-invoke the resolver with extra state
      // until it returns config or error/unsupported/cancelled.
      // Capped at 8 iterations as a defensive guard against spec
      // bugs that could otherwise loop forever.
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const outcome = resolveDebugConnection(spec, buildContext(), selectedChannelIndex)
        if (outcome.kind === 'config') {
          return outcome.config
        }
        if (outcome.kind === 'error') {
          await showDebuggerMessage('warning', outcome.title, outcome.body, ['OK'])
          return null
        }
        if (outcome.kind === 'unsupported') {
          // Defensive — buildContext already errored at top-level on
          // missing spec, so we shouldn't reach here normally.
          return null
        }
        if (outcome.kind === 'pick') {
          const buttons = outcome.channels.map((c) => c.label)
          const choice = await showDebuggerMessage('question', outcome.title, outcome.body, buttons)
          if (choice < 0 || choice >= outcome.channels.length) return null
          selectedChannelIndex = outcome.channels[choice].index
          continue
        }
        if (outcome.kind === 'prompt') {
          const bucketKey = boardTarget
          const bucket = (promptCacheRef.current[bucketKey] ??= {})
          for (const field of outcome.fields) {
            const previous = field.cacheKey ? bucket[field.cacheKey] : undefined
            const result = await showDebuggerIpInput(field.title, field.message, previous ?? field.defaultValue ?? '')
            if (result === null) return null
            const trimmed = result.trim()
            if (!trimmed) return null
            if (field.cacheKey) bucket[field.cacheKey] = trimmed
          }
          selectedChannelIndex = outcome.channelIndex
          continue
        }
      }
      return null
    },
    [runtime],
  )

  // ---------------------------------------------------------------------------
  // Debugger click — full orchestration for non-simulator targets
  // ---------------------------------------------------------------------------

  const handleDebuggerClick = useCallback(async () => {
    // Simulator targets debug through the Start Simulator button
    // (compile + load firmware + connect), so the Debugger button
    // is hidden for them at the JSX level — but guard here too in
    // case the gate ever flips.
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
      // Mirror the build flow: always save before starting the
      // debugger so the on-disk project matches what the user sees
      // on screen. Avoids the race where an editor change hadn't
      // bubbled up to `editingState === 'unsaved'` yet. Viewers
      // without write permission skip the save (same rationale as
      // the build path — backend write would fail).
      if (canEdit) {
        const saved = await executeSave()
        if (!saved) {
          setIsDebuggerProcessing(false)
          return
        }
      }

      const boardTarget = devDefs.configuration.deviceBoard
      const projectPath = project.meta.path
      const boardInfo = availableBoards.get(boardTarget)

      const debugConfig = await resolveDebugConfigWithUx(boardTarget, boardInfo?.debug)
      if (!debugConfig) {
        setIsDebuggerProcessing(false)
        return
      }

      // Debug compilation. Resolve alias-bound locations to concrete
      // addresses first (same pre-compile snapshot the build/upload paths
      // use) — the compiler only understands `%…` literals, not alias names.
      const freshProjectData = useOpenPLCStore.getState().projectActions.getCompileReadyProjectData()
      consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Starting debug compilation...' })
      const debugCompileResult = await compiler.compileForDebug(
        { projectData: freshProjectData, boardTarget, projectPath },
        (event) => logCompilerEvent(event, consoleActions.addLog),
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

      // `isRuntimeTarget` here only gates the "PLC stopped, start it?"
      // dialog inside MD5 verification.  Tied to whether the active
      // channel needs the runtime alive — websocket/tcp targets do,
      // rtu/simulator targets don't.
      const isRuntimeTarget = debugConfig.connectionType === 'websocket' || debugConfig.connectionType === 'tcp'
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
    canEdit,
    executeSave,
    addLog,
    resolveDebugConfigWithUx,
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
            // Direct-USB targets (every arduino-cli board, simulator)
            // always allow upload — arduino-cli connects via USB at
            // upload time, no prior network handshake needed.  Runtime
            // v3/v4 targets must be connected first since the upload
            // goes over the network to the on-device webserver.
            //
            // Capability-driven (`directUsbUpload`) rather than
            // `isArduinoTarget`, because VPP-IO boards (Opta) flip
            // `pinMapping: false` and the legacy
            // `isArduinoTarget` helper keys off `pinMapping`.  Those
            // boards still upload over USB via arduino-cli, so the
            // gate needs the more direct flag.
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
          Two options surface via the `libraryMode` popover:
            - "Build"       → fast build (verification short-
              circuited by MD5 cache hit, when warm).
            - "Clean build" → skip verification cache and force a
              fresh avr-gcc verify against the simulator target. */}
      {projectCaps.hasLibraryBuild && (
        // No outer `TooltipSidebarWrapperButton`: `BuildOptionsPopover`
        // already renders its own Radix tooltip via `triggerTooltip`,
        // and the wrapper's tooltip persisted on top of the popover
        // contents once the menu opened (PLC build button doesn't wrap
        // either — same idiom here for consistency).
        <BuildOptionsPopover
          disabled={isCompiling}
          triggerTooltip={isCompiling ? 'Building library…' : 'Build Library'}
          libraryMode={true}
          uploadAvailable={false}
          uploadDisabledReason='library builds do not upload'
          onSelect={(option: BuildOption) => {
            switch (option) {
              case 'build-only':
                void handleBuildLibrary({ cleanBuild: false })
                break
              case 'clean-upload':
                void handleBuildLibrary({ cleanBuild: true })
                break
            }
          }}
        />
      )}
      <TooltipSidebarWrapperButton tooltipContent='AI Chat'>
        <ChatButton />
      </TooltipSidebarWrapperButton>
    </>
  )
}
