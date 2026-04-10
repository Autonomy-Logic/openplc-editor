import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import TableActions from '@root/frontend/components/_atoms/table-actions'
import { cn } from '@root/frontend/utils/cn'
import type {
  ConfiguredEtherCATDevice,
  EnrichDeviceData,
  ESIDeviceRef,
  ESIDeviceSummary,
  ESIRepositoryItemLight,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  SDOConfigurationEntry,
} from '@root/types/ethercat/esi-types'
import { useCallback, useMemo, useState } from 'react'

import { DeviceBrowserModal } from './device-browser-modal'
import { DeviceDetailPanel } from './device-detail-panel'
import { ESIRepository } from './esi-repository'

type DevicesTabProps = {
  devices: ConfiguredEtherCATDevice[]
  repository: ESIRepositoryItemLight[]
  onRepositoryChange: (items: ESIRepositoryItemLight[]) => void
  projectPath: string
  isLoadingRepository: boolean
  repositoryError: string | null
  onRetryRepository: () => void
  usedAddresses: Set<string>
  onAddDeviceFromBrowser: (
    ref: ESIDeviceRef,
    device: ESIDeviceSummary,
    repoItem: ESIRepositoryItemLight,
  ) => void | Promise<void>
  onRemoveDevice: (deviceId: string) => void
  onUpdateDevice: (deviceId: string, config: EtherCATSlaveConfig) => void
  onUpdateChannelMappings: (deviceId: string, mappings: EtherCATChannelMapping[]) => void
  onEnrichDevice: (deviceId: string, data: EnrichDeviceData) => void
  onUpdateSdoConfigurations: (deviceId: string, configs: SDOConfigurationEntry[]) => void
}

