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

import { useSimulator } from '../../middleware/shared/providers'
import { useOpenPLCStore } from '../store'
import { getErrorMessage } from '../utils/get-error-message'
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
   */
  launch: (firmwarePath: string, options?: { attachDebugger?: boolean }) => Promise<boolean>
  /** End the debug session (if any) and stop the emulator. */
  stop: () => Promise<void>
}

export function useSimulatorDebugRun(args: UseSimulatorDebugRunArgs): UseSimulatorDebugRunReturn {
  const { debugSession, onDebugAttached, onStopped } = args
  const simulator = useSimulator()
  const addLog = useOpenPLCStore((state) => state.consoleActions.addLog)

  const [isRunning, setIsRunning] = useState(false)

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

  const launch = useCallback(
    async (firmwarePath: string, options: { attachDebugger?: boolean } = {}): Promise<boolean> => {
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

  const stop = useCallback(async (): Promise<void> => {
    try {
      // Two things end here, in this order, and the emulator's end is not
      // conditional on the debug session's.
      //
      // The debug session goes first: it is a CONSUMER of the emulator, so it
      // has to let go of the transport before the thing on the other end
      // disappears.
      //
      // The emulator goes second, from a `finally`, because stopping it is
      // this function's job and nothing else's. `stopSession()` deliberately
      // does not do it (see its docstring: a debug session is not the owner of
      // the thing it talks to), so with this call missing "Stop" ended the
      // debug session, logged "Simulator stopped." and left the avr8js loop
      // running — re-scheduling itself and burning a core for the rest of the
      // session, unreachable because the button had flipped back to "Start".
      //
      // Sequencing it after a plain `await` reintroduced the same leak on the
      // error path: anything that rejects inside the teardown (today only a
      // throwing `onDisconnected` subscriber, which is why nothing hits it
      // yet) skipped straight to the catch below, which only logs. The
      // emulator kept running, `isRunning` stayed true, and every retry failed
      // identically — worse than the original bug, because nothing settled at
      // all. `finally` keeps the order and drops the condition.
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
    }
  }, [debugSession, simulator, addLog])

  return { isRunning, launch, stop }
}
