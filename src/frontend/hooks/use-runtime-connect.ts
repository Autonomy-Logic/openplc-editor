/**
 * useRuntimeConnect — the CONNECT action for OpenPLC Runtime targets.
 *
 * Extracted from the device Configuration screen so it has more than one
 * caller. The debugger offers to connect when no session exists, and that offer
 * has to run the SAME connect the Connect button runs — version check, login or
 * first-user modal, licence, JWT — or the two paths drift, which is precisely
 * what the shared surface exists to prevent.
 *
 * Connecting to a runtime is not a single await: `getUsersInfo` decides whether
 * the user is asked to log in or to create the first account, and both are
 * MODALS. So this resolves as soon as the modal is raised, not when the session
 * is up — a caller that needs the session (the debugger) must watch the session
 * status rather than await this (see `awaitDebugSession`). That is also why
 * the debugger's offer ends up as a modal opening a modal.
 */
import { useDevice, useRuntime, useRuntimeProvisioning } from '@root/middleware/shared/providers/platform-context'
import { useCallback } from 'react'

import { connectRuntime, type RuntimeConnectOutcome } from '../services/runtime-connect'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../store'

export interface UseRuntimeConnectResult {
  /** Toggle: connects when disconnected, disconnects when connected. */
  toggle: () => Promise<void>
  /** Connect only — a no-op when already connected. */
  connect: () => Promise<RuntimeConnectOutcome>
}

export function useRuntimeConnect(): UseRuntimeConnectResult {
  const store = useOpenPLCStoreApi()
  const runtime = useRuntime()
  const device = useDevice()
  const runtimeProvisioning = useRuntimeProvisioning()
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const setRuntimeConnectionStatus = useOpenPLCStore((state) => state.deviceActions.setRuntimeConnectionStatus)
  const setRuntimeJwtToken = useOpenPLCStore((state) => state.deviceActions.setRuntimeJwtToken)
  const clearDeviceLicense = useOpenPLCStore((state) => state.deviceActions.clearDeviceLicense)

  const connect = useCallback(
    () => connectRuntime(store, { runtime, device, runtimeProvisioning }),
    [store, runtime, device, runtimeProvisioning],
  )

  const toggle = useCallback(async () => {
    if (connectionStatus === 'connected') {
      // Disconnect - global polling hook will handle resetting failure counter
      setRuntimeJwtToken(null)
      setRuntimeConnectionStatus('disconnected')
      await runtime.clearCredentials()
      // The session goes with it: control was this REST connection, and any debug
      // channel opened off it has nothing left to belong to.
      await device.closeRuntimeSession?.()
      // A DELIBERATE disconnect drops the licence report too, exactly as the
      // serial flow does: leaving a badge behind would assert possession for
      // hardware nothing is talking to.
      clearDeviceLicense()
      return
    }
    await connect()
  }, [runtime, device, connectionStatus, setRuntimeConnectionStatus, setRuntimeJwtToken, clearDeviceLicense, connect])

  return { toggle, connect }
}
