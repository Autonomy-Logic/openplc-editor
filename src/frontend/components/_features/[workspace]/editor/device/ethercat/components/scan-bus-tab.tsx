import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import TableActions from '@root/frontend/components/_atoms/table-actions'
import { cn } from '@root/frontend/utils/cn'
import type {
  ConfiguredEtherCATDevice,
  ESIDeviceRef,
  ESIDeviceSummary,
  ESIRepositoryItemLight,
  ScannedDeviceMatch,
} from '@root/middleware/shared/ports/esi-types'
import type { EtherCATDevice, NetworkInterface } from '@root/middleware/shared/ports/ethercat-types'
import { useState } from 'react'

import { DeviceBrowserModal } from './device-browser-modal'
import { DiscoveredDeviceTable } from './discovered-device-table'
import { InterfaceSelector } from './interface-selector'

type ScanBusTabProps = {
  isConnectedToRuntime: boolean
  // Service status
  serviceAvailable: boolean | null
  serviceMessage: string
  // Network interfaces
  interfaces: NetworkInterface[]
  selectedInterface: string
  onSelectInterface: (value: string) => void
  isLoadingInterfaces: boolean
  interfaceError: string | null
  // Scan
  isScanning: boolean
  scanError: string | null
  scanTimeMs: number | null
  scanMessage: string
  scannedDevices: EtherCATDevice[]
  onScan: () => void
  // Match results
  deviceMatches: ScannedDeviceMatch[]
  // Selection
  selectedScannedDevices: Set<number>
  onSelectScannedDevice: (position: number, selected: boolean) => void
  onSelectAllScanned: (selected: boolean) => void
  onAddSelectedFromScan: () => void
  // Configured devices & manual add/remove
  configuredDevices: ConfiguredEtherCATDevice[]
  repository: ESIRepositoryItemLight[]
  onAddDeviceFromBrowser: (ref: ESIDeviceRef, device: ESIDeviceSummary, repoItem: ESIRepositoryItemLight) => void
  onRemoveDevice: (deviceId: string) => void
}

