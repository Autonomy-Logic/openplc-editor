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
import { useDebugPolling } from '../../../hooks/useDebugPolling'
import { useDebugSession } from '../../../hooks/useDebugSession'
import { buildDeviceResolverContext, showDeviceDialog } from '../../../services/device-link-resolution'
import { executeSaveProject } from '../../../services/save-actions'
import { useOpenPLCStore } from '../../../store'
import type { RuntimeConnection } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'
import { logCompilerEvent } from '../../../utils/debugger-session'
import { isOpenPLCRuntimeTarget } from '../../../utils/device'
import { onDeviceFlashRequest } from '../../../utils/device-connect-events'
import { getErrorMessage } from '../../../utils/get-error-message'
import { type BuildOption, BuildOptionsPopover } from '../../_features/[workspace]/build-options'
import { ChatButton } from '../../_molecules/workspace-activity-bar/default/chat'
import { DebuggerButton } from '../../_molecules/workspace-activity-bar/default/debugger'
import { PlayButton } from '../../_molecules/workspace-activity-bar/default/play'
import { SearchButton } from '../../_molecules/workspace-activity-bar/default/search'
import { ZoomButton } from '../../_molecules/workspace-activity-bar/default/zoom'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

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
  const device = useDevice()
  const projectPort = useProject()
  const capabilities = useCapabilities()
  const debugSession = useDebugSession()
  useDebugPolling({ debugTreesRef: debugSession.debugTreesRef })

  const [isCompiling, setIsCompiling] = useState(false)
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)
  const [simulatorRunning, setSimulatorRunning] = useState(false)
  const pendingSimulatorDebugRef = useRef(false)
  // True while a debug session is running OVER THE DEVICE CONNECTION (a baremetal
  // target, whatever transport that connection uses). Such a session shares the
  // connection, so it has to end when the connection does — which the drop handler
  // below acts on. A runtime or simulator session owns its own channel and is
  // unaffected, so this stays false for them.
  const debugSessionRidesDeviceRef = useRef(false)

  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const switchPosition = useOpenPLCStore((state) => state.runtimeConnection.switchPosition)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)
  const canEdit = useOpenPLCStore((state) => state.workspace.canEdit)

  const currentBoardInfo = availableBoards.get(deviceDefinitions.configuration.deviceBoard)
  const isSimulatorBoard = resolveTargetCapabilities(currentBoardInfo).isInProcessSimulator

  const deviceConnectionStatus = useOpenPLCStore((state) => state.deviceConnection.status)

  // Run/stop travels over the session's control channel, so the button is live
  // exactly when a SESSION exists — one question, asked once, for every target type.
  // Every session publishes its status: a device connection, a runtime login, a
  // running simulator. Asking the target's kind first (`directUsbUpload ? … : …`)
  // meant asking "did the user log in" for a runtime, which is not the same question
  // and diverged in practice: logged in, session never opened, every command
  // refused. "Can a payload be delivered?" is what the button actually needs.
  //
  // Deliberately NOT applied to Build & Upload. Uploading is how a blank board stops
  // being blank, so it cannot require a connection — see `handleBuild`, where the
  // connection is consulted only to hand the serial port over to arduino-cli.
  //
  // A target that does not implement run/stop at all is blocked for a DIFFERENT
  // reason, and says so. `handlePlcControl` refuses such a target anyway, so
  // without this the button looked live and the click did nothing at all — no
  // command, no error, no log line.
  //
  // A transition already in flight blocks it for a third reason. TRANSITIONING
  // means the runtime has a start or stop underway: it answers COMMAND:BUSY to
  // everything except PING and STATUS, and the state it will settle on is not
  // decided yet, so the icon is drawn from a state that is about to change.
  // Clicking then cannot do what it appears to.
  //
  // The reason chain runs in the same order as the blocks it explains, most
  // fundamental first: a target that cannot do run/stop at all, then no session
  // to send over, then a transition in flight. Asking about the transition first
  // would answer "PLC is changing state..." to someone who is not connected,
  // reporting a state we last saw rather than the reason the button is inert —
  // `plcStatus` is polled and survives the drop. Reached only when blocked, so
  // the tail needs no test of its own: supported and connected and still blocked
  // leaves exactly one reason.
  const plcStateControlSupported = resolveTargetCapabilities(currentBoardInfo).plcStateControl
  const plcTransitioning = plcStatus === 'TRANSITIONING'
  const plcControlBlocked = !plcStateControlSupported || deviceConnectionStatus !== 'connected' || plcTransitioning
  const plcControlBlockedReason = !plcStateControlSupported
    ? 'This target does not support Start/Stop from the editor'
    : deviceConnectionStatus !== 'connected'
      ? 'Connect to the target first'
      : 'PLC is changing state...'

  // The emulator stopping is a session ending, and a debug session riding it ends
  // with it — which the drop handler below already does for every target. This
  // only mirrors the emulator's own state into the button.
  useEffect(() => {
    const unsub = simulator.onStopped(() => {
      pendingSimulatorDebugRef.current = false
      setSimulatorRunning(false)
    })
    return unsub
  }, [simulator])

  // A serial debug session lives on the device connection: it shares that
  // client, so when the link drops (unplug, reset, liveness failure, or the user
  // pressing Disconnect) the session has no transport left and must end. Leaving
  // it "active" would show a frozen variable table over a dead port and leave the
  // debugger unable to reconnect.
  //
  // Modbus TCP sessions are deliberately untouched — they own their own socket
  // and never depended on the serial link.
  // Only 'connected' is tolerated. 'connecting' covers RECOVERY too (the
  // connection died and the main process is reopening it), and by then the client
  // the session was sharing is already closed — waiting for the recovery verdict
  // would just keep a dead session on screen for the whole retry window. A session
  // can only have started from 'connected', so the initial connect's 'connecting'
  // never reaches this: no session is active to stop.
  useEffect(() => {
    if (deviceConnectionStatus === 'connected') return
    if (!debugSessionRidesDeviceRef.current) return
    if (!useOpenPLCStore.getState().workspace.isDebuggerVisible) return

    addLog({
      id: crypto.randomUUID(),
      level: 'warning',
      message: 'Device disconnected — stopping the debug session (serial debugging runs over the device connection).',
    })
    debugSessionRidesDeviceRef.current = false
    void debugSession.stopSession()
  }, [deviceConnectionStatus, debugSession, addLog])

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
          const response = await showDeviceDialog(
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
          // Same unified control path as the Start/Stop button: the session routes
          // it, so this works for a runtime and a device alike.
          const stopResult = (await debuggerPort.setPlcState?.('STOPPED')) ?? {
            success: false,
            error: 'This target does not support run/stop control',
          }
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

      // Serial handoff (D72): a held device connection owns the serial port that
      // arduino-cli needs for a direct-USB upload. Release it before the build so
      // the upload can take the port; reconnect afterwards (auto-reconnect).
      const caps = resolveTargetCapabilities(currentBoardInfo)
      const willUpload = !isSimulatorBoard && !(overrides?.compileOnly ?? false) && caps.directUsbUpload
      // Release ONLY if the held connection is the serial one arduino-cli needs.
      // A connection over Modbus TCP is untouched, so debugging and run/stop keep
      // working across the upload; disconnecting unconditionally used to throw it
      // away. `released` also tells us whether to reconnect afterwards.
      let serialWasReleased = false
      if (willUpload && useOpenPLCStore.getState().deviceConnection.status === 'connected') {
        try {
          serialWasReleased = await device.releaseSerialPort(
            useOpenPLCStore.getState().deviceDefinitions.configuration.communicationPort ?? null,
          )
        } catch {
          // best-effort: never block a build on the handoff.
        }
      }

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
                    // Rides the emulator's session, so it ends when the emulator
                    // does — through the same handler a pulled cable goes through.
                    debugSessionRidesDeviceRef.current = true
                    // No config: starting the emulator opened its session, so the
                    // connection manager already knows how to reach it.
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

        if (!result.success && !streamedError) {
          addLog({ id: crypto.randomUUID(), level: 'error', message: result.error ?? 'Compilation failed' })
        }

        // Serial handoff (D72): if we released a held device connection for this
        // upload, reconnect it now that arduino-cli is done with the port.
        // Silent (no dialogs) — the user just flashed on purpose.
        if (serialWasReleased && result.success) {
          const boardTarget = deviceDefinitions.configuration.deviceBoard
          const spec = currentBoardInfo?.debug
          // Same candidate resolution Connect uses, so the link comes back the way
          // the user established it. Only the serial link is ever released for an
          // upload, but resolving the full list lets the reconnect land on Modbus
          // TCP if that is what now answers.
          // `deferPrompts`: this reconnect is silent and automatic (the user just
          // flashed), so it must never pop an address dialog behind their back. A
          // DHCP-only target simply stays disconnected until they press Connect.
          const candidates = resolveDeviceLinkCandidates(spec, buildDeviceResolverContext(boardTarget), {
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
      } catch (err: unknown) {
        addLog({ id: crypto.randomUUID(), level: 'error', message: `Build error: ${getErrorMessage(err)}` })
      } finally {
        setIsCompiling(false)
      }
    },
    [
      compiler,
      projectMeta,
      deviceDefinitions,
      currentBoardInfo,
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

  // CONNECT flow (D72): the device screen's "No Firmware Detected" dialog lives
  // in board.tsx but Build & Upload lives here. When the user chooses to flash,
  // that dialog fires a decoupled event we answer by running the same build.
  useEffect(() => {
    return onDeviceFlashRequest(() => {
      void handleBuildRef.current()
    })
  }, [])

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

  /**
   * Tell the user the hardware mode switch is holding the device in STOP.
   *
   * Shown both when the editor blocks a start locally (pre-check) and when the
   * device refuses one, so the two paths read identically. `switchLabel` comes
   * from the VPP manifest's optional `stateControl.modeSwitch.label` when the
   * package provides it, so a P1AM says "CPU switch" rather than the generic
   * wording.
   */
  const warnSwitchInStop = useCallback(async (deviceName: string, switchLabel?: string): Promise<void> => {
    await showDeviceDialog(
      'warning',
      'Device is in STOP',
      `The ${switchLabel ?? 'mode switch'} on ${deviceName} is in the STOP position. ` +
        'The PLC cannot be started from the editor while the switch is in STOP.\n\n' +
        'Flip the switch to RUN and try again.',
      ['OK'],
    )
  }, [])

  const handlePlcControl = useCallback(async (): Promise<void> => {
    const boardTarget = deviceDefinitions.configuration.deviceBoard
    const boardInfo = availableBoards.get(boardTarget)
    const caps = resolveTargetCapabilities(boardInfo)
    if (!caps.plcStateControl) return

    const switchLabel = (boardInfo as { stateControl?: { modeSwitch?: { label?: string } } } | undefined)?.stateControl
      ?.modeSwitch?.label

    // ONE path for every target. "Start the PLC" is the same request whether it
    // travels as Modbus FC 0x4b down a cable or as an HTTP POST to a runtime; the
    // connection manager routes it over whatever the session's control channel is.
    // Branching here on target type is what kept two copies of the switch
    // pre-check, the refusal handling and the error reporting in step by hand.
    //
    // Reads are NOT done here: the session's status poll keeps `plcStatus` and
    // `switchPosition` in the store, so the pre-check is a store lookup rather than
    // another round trip over a medium the poll is already using.
    try {
      // The button is disabled while a transition is in flight; this covers the
      // window before the next status poll catches up, and any caller that is not
      // the click.
      if (plcStatus === 'TRANSITIONING') return

      const wantRun = plcStatus !== 'RUNNING'

      // Never send a start to a device whose switch reads STOP. `null` means
      // "unknown / no switch", which must NOT block: a board with no physical
      // switch, or firmware predating the state machine, would otherwise be
      // un-startable.
      if (wantRun && switchPosition === 'stop') {
        await warnSwitchInStop(boardTarget, switchLabel)
        return
      }

      const result = await debuggerPort.setPlcState?.(wantRun ? 'RUNNING' : 'STOPPED')
      if (!result) return

      if (result.unsupported) {
        addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: 'This firmware predates run/stop control. Rebuild and upload the program to enable Start/Stop.',
        })
        return
      }
      // Covers the race where the switch moved between the store's last poll and
      // this command: the device is authoritative, so its refusal wins.
      if (result.refusedBySwitch) {
        await warnSwitchInStop(boardTarget, switchLabel)
        return
      }
      if (!result.success) {
        addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to ${wantRun ? 'start' : 'stop'} PLC: ${result.error ?? 'Unknown error'}`,
        })
        return
      }

      // No re-read: the target settles into the new state on its next scan and the
      // status poll picks it up within one tick. Reflecting the acknowledgement
      // keeps the button responsive without a round trip that could still read the
      // pre-change value.
      if (result.state !== undefined) {
        useOpenPLCStore
          .getState()
          .deviceActions.setPlcRuntimeStatus(
            (result.state === 1 ? 'RUNNING' : result.state === 2 ? 'ERROR' : 'STOPPED') as NonNullable<
              RuntimeConnection['plcStatus']
            >,
          )
      }
    } catch (error: unknown) {
      addLog({ id: crypto.randomUUID(), level: 'error', message: `PLC control error: ${getErrorMessage(error)}` })
    }
  }, [
    deviceDefinitions.configuration.deviceBoard,
    availableBoards,
    plcStatus,
    switchPosition,
    debuggerPort,
    addLog,
    warnSwitchInStop,
  ])

  const handleSimulatorControl = useCallback(async (): Promise<void> => {
    try {
      if (simulatorRunning) {
        // Two things end here, in this order.
        //
        // The debug session goes first: it is a CONSUMER of the emulator, so it
        // has to let go of the transport before the thing on the other end
        // disappears.
        await debugSession.stopSession()

        // Then the emulator itself — which is this button's job and nothing
        // else's. `stopSession()` deliberately does not do it (see its
        // docstring: a debug session is not the owner of the thing it talks
        // to), so with this call missing "Stop" ended the debug session, logged
        // "Simulator stopped." and left the avr8js loop running: it kept
        // re-scheduling itself and burning a core for the rest of the session,
        // with no way to reach it from the UI because the button had already
        // flipped back to "Start".
        await simulator.stop()

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
  }, [debugSession, simulator, simulatorRunning, addLog])

  // ---------------------------------------------------------------------------
  // MD5 verification — runs after debug compilation for non-simulator
  // ---------------------------------------------------------------------------

  const handleMd5Verification = async (projectPath: string, boardTarget: string, isRuntimeTarget: boolean) => {
    const { consoleActions, runtimeConnection, deviceActions } = useOpenPLCStore.getState()

    try {
      // If runtime target + PLC stopped, offer to start
      if (isRuntimeTarget && runtimeConnection.plcStatus === 'STOPPED' && runtimeConnection.jwtToken) {
        const response = await showDeviceDialog(
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
        const startResult = (await debuggerPort.setPlcState?.('RUNNING')) ?? {
          success: false,
          error: 'This target does not support run/stop control',
        }
        if (!startResult.success) {
          await showDeviceDialog(
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
        await showDeviceDialog('error', 'MD5 Extraction Failed', md5Result.error ?? 'Could not extract MD5', ['OK'])
        setIsDebuggerProcessing(false)
        return
      }

      // Connect debug transport before MD5 verification — the web platform
      // needs an active transport (WebRTC or HTTP fallback) to query the device.
      // connect() is idempotent: connectAndStart will reuse this connection.
      const preConnectResult = await debuggerPort.connect()
      if (!preConnectResult.success) {
        await showDeviceDialog(
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
        // Persist the target's byte order — detected from the MD5
        // response trailer in the runtime — so the swap layer at the
        // read / write boundaries flips on BE targets.  Default to
        // `'le'` when the trailer was missing or malformed (older
        // runtimes); detectTargetEndian already logged a warning.
        useOpenPLCStore.getState().workspaceActions.setDebugTargetEndian(verifyResult.targetEndian ?? 'le')
        await debugSession.connectAndStart()
        setIsDebuggerProcessing(false)
      } else {
        // Disconnect before re-upload; the recursive call will reconnect
        await debuggerPort.disconnect()

        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `MD5 mismatch. Target: ${verifyResult.targetMd5}, Expected: ${md5Result.md5}`,
        })
        const response = await showDeviceDialog(
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
            void handleMd5Verification(projectPath, boardTarget, isRuntimeTarget)
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
    // Simulator targets debug through the Start Simulator button
    // (compile + load firmware + connect), so the Debugger button
    // is hidden for them at the JSX level — but guard here too in
    // case the gate ever flips.
    if (isSimulatorBoard) return

    const { workspace, project, deviceDefinitions: devDefs, consoleActions } = useOpenPLCStore.getState()

    // Toggle off
    if (workspace.isDebuggerVisible) {
      debugSessionRidesDeviceRef.current = false
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

      // No resolution here at all. Every target's session is established before a
      // debug session can start — a device by Connect, a runtime by logging in, the
      // simulator by pressing Start — so the only question left is whether that
      // session exists. Which medium it uses is the connection manager's to know.
      const isRuntime = isOpenPLCRuntimeTarget(boardInfo)

      // A session the manager holds (a device or the simulator) also OWNS the debug
      // channel, so the session ending ends the debug session — see the drop handler
      // above. A runtime's debug channel is its own and outlives nothing.
      debugSessionRidesDeviceRef.current = !isRuntime

      // One question for every target: does the manager hold a session? A simulator's
      // session is its running emulator, a device's is Connect, a runtime's is the
      // login — all three publish the same status.
      const sessionStatus = useOpenPLCStore.getState().deviceConnection.status
      addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `[connection] debug session requested for ${boardTarget}; session is "${sessionStatus}"`,
      })

      // Connect first. Starting a debug session must never establish the connection
      // itself: connecting is the user's explicit action and reports what it found.
      if (sessionStatus !== 'connected') {
        await showDeviceDialog(
          'warning',
          'Connection Required',
          isRuntime
            ? 'Connect to the runtime first. The debugger runs over that connection, so it must be established before a debug session can start.'
            : 'Connect to the device first. The debugger runs over the device connection, so the device must be connected before a debug session can start.',
          ['OK'],
        )
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

      // Only gates the "PLC stopped, start it?" dialog inside MD5 verification,
      // which applies to an OpenPLC runtime (v3/v4) — a fact about the TARGET, not
      // about which transport happens to carry the session.
      void handleMd5Verification(projectPath, boardTarget, isRuntime)
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
    currentBoardInfo,
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
