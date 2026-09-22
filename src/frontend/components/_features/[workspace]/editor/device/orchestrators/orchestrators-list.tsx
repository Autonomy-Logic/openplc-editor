import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  OrchestratorDevice,
  OrchestratorInfo,
} from '../../../../../../../middleware/shared/ports/orchestrator-port'
import { useOrchestrator, usePlatform, useRuntime } from '../../../../../../../middleware/shared/providers'
import { ArrowIcon } from '../../../../../../assets/icons/interface/Arrow'
import { RefreshIcon } from '../../../../../../assets/icons/interface/Refresh'
import { WarningIcon } from '../../../../../../assets/icons/interface/Warning'
import { openPLCStoreBase, useOpenPLCStore } from '../../../../../../store'
import type { SelectedDevice } from '../../../../../../store/slices/device'
import { cn } from '../../../../../../utils/cn'
import { getErrorMessage } from '../../../../../../utils/get-error-message'
import { Modal, ModalContent, ModalTitle } from '../../../../../_molecules/modal'
import { DeviceEditorSlot } from '../../../../../_templates/[editors]/device-editor-slot'

// Note: Status and timing stats polling is handled globally by useRuntimePolling hook.
// This component sets includeTimingStatsInPolling=true on mount to request timing stats.

const SIMULATOR_BOARD_NAME = 'OpenPLC Simulator'
const RUNTIME_BOARD_NAME = 'OpenPLC Runtime v4'

/**
 * Returns the appropriate status badge styling based on status value
 */
const getStatusBadgeStyle = (status: string | null) => {
  const statusLower = status?.toLowerCase()
  switch (statusLower) {
    case 'online':
    case 'running':
    case 'active':
    case 'success':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    case 'offline':
    case 'stopped':
    case 'inactive':
    case 'error':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    case 'idle':
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    default:
      return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
  }
}

/**
 * Status badge component matching Autonomy Edge design
 */
const StatusBadge = ({ status }: { status: string | null }) => {
  const displayStatus = status || 'unknown'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium capitalize',
        getStatusBadgeStyle(status),
      )}
    >
      <div className='mr-1 h-1.5 w-1.5 rounded-full bg-current' />
      {displayStatus}
    </span>
  )
}

/** Marks the one vPLC that drives the Device's local backplane I/O. */
const BackplaneBadge = () => (
  <span className='inline-flex items-center rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'>
    Backplane I/O
  </span>
)

/** Same rule for both: absent clears the key, a value writes it. */
function sameBinding(a: SelectedDevice['vpp'], b: SelectedDevice['vpp']): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.packageId === b.packageId && a.version === b.version && a.contentHash === b.contentHash
}

function refreshSelection(selection: SelectedDevice | null, orchestrators: OrchestratorInfo[]): SelectedDevice | null {
  if (!selection) return null
  const device = orchestrators
    .find((item) => item.id === selection.orchestratorId)
    ?.devices.find((item) => item.id === selection.deviceId)
  if (!device) return selection
  if (device.backplaneAccess === selection.backplaneAccess && sameBinding(device.vpp, selection.vpp)) {
    return selection
  }
  const updated = { ...selection }
  if (device.backplaneAccess === undefined) delete updated.backplaneAccess
  else updated.backplaneAccess = device.backplaneAccess
  if (device.vpp === undefined) delete updated.vpp
  else updated.vpp = device.vpp
  return updated
}

