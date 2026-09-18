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
 * is up — a caller that needs the session (the debugger) must watch
 * `runtimeConnection.connectionStatus` rather than await this. That is also why
 * the debugger's offer ends up as a modal opening a modal.
 */
import { useDevice, useRuntime } from '@root/middleware/shared/providers/platform-context'
import { useCallback } from 'react'

import { useOpenPLCStore } from '../store'
import { validateRuntimeVersion } from '../utils/device'

export interface UseRuntimeConnectResult {
  /** Toggle: connects when disconnected, disconnects when connected. */
  toggle: () => Promise<void>
  /** Connect only — a no-op when already connected. */
  connect: () => Promise<void>
}

export function useRuntimeConnect(): UseRuntimeConnectResult {
  const runtime = useRuntime()
  const device = useDevice()
  const deviceBoard = useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard)
  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress || '')
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const setRuntimeConnectionStatus = useOpenPLCStore((state) => state.deviceActions.setRuntimeConnectionStatus)
  const setRuntimeJwtToken = useOpenPLCStore((state) => state.deviceActions.setRuntimeJwtToken)
  const clearDeviceLicense = useOpenPLCStore((state) => state.deviceActions.clearDeviceLicense)
  const setRuntimeVersion = useOpenPLCStore((state) => state.deviceActions.setRuntimeVersion)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)

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

    // Web reaches a device through the orchestrator and carries no
    // `runtimeIpAddress`; the runtime port already holds the device context the
    // orchestrator screen set, so an empty address is only a stop condition on
    // the desktop path that supplies one.
    if (!runtimeIpAddress && !useOpenPLCStore.getState().runtimeConnection.selectedDevice) {
      return
    }

    setRuntimeConnectionStatus('connecting')

    try {
      // Web reaches the runtime THROUGH an orchestrator agent, so the adapter
      // has to be told which device every later call is about. The Orchestrators
      // screen does this inside its own Connect; extracting the connect without
      // it left `getUsersInfo` addressed at nothing, which failed silently --
      // status went to 'error' and no login modal ever appeared.
      //
      // Desktop carries no selected device and talks to `runtimeIpAddress`
      // directly, so this is a no-op there.
      const selected = useOpenPLCStore.getState().runtimeConnection.selectedDevice
      if (selected) {
        runtime.setDeviceContext?.({
          agentId: selected.orchestratorAgentId,
          deviceId: selected.deviceId,
        })
      }

      const result = await runtime.getUsersInfo()

      if (result.error) {
        setRuntimeConnectionStatus('error')
        return
      }

      // Remember the runtime version so version-gated UI (e.g. User
      // Management) can react to it for the lifetime of the connection.
      setRuntimeVersion(result.runtimeVersion ?? null)

      // Validate runtime version matches the selected board target
      const versionValidation = validateRuntimeVersion(deviceBoard, result.runtimeVersion)

      // Helper to proceed with connection after validation
      const proceedWithConnection = () => {
        if (result.hasUsers) {
          openModal('runtime-login', null)
        } else {
          openModal('runtime-create-user', null)
        }
      }

      if (versionValidation.status === 'mismatch') {
        // Hard error for version mismatch - cannot proceed
        setRuntimeConnectionStatus('error')
        openModal('debugger-message', {
          type: 'error',
          title: 'Runtime Version Mismatch',
          message: versionValidation.message || 'Unknown version mismatch error',
          buttons: ['OK'],
          onResponse: () => {
            // No action needed, just close the modal
          },
        })
        return
      }

      if (versionValidation.status === 'missing') {
        // Warning for older runtimes - allow user to continue anyway
        // Note: buttons ordered as ['Continue Anyway', 'Cancel'] so Cancel (index 1) is the default
        // when closing the modal (DebuggerMessageModal calls onResponse with last button index on close)
        openModal('debugger-message', {
          type: 'warning',
          title: 'Older Runtime Detected',
          message: versionValidation.message || 'Could not detect runtime version.',
          buttons: ['Continue Anyway', 'Cancel'],
          onResponse: (buttonIndex: number) => {
            if (buttonIndex === 0) {
              // User clicked "Continue Anyway" - proceed with connection
              proceedWithConnection()
            } else {
              // User clicked "Cancel" or closed the modal - stay disconnected
              setRuntimeConnectionStatus('disconnected')
            }
          },
        })
        return
      }

      // Version is OK - proceed normally
      proceedWithConnection()
    } catch (_error) {
      setRuntimeConnectionStatus('error')
    }
  }, [
    runtime,
    device,
    runtimeIpAddress,
    connectionStatus,
    setRuntimeConnectionStatus,
    setRuntimeJwtToken,
    clearDeviceLicense,
    setRuntimeVersion,
    openModal,
    deviceBoard,
  ])

  const connect = useCallback(async () => {
    // Already connected, or a connect is already in flight — either way there
    // is nothing to start. Without the `connecting` guard a second press (the
    // debugger clears its own processing flag before this resolves) fired a
    // second getUsersInfo and a second login modal.
    if (connectionStatus === 'connected' || connectionStatus === 'connecting') return
    await toggle()
  }, [connectionStatus, toggle])

  return { toggle, connect }
}
