import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { OrchestratorInfo } from '../../../../../../../middleware/shared/ports/orchestrator-port'
import { useOrchestrator, useRuntime } from '../../../../../../../middleware/shared/providers'
import { ArrowIcon } from '../../../../../../assets/icons/interface/Arrow'
import { RefreshIcon } from '../../../../../../assets/icons/interface/Refresh'
import { WarningIcon } from '../../../../../../assets/icons/interface/Warning'
import { useOpenPLCStore } from '../../../../../../store'
import { cn } from '../../../../../../utils/cn'
import { getErrorMessage } from '../../../../../../utils/get-error-message'
import { EtherCATStats } from '../../../../../_molecules/ethercat-stats'
import { Modal, ModalContent, ModalTitle } from '../../../../../_molecules/modal'
import { PluginStatsPanel } from '../../../../../_molecules/plugin-stats-panel'
import { ScanCycleStats } from '../../../../../_molecules/scan-cycle-stats'
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

const OrchestratorsList = () => {
  const orchestratorPort = useOrchestrator()
  const runtimePort = useRuntime()
  const { modalActions, deviceActions, runtimeConnection } = useOpenPLCStore()
  const [orchestrators, setOrchestrators] = useState<OrchestratorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedOrchestrators, setExpandedOrchestrators] = useState<Set<string>>(new Set())
  const [selectedDevice, setSelectedDevice] = useState<{
    orchestratorId: string
    orchestratorAgentId: string
    deviceId: string
    deviceName: string
  } | null>(null)

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
  const [pendingDeviceSwitch, setPendingDeviceSwitch] = useState<{
    orchestratorId: string
    orchestratorAgentId: string
    deviceId: string
    deviceName: string
  } | null>(null)

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

  const fetchOrchestrators = useCallback(async () => {
    try {
      const result = await orchestratorPort.listOrchestrators()
      setOrchestrators(result)
      setError(null)
    } catch (error) {
      console.error('[Orchestrators] Fetch failed', error)
      setError('Failed to load orchestrators. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [orchestratorPort])

  useEffect(() => {
    void fetchOrchestrators()
  }, [fetchOrchestrators])

  // Sync selectedDevice with runtimeConnection.selectedDevice on mount and when connection changes
  // This ensures the UI shows the connected device when reopening the orchestrators screen
  useEffect(() => {
    if (runtimeConnection.connectionStatus === 'connected' && runtimeConnection.selectedDevice) {
      setSelectedDevice({
        orchestratorId: runtimeConnection.selectedDevice.orchestratorId,
        orchestratorAgentId: runtimeConnection.selectedDevice.orchestratorAgentId,
        deviceId: runtimeConnection.selectedDevice.deviceId,
        deviceName: runtimeConnection.selectedDevice.deviceName,
      })
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
    (orchestratorId: string, orchestratorAgentId: string, deviceId: string, deviceName: string, isActive: boolean) => {
      // Prevent selection of inactive devices
      if (!isActive) {
        return
      }

      // If already connected to a different device, show confirmation modal
      if (
        runtimeConnection.connectionStatus === 'connected' &&
        runtimeConnection.selectedDevice &&
        runtimeConnection.selectedDevice.deviceId !== deviceId
      ) {
        setPendingDeviceSwitch({ orchestratorId, orchestratorAgentId, deviceId, deviceName })
        setShowSwitchConfirmModal(true)
        return
      }

      setSelectedDevice({ orchestratorId, orchestratorAgentId, deviceId, deviceName })
      setConnectionError(null)
    },
    [runtimeConnection.connectionStatus, runtimeConnection.selectedDevice],
  )

  const handleConnect = useCallback(async () => {
    if (!selectedDevice) return

    setIsConnecting(true)
    setConnectionError(null)
    deviceActions.setRuntimeConnectionStatus('connecting')

    try {
      // Store the selected device in the store
      deviceActions.setSelectedDevice({
        orchestratorId: selectedDevice.orchestratorId,
        orchestratorAgentId: selectedDevice.orchestratorAgentId,
        deviceId: selectedDevice.deviceId,
        deviceName: selectedDevice.deviceName,
      })

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
        deviceActions.setDeviceBoard(SIMULATOR_BOARD_NAME)
      })
      return
    }

    setSelectedDevice(null)
    setConnectionError(null)
    deviceActions.setDeviceBoard(SIMULATOR_BOARD_NAME)
  }, [runtimeConnection.connectionStatus, runtimeConnection.selectedDevice, deviceActions, handleDisconnect])

  // Enable timing stats in global polling when this screen is visible
  useEffect(() => {
    // Set the flag to include timing stats in the global status polling
    deviceActions.setIncludeTimingStatsInPolling(true)

    // Clear the flag when leaving this screen
    return () => {
      deviceActions.setIncludeTimingStatsInPolling(false)
    }
  }, [deviceActions])

  // Same pattern for EtherCAT runtime status. Only fetched while this screen
  // is mounted, so non-EtherCAT setups don't pay for the extra round-trip on
  // every poll.
  useEffect(() => {
    deviceActions.setIncludeEthercatStatsInPolling(true)
    return () => {
      deviceActions.setIncludeEthercatStatsInPolling(false)
    }
  }, [deviceActions])

  // Handle device switch confirmation
  const handleConfirmDeviceSwitch = useCallback(async () => {
    if (!pendingDeviceSwitch) return

    setShowSwitchConfirmModal(false)

    // Disconnect from current device first
    await handleDisconnect()

    // Select the new device
    setSelectedDevice(pendingDeviceSwitch)
    setPendingDeviceSwitch(null)
    setConnectionError(null)
  }, [pendingDeviceSwitch, handleDisconnect])

  const handleCancelDeviceSwitch = useCallback(() => {
    setShowSwitchConfirmModal(false)
    setPendingDeviceSwitch(null)
  }, [])

  return (
    <div className='flex h-full w-full flex-col'>
      <div className='min-h-0 flex-1'>
        <DeviceEditorSlot heading='Device Orchestrators'>
          <div id='orchestrators-container' className='flex h-full w-full flex-col gap-4'>
            <div id='orchestrators-header' className='flex items-center justify-between'>
              <p className='text-sm text-neutral-600 dark:text-neutral-400'>
                Select a device from your orchestrators to connect to.
              </p>
              <button
                type='button'
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                className={cn('group', isRefreshing && 'cursor-not-allowed opacity-50')}
                aria-label='Refresh orchestrators'
              >
                <RefreshIcon size='sm' className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>

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
                <p className='text-sm text-neutral-500 dark:text-neutral-400'>Loading orchestrators...</p>
              </div>
            )}

            {error && (
              <div className='rounded-md bg-red-50 p-4 dark:bg-red-900/20'>
                <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
              </div>
            )}

            {!loading && !error && orchestrators.length === 0 && (
              <div className='flex flex-col items-center justify-center gap-2 py-8'>
                <p className='text-sm text-neutral-500 dark:text-neutral-400'>No orchestrators found.</p>
                <p className='text-xs text-neutral-400 dark:text-neutral-500'>
                  Register an orchestrator in the Autonomy Edge platform to see it here.
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
                          {orchestrator.devices.length} device{orchestrator.devices.length !== 1 ? 's' : ''}
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
                                onClick={() =>
                                  handleDeviceSelect(
                                    orchestrator.id,
                                    orchestrator.agentId,
                                    device.id,
                                    device.name,
                                    device.active !== false,
                                  )
                                }
                              >
                                <span className='flex-1 text-sm text-neutral-800 dark:text-neutral-200'>
                                  {device.name}
                                </span>
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
                <ModalTitle className='hidden'>Switch Device</ModalTitle>
                <div className='flex select-none flex-col items-center gap-6 p-4'>
                  <WarningIcon className='h-[60px] w-[60px]' />
                  <div className='text-center'>
                    <p className='text-sm font-medium text-neutral-900 dark:text-neutral-100'>
                      You are currently connected to <strong>{runtimeConnection.selectedDevice?.deviceName}</strong>.
                    </p>
                    <p className='mt-2 text-sm text-neutral-600 dark:text-neutral-400'>
                      To connect to <strong>{pendingDeviceSwitch?.deviceName}</strong>, you must disconnect from the
                      current device first.
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
      {runtimeConnection.connectionStatus === 'connected' && (
        <div
          id='scan-cycle-stats-panel'
          className='flex w-full shrink-0 flex-col gap-6 overflow-y-auto overflow-x-hidden p-4 lg:px-8 lg:py-4'
        >
          {runtimeConnection.timingStats && <ScanCycleStats timingStats={runtimeConnection.timingStats} />}
          <EtherCATStats />
          <PluginStatsPanel pluginStats={runtimeConnection.timingStats?.plugin_stats} />
        </div>
      )}
    </div>
  )
}

export { OrchestratorsList }
