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
      setRuntimeJwtToken(null)
      setRuntimeConnectionStatus('disconnected')
      await runtime.clearCredentials()
      await device.closeRuntimeSession?.()
      clearDeviceLicense()
      return
    }
    await connect()
  }, [runtime, device, connectionStatus, setRuntimeConnectionStatus, setRuntimeJwtToken, clearDeviceLicense, connect])

  return { toggle, connect }
}