const OrchestratorsList = () => {
  const orchestratorPort = useOrchestrator()
  const runtimePort = useRuntime()
  const packages = usePlatform().packages
  const { modalActions, deviceActions, runtimeConnection } = useOpenPLCStore()
  const [orchestrators, setOrchestrators] = useState<OrchestratorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedOrchestrators, setExpandedOrchestrators] = useState<Set<string>>(new Set())
  const [selectedDevice, setSelectedDevice] = useState<SelectedDevice | null>(null)

  // Track whether the simulator is selected
  const isSimulatorSelected = useOpenPLCStore((state) => {
    const boardName = state.deviceDefinitions.configuration.deviceBoard
    const boardInfo = state.deviceAvailableOptions.availableBoards.get(boardName)
    return resolveTargetCapabilities(boardInfo).isInProcessSimulator
  })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  // Note: Status polling is handled globally by useRuntimePolling hook.
  // This component sets includeTimingStatsInPolling=true to request timing stats.

  // State for device switch confirmation modal
  const [showSwitchConfirmModal, setShowSwitchConfirmModal] = useState(false)
  const [pendingDeviceSwitch, setPendingDeviceSwitch] = useState<SelectedDevice | null>(null)

  // Note: WebRTC connection lifecycle is managed by WebRTCManager at the app level.
  // This allows the connection to persist across tab switches.

  // Manage board selection based on connection state:
  // - When disconnecting: switch to simulator board
  // - When connecting while on simulator: switch to runtime board
  const prevConnectionStatusRef = useRef(runtimeConnection.connectionStatus)
  useEffect(() => {
    const wasConnected = prevConnectionStatusRef.current === 'connected'
    prevConnectionStatusRef.current = runtimeConnection.connectionStatus

    if (wasConnected && runtimeConnection.connectionStatus !== 'connected' && !isSimulatorSelected) {
      deviceActions.setDeviceBoard(SIMULATOR_BOARD_NAME)
    } else if (runtimeConnection.connectionStatus === 'connected' && isSimulatorSelected) {
      deviceActions.setDeviceBoard(RUNTIME_BOARD_NAME)
    }
  }, [runtimeConnection.connectionStatus, isSimulatorSelected, deviceActions])

  // What the target vPLC's vendor package offers. The port is the only gate:
  // it answers empty wherever no vPLC is targeted — the desktop always, and
  // web until one is picked — which keeps the board rules below inert there
  // and leaves the two constants above in charge. Deliberately NOT gated on
  // the connection: the binding comes from the device listing, and a board is
  // a compile-time choice that must not wait on a runtime login.
  const [vendorBoards, setVendorBoards] = useState<string[]>([])
  useEffect(() => {
    if (!packages) return
    let cancelled = false
    const resolve = (): void => {
      void packages
        .listTargetBoards()
        .catch(() => [] as string[])
        .then((boards) => {
          if (!cancelled) setVendorBoards(boards)
        })
    }
    resolve()
    // Switching vPLC reloads the package, and the new board set arrives here.
    const unsubscribe = packages.onBoardsUpdated(resolve)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [packages])

  // A vPLC runs the package it was created with, so one board is not a choice
  // to put to the user. Several is: the package ships more than one device and
  // only the user knows which is wired up, so the picker below asks.
  const deviceBoard = useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard)
  useEffect(() => {
    const only = vendorBoards.length === 1 ? vendorBoards[0] : undefined
    if (only !== undefined && deviceBoard !== only) deviceActions.setDeviceBoard(only)
  }, [vendorBoards, deviceBoard, deviceActions])

  const fetchOrchestrators = useCallback(async () => {
    try {
      const result = await orchestratorPort.listOrchestrators()
      setOrchestrators(result)
      const state = openPLCStoreBase.getState()
      const current = state.runtimeConnection.selectedDevice
      const refreshed = refreshSelection(current, result)
      if (refreshed !== current) state.deviceActions.setSelectedDevice(refreshed)
      setSelectedDevice((selection) => refreshSelection(selection, result))
      setPendingDeviceSwitch((selection) => refreshSelection(selection, result))
      setError(null)
    } catch (error) {
      console.error('[Orchestrators] Fetch failed', error)
      setError('Failed to load Edge Devices. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [orchestratorPort])

  useEffect(() => {
    void fetchOrchestrators()
  }, [fetchOrchestrators])

  // Sync selectedDevice with runtimeConnection.selectedDevice on mount and when connection changes
  // This ensures the UI shows the connected device when reopening the Edge Devices screen
  useEffect(() => {
    if (runtimeConnection.connectionStatus === 'connected' && runtimeConnection.selectedDevice) {
      // Copied whole: a hand-listed field copy is what dropped `backplaneAccess` here.
      setSelectedDevice(runtimeConnection.selectedDevice)
    }
  }, [runtimeConnection.connectionStatus, runtimeConnection.selectedDevice])

  // Auto-expand orchestrator containing the connected device
  useEffect(() => {
    if (runtimeConnection.connectionStatus === 'connected' && runtimeConnection.selectedDevice) {
      setExpandedOrchestrators((prev) => {
        const newSet = new Set(prev)
        newSet.add(runtimeConnection.selectedDevice!.orchestratorId)
        return newSet
      })
    }
  }, [runtimeConnection.connectionStatus, runtimeConnection.selectedDevice])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await fetchOrchestrators()
    setIsRefreshing(false)
  }, [fetchOrchestrators])

  const toggleOrchestratorExpanded = useCallback((orchestratorId: string) => {
    setExpandedOrchestrators((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(orchestratorId)) {
        newSet.delete(orchestratorId)
      } else {
        newSet.add(orchestratorId)
      }
      return newSet
    })
  }, [])

  const handleDeviceSelect = useCallback(
    (orchestratorId: string, orchestratorAgentId: string, device: OrchestratorDevice) => {
      // Prevent selection of inactive devices
      if (device.active === false) {
        return
      }

      const selection: SelectedDevice = {
        orchestratorId,
        orchestratorAgentId,
        deviceId: device.id,
        deviceName: device.name,
        // Absent stays absent: a host that predates the field must not read as one that said no.
        ...(typeof device.backplaneAccess === 'boolean' ? { backplaneAccess: device.backplaneAccess } : {}),
        // `null` is a real answer — "runs no vendor package" — and absent is not.
        ...(device.vpp !== undefined ? { vpp: device.vpp } : {}),
      }

      // If already connected to a different device, show confirmation modal
      if (
        runtimeConnection.connectionStatus === 'connected' &&
        runtimeConnection.selectedDevice &&
        runtimeConnection.selectedDevice.deviceId !== device.id
      ) {
        setPendingDeviceSwitch(selection)
        setShowSwitchConfirmModal(true)
        return
      }

      setSelectedDevice(selection)
      // Publish the choice app-wide. Picking a device is NOT connecting to it --
      // that is still the Connect button's job -- but the choice has to be
      // visible outside this screen, or nothing else can name the target. The
      // debugger's offer-to-connect needs it to say WHICH device it is about to
      // reach, and to tell "a device is chosen" apart from "nothing is chosen".
      //
      // Safe against the WebRTC lifecycle: its connect fires on the
      // connection-status transition (`prev !== 'connected' && now ===
      // 'connected'`) and only READS `selectedDevice` as a guard, so setting it
      // here starts nothing.
      //
      // `selection`, not a reduced copy: it carries backplaneAccess and the
      // vendor-package binding, which is what the package layer follows.
      deviceActions.setSelectedDevice(selection)
      setConnectionError(null)
    },
    [runtimeConnection.connectionStatus, runtimeConnection.selectedDevice, deviceActions],
  )

  const handleConnect = useCallback(async () => {
    if (!selectedDevice) return

    setIsConnecting(true)
    setConnectionError(null)
    deviceActions.setRuntimeConnectionStatus('connecting')

    try {
      // Store the selected device in the store
      deviceActions.setSelectedDevice(selectedDevice)

      // Set device context so the runtime adapter knows which device to target
      runtimePort.setDeviceContext?.({
        agentId: selectedDevice.orchestratorAgentId,
        deviceId: selectedDevice.deviceId,
      })

      // Check if the runtime has users via the runtime port
      const usersInfo = await runtimePort.getUsersInfo()

      if (usersInfo.error) {
        setConnectionError('Failed to connect to runtime: ' + usersInfo.error)
        deviceActions.setRuntimeConnectionStatus('error')
        return
      }

      // Remember the runtime version so version-gated UI (User Management, Persistent
      // Storage) can react to it for the lifetime of the connection.
      //
      // This is the web editor's only connect path, and it was discarding the version
      // `getUsersInfo` returns. The desktop path stores it in `board.tsx`, so the gates
      // worked there and never here: with the version left null,
      // `isUserManagementCapableRuntime` answers false and its tree leaf could not
      // appear on any runtime, however new.
      deviceActions.setRuntimeVersion(usersInfo.runtimeVersion ?? null)

      // Open the appropriate modal based on whether users exist
      if (usersInfo.hasUsers) {
        modalActions.openModal('runtime-login')
      } else {
        modalActions.openModal('runtime-create-user')
      }
    } catch (err: unknown) {
      setConnectionError('Error: ' + getErrorMessage(err))
      deviceActions.setRuntimeConnectionStatus('error')
    } finally {
      setIsConnecting(false)
    }
  }, [selectedDevice, deviceActions, modalActions, runtimePort])

  // Helper to clear all connection state (store + local component state)
  // This centralizes the "tear down connection" logic to avoid duplication
  const clearConnectionState = useCallback(() => {
    // Clear store state (jwtToken, connectionStatus, plcStatus, selectedDevice, storedCredentials)
    deviceActions.clearRuntimeConnection()
    // Clear local component state
    setSelectedDevice(null)
    // Note: Status polling cleanup is handled by useRuntimePolling hook
  }, [deviceActions])

  const handleDisconnect = useCallback(async () => {
    if (!runtimeConnection.selectedDevice || !runtimeConnection.jwtToken) return

    setIsDisconnecting(true)
    setConnectionError(null)

    try {
      // Logout via the runtime port (clears JWT on the adapter side)
      await runtimePort.clearCredentials()

      // Clear device context since we're disconnecting
      runtimePort.setDeviceContext?.(null)

      // Clear all connection state regardless of logout result
      clearConnectionState()
    } catch {
      // Still clear the connection state on error
      runtimePort.setDeviceContext?.(null)
      clearConnectionState()
    } finally {
      setIsDisconnecting(false)
    }
  }, [runtimeConnection.selectedDevice, runtimeConnection.jwtToken, runtimePort, clearConnectionState])

  const handleSimulatorSelect = useCallback(() => {
    // If connected to an orchestrator device, disconnect first
    if (runtimeConnection.connectionStatus === 'connected' && runtimeConnection.selectedDevice) {
      void handleDisconnect().then(() => {
        setSelectedDevice(null)
        deviceActions.setSelectedDevice(null)
        deviceActions.setDeviceBoard(SIMULATOR_BOARD_NAME)
      })
      return
    }

    setSelectedDevice(null)
    // The simulator is a target, not a device: clear the published choice so
    // nothing downstream still believes a device is selected.
    deviceActions.setSelectedDevice(null)
    setConnectionError(null)
    deviceActions.setDeviceBoard(SIMULATOR_BOARD_NAME)
  }, [runtimeConnection.connectionStatus, runtimeConnection.selectedDevice, deviceActions, handleDisconnect])

  // Timing and EtherCAT stats polling moved to the Runtime Status screen
  // (RTOP-283) along with the panels that display them. Polling here would
  // fetch data nobody is looking at, and would leave Runtime Status with
  // nothing to show when opened on its own.

  // Handle device switch confirmation
  const handleConfirmDeviceSwitch = useCallback(async () => {
    if (!pendingDeviceSwitch) return

    setShowSwitchConfirmModal(false)

    // Disconnect from current device first
    await handleDisconnect()

    // Select the new device — locally AND in the store. Publishing to the store
    // is what every other selection path does (handleDeviceSelect, handleConnect
    // and the simulator clears); leaving it out here meant that after a switch
    // the screen showed device B while `runtimeConnection.selectedDevice` was
    // still null (handleDisconnect had just cleared it). The debugger reads the
    // store, so it reported "No Device Selected", and on a simulator-named board
    // that turned into an offer to start the simulator instead.
    setSelectedDevice(pendingDeviceSwitch)
    deviceActions.setSelectedDevice({
      orchestratorId: pendingDeviceSwitch.orchestratorId,
      orchestratorAgentId: pendingDeviceSwitch.orchestratorAgentId,
      deviceId: pendingDeviceSwitch.deviceId,
      deviceName: pendingDeviceSwitch.deviceName,
    })
    setPendingDeviceSwitch(null)
    setConnectionError(null)
  }, [pendingDeviceSwitch, handleDisconnect, deviceActions])

  const handleCancelDeviceSwitch = useCallback(() => {
    setShowSwitchConfirmModal(false)
    setPendingDeviceSwitch(null)
  }, [])

  return (
    <div className='flex h-full w-full flex-col'>
      <div className='min-h-0 flex-1'>
        <DeviceEditorSlot heading='Edge Devices'>
          <div id='orchestrators-container' className='flex h-full w-full flex-col gap-4'>
            <div id='orchestrators-header' className='flex items-center justify-between'>
              <p className='text-sm text-neutral-600 dark:text-neutral-400'>
                Select a vPLC from your Edge Devices to connect to.
              </p>
              <button
                type='button'
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                className={cn('group', isRefreshing && 'cursor-not-allowed opacity-50')}
                aria-label='Refresh Edge Devices'
              >
                <RefreshIcon size='sm' className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Which board of a multi-device vendor package this vPLC drives.
                Absent whenever the package names exactly one, which the effect
                above has already selected, and on every platform that targets
                no vPLC. */}
            {vendorBoards.length > 1 && (
              <div
                id='vendor-board-picker'
                className='rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900'
              >
                <label htmlFor='vendor-board-select' className='text-sm font-medium text-neutral-900 dark:text-white'>
                  Vendor board
                </label>
                <p className='mt-1 text-xs text-neutral-500 dark:text-neutral-400'>
                  This vPLC&apos;s vendor package supports several boards. Choose the one wired to the backplane.
                </p>
                <select
                  id='vendor-board-select'
                  aria-label='Vendor board selection'
                  value={vendorBoards.includes(deviceBoard) ? deviceBoard : ''}
                  onChange={(event) => {
                    if (event.target.value) deviceActions.setDeviceBoard(event.target.value)
                  }}
                  className='mt-2 w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-850 outline-none dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                >
                  <option value=''>Select a board…</option>
                  {vendorBoards.map((board) => (
                    <option key={board} value={board}>
                      {board}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Simulator option — always visible */}
            <div
              className={cn(
                'cursor-pointer rounded-lg border px-4 py-3',
                isSimulatorSelected && runtimeConnection.connectionStatus !== 'connected'
                  ? 'bg-brand/5 dark:bg-brand/10 border-brand dark:border-brand'
                  : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800',
              )}
              onClick={handleSimulatorSelect}
            >
              <div className='flex items-center justify-between'>
                <div className='flex flex-col'>
                  <span className='text-sm font-medium text-neutral-900 dark:text-white'>OpenPLC Simulator</span>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                    Built-in simulator — no hardware required
                  </span>
                </div>
                {isSimulatorSelected && runtimeConnection.connectionStatus !== 'connected' && (
                  <span className='inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-brand'>
                    Selected
                  </span>
                )}
              </div>
            </div>

            {loading && (
              <div className='flex items-center justify-center py-8'>
                <p className='text-sm text-neutral-500 dark:text-neutral-400'>Loading Edge Devices...</p>
              </div>
            )}

            {error && (
              <div className='rounded-md bg-red-50 p-4 dark:bg-red-900/20'>
                <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
              </div>
            )}

            {!loading && !error && orchestrators.length === 0 && (
              <div className='flex flex-col items-center justify-center gap-2 py-8'>
                <p className='text-sm text-neutral-500 dark:text-neutral-400'>No Edge Devices found.</p>
                <p className='text-xs text-neutral-400 dark:text-neutral-500'>
                  Register an Edge Device in the Autonomy Edge platform to see it here.
                </p>
              </div>
            )}

            {!loading && !error && orchestrators.length > 0 && (
              <div id='orchestrators-list' className='flex flex-col gap-2'>
                {orchestrators.map((orchestrator) => {
                  const isExpanded = expandedOrchestrators.has(orchestrator.id)
                  const hasDevices = orchestrator.devices.length > 0

                  return (
                    <div
                      key={orchestrator.id}
                      className='rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900'
                    >
                      <div
                        className={cn(
                          'flex cursor-pointer items-center gap-2 px-4 py-3',
                          hasDevices && 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                        )}
                        onClick={() => hasDevices && toggleOrchestratorExpanded(orchestrator.id)}
                      >
                        {hasDevices ? (
                          <ArrowIcon
                            direction='right'
                            className={cn(
                              'h-4 w-4 stroke-neutral-500 transition-transform dark:stroke-neutral-400',
                              isExpanded && 'rotate-90',
                            )}
                          />
                        ) : (
                          <div className='h-4 w-4' />
                        )}
                        <div className='flex flex-1 flex-col'>
                          <span className='text-sm font-medium text-neutral-900 dark:text-white'>
                            {orchestrator.name}
                          </span>
                          {orchestrator.description && (
                            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                              {orchestrator.description}
                            </span>
                          )}
                        </div>
                        <span className='text-xs text-neutral-400 dark:text-neutral-500'>
                          {orchestrator.devices.length} vPLC{orchestrator.devices.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {isExpanded && hasDevices && (
                        <div className='border-t border-neutral-200 dark:border-neutral-700'>
                          {orchestrator.devices.map((device) => {
                            const isSelected =
                              selectedDevice?.orchestratorId === orchestrator.id &&
                              selectedDevice?.deviceId === device.id
                            const isConnected =
                              runtimeConnection.connectionStatus === 'connected' &&
                              runtimeConnection.selectedDevice?.deviceId === device.id
                            const isInactive = device.active === false
                            const isHighlighted = !isInactive && (isSelected || isConnected)

                            return (
                              <div
                                key={device.id}
                                className={cn(
                                  'flex items-center gap-3 px-4 py-2 pl-10',
                                  isInactive && 'cursor-not-allowed opacity-60',
                                  !isInactive &&
                                    !isHighlighted &&
                                    'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800',
                                  isHighlighted && 'cursor-pointer bg-neutral-100 dark:bg-neutral-800',
                                )}
                                onClick={() => handleDeviceSelect(orchestrator.id, orchestrator.agentId, device)}
                              >
                                <span className='flex-1 text-sm text-neutral-800 dark:text-neutral-200'>
                                  {device.name}
                                </span>
                                {device.backplaneAccess === true && <BackplaneBadge />}
                                <StatusBadge status={device.status} />
                                {isConnected && (
                                  <span className='text-xs font-medium text-green-600 dark:text-green-400'>
                                    Connected
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {selectedDevice && (
              <div
                id='connection-actions'
                className='mt-4 flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700'
              >
                <div className='flex items-center gap-4'>
                  {runtimeConnection.connectionStatus === 'connected' ? (
                    <button
                      type='button'
                      onClick={() => void handleDisconnect()}
                      disabled={isDisconnecting}
                      className={cn(
                        'h-[30px] rounded-md bg-brand px-4 py-1 font-caption text-cp-sm font-medium text-white hover:bg-brand-medium-dark',
                        isDisconnecting && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      type='button'
                      onClick={() => void handleConnect()}
                      disabled={isConnecting}
                      className={cn(
                        'h-[30px] rounded-md bg-brand px-4 py-1 font-caption text-cp-sm font-medium text-white hover:bg-brand-medium-dark',
                        isConnecting && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {isConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>
                {runtimeConnection.connectionStatus === 'connected' && runtimeConnection.plcStatus && (
                  <div className='flex items-center gap-2'>
                    <span className='text-xs text-neutral-500 dark:text-neutral-400'>PLC Status:</span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        runtimeConnection.plcStatus === 'RUNNING' && 'text-green-600 dark:text-green-400',
                        runtimeConnection.plcStatus === 'STOPPED' && 'text-red-600 dark:text-red-400',
                        runtimeConnection.plcStatus === 'EMPTY' && 'text-yellow-600 dark:text-yellow-400',
                        runtimeConnection.plcStatus === 'INIT' && 'text-blue-600 dark:text-blue-400',
                        runtimeConnection.plcStatus === 'ERROR' && 'text-red-600 dark:text-red-400',
                        runtimeConnection.plcStatus === 'UNKNOWN' && 'text-neutral-500 dark:text-neutral-400',
                      )}
                    >
                      {runtimeConnection.plcStatus}
                    </span>
                  </div>
                )}
                {connectionError && <p className='text-sm text-red-600 dark:text-red-400'>{connectionError}</p>}
              </div>
            )}

            {/* Device Switch Confirmation Modal */}
            <Modal open={showSwitchConfirmModal} onOpenChange={setShowSwitchConfirmModal}>
              <ModalContent className='flex h-[320px] w-[400px] select-none flex-col items-center justify-evenly rounded-lg'>
                <ModalTitle className='hidden'>Switch vPLC</ModalTitle>
                <div className='flex select-none flex-col items-center gap-6 p-4'>
                  <WarningIcon className='h-[60px] w-[60px]' />
                  <div className='text-center'>
                    <p className='text-sm font-medium text-neutral-900 dark:text-neutral-100'>
                      You are currently connected to <strong>{runtimeConnection.selectedDevice?.deviceName}</strong>.
                    </p>
                    <p className='mt-2 text-sm text-neutral-600 dark:text-neutral-400'>
                      To connect to <strong>{pendingDeviceSwitch?.deviceName}</strong>, you must disconnect from the
                      current vPLC first.
                    </p>
                  </div>

                  <div className='flex w-full flex-col gap-2'>
                    <button
                      onClick={() => void handleConfirmDeviceSwitch()}
                      className='w-full rounded-lg bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-medium-dark'
                    >
                      Disconnect and Switch
                    </button>
                    <button
                      onClick={handleCancelDeviceSwitch}
                      className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </ModalContent>
            </Modal>
          </div>
        </DeviceEditorSlot>
      </div>

      {/* Bottom panel - Scan Cycle + EtherCAT + plugin-contributed
       *  statistics. Mirrors the board screen's stats panel: same
       *  components, same TimingStats shape, same plugin_stats fan-out.
       *  Web builds (orchestrator-driven) and Electron builds (board-
       *  screen-driven) thus render identical stats regardless of how
       *  the user navigated to the device. */}
    </div>
  )
}

export { OrchestratorsList }