const DevicesTab = ({
  devices,
  repository,
  onRepositoryChange,
  projectPath,
  isLoadingRepository,
  repositoryError,
  onRetryRepository,
  usedAddresses,
  onAddDeviceFromBrowser,
  onRemoveDevice,
  onUpdateDevice,
  onUpdateChannelMappings,
  onEnrichDevice,
  onUpdateSdoConfigurations,
}: DevicesTabProps) => {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [isDeviceBrowserOpen, setIsDeviceBrowserOpen] = useState(false)
  const [showRepository, setShowRepository] = useState(false)

  const selectedDevice = useMemo(() => {
    return devices.find((d) => d.id === selectedDeviceId) ?? null
  }, [devices, selectedDeviceId])

  // Auto-select first device if current selection is invalid
  const effectiveSelectedId = selectedDevice ? selectedDeviceId : devices.length > 0 ? devices[0].id : null

  const effectiveDevice = useMemo(() => {
    return devices.find((d) => d.id === effectiveSelectedId) ?? null
  }, [devices, effectiveSelectedId])

  const handleRemoveSelected = useCallback(() => {
    if (effectiveSelectedId) {
      onRemoveDevice(effectiveSelectedId)
      setSelectedDeviceId(null)
    }
  }, [effectiveSelectedId, onRemoveDevice])

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
      {/* Repository Section (collapsible) */}
      <div className='shrink-0'>
        <button
          onClick={() => setShowRepository(!showRepository)}
          className='mb-2 flex items-center gap-2 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
        >
          <svg
            className={cn('h-3 w-3 transition-transform', showRepository && 'rotate-90')}
            viewBox='0 0 12 12'
            fill='currentColor'
          >
            <path d='M4 2l4 4-4 4V2z' />
          </svg>
          ESI Repository
          {repository.length > 0 && (
            <span className='rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] dark:bg-neutral-700'>
              {repository.length}
            </span>
          )}
        </button>

        {showRepository && (
          <div className='max-h-[300px] overflow-auto rounded-lg border border-neutral-200 p-3 dark:border-neutral-800'>
            {repositoryError && (
              <div className='mb-3 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
                <p className='text-sm text-red-700 dark:text-red-300'>Failed to load repository: {repositoryError}</p>
                <button
                  onClick={onRetryRepository}
                  className='text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300'
                >
                  Retry
                </button>
              </div>
            )}
            <ESIRepository
              repository={repository}
              onRepositoryChange={onRepositoryChange}
              projectPath={projectPath}
              isLoading={isLoadingRepository}
            />
          </div>
        )}
      </div>

      {/* Configured Devices - Split Pane */}
      <div className='flex min-h-0 flex-1 gap-4 overflow-hidden'>
        {/* Left Panel - Device List */}
        <div className='flex w-[280px] shrink-0 flex-col rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'>
          {/* Header */}
          <div className='flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
            <h3 className='text-xs font-semibold text-neutral-700 dark:text-neutral-300'>
              Configured Devices
              {devices.length > 0 && <span className='ml-1 font-normal text-neutral-500'>({devices.length})</span>}
            </h3>
            <TableActions
              actions={[
                {
                  ariaLabel: 'Add Device',
                  onClick: () => setIsDeviceBrowserOpen(true),
                  icon: <PlusIcon className='h-3.5 w-3.5 stroke-brand' />,
                  id: 'add-device-button',
                },
                {
                  ariaLabel: 'Remove Device',
                  onClick: handleRemoveSelected,
                  disabled: !effectiveSelectedId,
                  icon: <MinusIcon className='h-3.5 w-3.5 stroke-brand' />,
                  id: 'remove-device-button',
                },
              ]}
              buttonProps={{
                className:
                  'rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed',
              }}
            />
          </div>

          {/* Device List */}
          <div className='flex-1 overflow-y-auto'>
            {devices.length === 0 ? (
              <div className='flex h-full items-center justify-center p-4'>
                <p className='text-center text-xs text-neutral-500 dark:text-neutral-400'>
                  No devices configured. Click + to add a device from the repository.
                </p>
              </div>
            ) : (
              devices.map((device) => {
                const isActive = device.id === effectiveSelectedId
                const repoItem = repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
                const esiDevice = repoItem?.devices[device.esiDeviceRef.deviceIndex]

                return (
                  <button
                    key={device.id}
                    onClick={() => setSelectedDeviceId(device.id)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b border-neutral-100 px-3 py-2 text-left transition-colors dark:border-neutral-800',
                      isActive ? 'bg-brand/10 dark:bg-brand/20' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                    )}
                  >
                    <div className='flex items-center gap-2'>
                      <span
                        className={cn(
                          'text-xs font-medium',
                          isActive
                            ? 'text-brand-medium dark:text-brand-light'
                            : 'text-neutral-950 dark:text-neutral-100',
                        )}
                      >
                        {device.name}
                      </span>
                      <span
                        className={cn(
                          'inline-block rounded px-1 py-0.5 text-[10px] font-medium',
                          device.addedFrom === 'scan'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                        )}
                      >
                        {device.addedFrom === 'scan' ? 'Scan' : 'Manual'}
                      </span>
                    </div>
                    <span className='text-[10px] text-neutral-500 dark:text-neutral-400'>
                      {esiDevice?.name || 'Unknown type'}
                    </span>
                    <span className='text-[10px] text-neutral-400 dark:text-neutral-500'>
                      Pos: {device.position ?? '-'} | I/O:{' '}
                      {esiDevice ? `${esiDevice.inputChannelCount}/${esiDevice.outputChannelCount}` : '-'}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right Panel - Device Detail */}
        <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
          {effectiveDevice ? (
            <DeviceDetailPanel
              key={effectiveDevice.id}
              device={effectiveDevice}
              repository={repository}
              projectPath={projectPath}
              usedAddresses={usedAddresses}
              onUpdateDevice={(config) => onUpdateDevice(effectiveDevice.id, config)}
              onUpdateChannelMappings={(mappings) => onUpdateChannelMappings(effectiveDevice.id, mappings)}
              onEnrichDevice={(data) => onEnrichDevice(effectiveDevice.id, data)}
              onUpdateSdoConfigurations={(configs) => onUpdateSdoConfigurations(effectiveDevice.id, configs)}
            />
          ) : (
            <div className='flex h-full items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700'>
              <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                Select a device from the list or add a new one
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Device Browser Modal */}
      <DeviceBrowserModal
        isOpen={isDeviceBrowserOpen}
        onClose={() => setIsDeviceBrowserOpen(false)}
        onSelectDevice={(...args) => void onAddDeviceFromBrowser(...args)}
        repository={repository}
      />
    </div>
  )
}

export { DevicesTab }
