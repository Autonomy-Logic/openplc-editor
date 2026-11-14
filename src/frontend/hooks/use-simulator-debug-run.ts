/**
 * Simulator run lifecycle — load firmware into the in-process emulator,
 * optionally attach a debug session, and tear both down in the right
 * order.
 *
 * Two callers drive the emulator and they must not each own a copy of
 * this sequence: the PLC project's Start button (compile for the
 * simulator board, run, attach) and the Library project's Debug button
 * (compile a generated harness, run, attach).  The ordering rules here
 * are the ones that were learned the hard way in the activity bar and
 * are easy to get subtly wrong a second time — see `stop()`.
 *
 * Platform-agnostic: everything goes through `SimulatorPort` and the
 * debug session hook, so editor and web share it byte-for-byte.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { PLCProjectData } from '../../middleware/shared/ports/types'
import { useSimulator } from '../../middleware/shared/providers'
import { useOpenPLCStore } from '../store'
import { getErrorMessage } from '../utils/get-error-message'
import { countPythonBlockInstances } from '../utils/python/count-python-block-instances'
import type { UseDebugSessionReturn } from './useDebugSession'

export interface UseSimulatorDebugRunArgs {
  /**
   * The caller's debug session.  Passed in rather than created here:
   * `useDebugSession` owns a ref holding the per-POU debug trees that
   * `useDebugPolling` reads, so a second instance would attach a
   * session whose trees the poller never sees.
   */
  debugSession: UseDebugSessionReturn
  /**
   * Called once a debug session has been attached to a freshly started
   * emulator.  The emulator's session IS the debug transport, so the
   * caller uses this to record that the debug session ends when that
   * session does.
   */
  onDebugAttached?: () => void
  /**
   * Called whenever the emulator stops — by `stop()`, by a crash, or by
   * the program exiting.  Lets the caller drop any state that was only
   * true while it ran.
   */
  onStopped?: () => void
}

export interface UseSimulatorDebugRunReturn {
  /** True from `launch` until the run has started or failed, and from `stop` until it has stopped. */
  isBusy: boolean
  /** True while the emulator is running. */
  isRunning: boolean
  /**
   * Load `firmwarePath` into the emulator and start it.  With
   * `attachDebugger`, opens a debug session against it once it is up.
   *
   * Resolves `false` when the run did not fully come up — either the
   * firmware would not load, or it loaded but the debug session failed
   * to attach.  Callers that installed session state before the compile
   * use this to tear it back down; both failures leave that state
   * orphaned otherwise, and the compile itself reports success in both
   * cases because it did produce firmware.
   *
   * Note the asymmetry with `isRunning`: a failed ATTACH still leaves
   * the emulator running, so the caller's stop control stays live and
   * `stop()` remains the way to end it.
   *
   * With `projectData`, one Python interpreter per Python block instance
   * is started first and the PLC starts once they are ready, so the
   * blocks start with the first scan. They start after the compile, not
   * during it: booting them while the in-browser compiler runs stalls it
   * on WebKit.
   */
  launch: (
    firmwarePath: string,
    options?: { attachDebugger?: boolean; projectData?: PLCProjectData },
  ) => Promise<boolean>
  /** End the debug session (if any), then stop the emulator, even when ending the session fails. */
  stop: () => Promise<void>
}

export function useSimulatorDebugRun(args: UseSimulatorDebugRunArgs): UseSimulatorDebugRunReturn {
  const { debugSession, onDebugAttached, onStopped } = args
  const simulator = useSimulator()
  const addLog = useOpenPLCStore((state) => state.consoleActions.addLog)

  const [isRunning, setIsRunning] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  // Callers pass these as inline arrows, so their identity changes on every
  // render. Held in refs and read at call time so the subscription below and
  // the callbacks in `launch` / `stop` do not churn with the caller's render
  // cycle — the activity bar re-renders on every debug poll tick.
  const onStoppedRef = useRef(onStopped)
  onStoppedRef.current = onStopped
  const onDebugAttachedRef = useRef(onDebugAttached)
  onDebugAttachedRef.current = onDebugAttached

  // The emulator stopping is a session ending, and a debug session riding it
  // ends with it — which the caller's connection-drop handling already covers
  // for every target. This only mirrors the emulator's own state.
  //
  // Subscribed once per emulator, NOT per render: re-subscribing on every
  // render leaves a window between unsubscribe and re-subscribe in which a
  // stop event is dropped, stranding the button in its running state.
  useEffect(() => {
    return simulator.onStopped(() => {
      setIsRunning(false)
      onStoppedRef.current?.()
    })
  }, [simulator])

  useEffect(() => {
    return simulator.onLog((line, stream) => addLog({ level: stream === 'stderr' ? 'error' : 'info', message: line }))
  }, [simulator, addLog])

  const start = useCallback(
    async (firmwarePath: string, options: { attachDebugger?: boolean; projectData?: PLCProjectData }) => {
      const pythonBlocks = options.projectData ? countPythonBlockInstances(options.projectData) : 0
      if (pythonBlocks > 0) {
        await simulator.preparePython(pythonBlocks).catch((error: unknown) => {
          addLog({ level: 'error', message: `Python could not be prepared: ${getErrorMessage(error)}` })
        })
      }
      const loadResult = await simulator.loadFirmware(firmwarePath)
      if (!loadResult.success) {
        addLog({ level: 'error', message: `Failed to start simulator: ${loadResult.error ?? 'Unknown error'}` })
        return false
      }

      setIsRunning(true)
      addLog({ level: 'info', message: 'Simulator is running.' })

      if (options.attachDebugger) {
        // No config: starting the emulator opened its session, so the
        // connection manager already knows how to reach it.
        onDebugAttachedRef.current?.()
        // `connectAndStart` reports its own failures to the console and
        // resolves rather than throwing, so the result is the only signal
        // that the session did not come up — discarding it told the caller
        // the run succeeded when only half of it had.
        const attached = await debugSession.connectAndStart()
        if (!attached.success) return false
      }
      return true
    },
    [simulator, debugSession, addLog],
  )

  const launch = useCallback(
    async (
      firmwarePath: string,
      options: { attachDebugger?: boolean; projectData?: PLCProjectData } = {},
    ): Promise<boolean> => {
      setIsBusy(true)
      try {
        return await start(firmwarePath, options)
      } finally {
        setIsBusy(false)
      }
    },
    [start],
  )

  const stop = useCallback(async (): Promise<void> => {
    setIsBusy(true)
    try {
      try {
        await debugSession.stopSession()
      } finally {
        await simulator.stop()
      }

      setIsRunning(false)
      onStoppedRef.current?.()
      addLog({ level: 'info', message: 'Simulator stopped.' })
    } catch (error: unknown) {
      addLog({ level: 'error', message: `Simulator control error: ${getErrorMessage(error)}` })
    } finally {
      setIsBusy(false)
    }
  }, [debugSession, simulator, addLog])

  return { isBusy, isRunning, launch, stop }
}