const ScanBusTab = ({
  isConnectedToRuntime,
  serviceAvailable,
  serviceMessage,
  interfaces,
  selectedInterface,
  onSelectInterface,
  isLoadingInterfaces,
  interfaceError,
  isScanning,
  scanError,
  scanTimeMs,
  scanMessage,
  onScan,
  deviceMatches,
  selectedScannedDevices,
  onSelectScannedDevice,
  onSelectAllScanned,
  onAddSelectedFromScan,
  configuredDevices,
  repository,
  onAddDeviceFromBrowser,
  onRemoveDevice,
}: ScanBusTabProps) => {
  const [isDeviceBrowserOpen, setIsDeviceBrowserOpen] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  return (
    <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
      {/* Service not available state */}
      {isConnectedToRuntime && serviceAvailable === false && (
        <div className='mb-4 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 dark:border-yellow-700 dark:bg-yellow-900/20'>
          <p className='text-sm font-medium text-yellow-700 dark:text-yellow-300'>
            EtherCAT Discovery Service Not Available
          </p>
          <p className='mt-1 max-w-md text-xs text-yellow-600 dark:text-yellow-400'>{serviceMessage}</p>
        </div>
      )}

      {/* Interface Selection and Scan Controls */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='mb-4 flex flex-wrap items-end gap-4'>
          <InterfaceSelector
            interfaces={interfaces}
            selectedInterface={selectedInterface}
            onSelectInterface={onSelectInterface}
            isLoading={isLoadingInterfaces}
            error={interfaceError}
          />

          <button
            onClick={onScan}
            disabled={isScanning || !selectedInterface || !isConnectedToRuntime || serviceAvailable === false}
            className={cn(
              'flex h-[30px] items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
              'bg-brand text-white hover:bg-brand-medium-dark',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {isScanning ? (
              <>
                <ArrowIcon size='sm' className='animate-spin stroke-white' />
                Scanning...
              </>
            ) : (
              'Scan'
            )}
          </button>

          {scanTimeMs !== null && (
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              Completed in {scanTimeMs}ms{scanMessage ? ` — ${scanMessage}` : ''}
            </span>
          )}
        </div>

        {/* Error/Status Messages */}
        {scanError && (
          <div className='mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20'>
            <p className='text-sm text-red-700 dark:text-red-300'>{scanError}</p>
          </div>
        )}

        {/* Side-by-side: Scanned Devices (left) + Configured Devices (right) */}
        <div className='flex min-h-0 flex-1 gap-4'>
          {/* Scanned Devices — left */}
          <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
            <div className='mb-2 flex h-[28px] items-center justify-between'>
              <h3 className='text-sm font-medium text-neutral-950 dark:text-neutral-100'>Scanned Devices</h3>
              <button
                onClick={onAddSelectedFromScan}
                disabled={selectedScannedDevices.size === 0}
                className={cn(
                  'flex h-7 items-center rounded-md bg-brand px-3 text-xs font-medium text-white transition-colors',
                  'hover:bg-brand-medium-dark',
                  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand',
                )}
              >
                Add Selected{selectedScannedDevices.size > 0 ? ` (${selectedScannedDevices.size})` : ''}
              </button>
            </div>
            <DiscoveredDeviceTable
              deviceMatches={deviceMatches}
              selectedDevices={selectedScannedDevices}
              onSelectDevice={onSelectScannedDevice}
              onSelectAll={onSelectAllScanned}
              isScanning={isScanning}
            />
          </div>

          {/* Configured Devices — right */}
          <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
            {/* Header with +/- actions */}
            <div className='mb-2 flex h-[28px] items-center justify-between'>
              <h3 className='text-sm font-medium text-neutral-950 dark:text-neutral-100'>
                Configured Devices
                {configuredDevices.length > 0 && (
                  <span className='ml-1 font-normal text-neutral-500'>({configuredDevices.length})</span>
                )}
              </h3>
              <TableActions
                actions={[
                  {
                    ariaLabel: 'Add Device',
                    onClick: () => setIsDeviceBrowserOpen(true),
                    icon: <PlusIcon className='h-4 w-4 stroke-brand' />,
                    id: 'add-ethercat-device-button',
                  },
                  {
                    ariaLabel: 'Remove Device',
                    onClick: () => {
                      if (selectedDeviceId) {
                        onRemoveDevice(selectedDeviceId)
                        setSelectedDeviceId(null)
                      }
                    },
                    disabled: !selectedDeviceId,
                    icon: <MinusIcon className='h-4 w-4 stroke-brand' />,
                    id: 'remove-ethercat-device-button',
                  },
                ]}
                buttonProps={{
                  className:
                    'rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed',
                }}
              />
            </div>

            {/* Device table */}
            <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
              <table className='w-full'>
                <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
                  <tr>
                    <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                      Pos
                    </th>
                    <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                      Name
                    </th>
                    <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                      Vendor
                    </th>
                    <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                      Product
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {configuredDevices.length === 0 ? (
                    <tr>
                      <td colSpan={4} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                        No devices configured. Click + to add a device from the repository.
                      </td>
                    </tr>
                  ) : (
                    configuredDevices.map((device) => {
                      const isActive = device.id === selectedDeviceId

                      return (
                        <tr
                          key={device.id}
                          onClick={() => setSelectedDeviceId(device.id === selectedDeviceId ? null : device.id)}
                          className={cn(
                            'cursor-pointer border-b border-neutral-200 transition-colors dark:border-neutral-800',
                            isActive
                              ? 'bg-brand/10 dark:bg-brand/20'
                              : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                          )}
                        >
                          <td className='px-2 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300'>
                            {device.position ?? '-'}
                          </td>
                          <td className='whitespace-nowrap px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'>
                            {device.name}
                          </td>
                          <td className='px-2 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                            0x{parseInt(device.vendorId, 16).toString(16).padStart(4, '0').toUpperCase()}
                          </td>
                          <td className='px-2 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                            0x{parseInt(device.productCode, 16).toString(16).padStart(8, '0').toUpperCase()}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Device Browser Modal */}
      <DeviceBrowserModal
        isOpen={isDeviceBrowserOpen}
        onClose={() => setIsDeviceBrowserOpen(false)}
        onSelectDevice={onAddDeviceFromBrowser}
        repository={repository}
      />
    </div>
  )
}

export { ScanBusTab }
