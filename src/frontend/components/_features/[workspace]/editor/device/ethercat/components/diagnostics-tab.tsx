import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { cn } from '@root/frontend/utils/cn'
import type { ScannedDeviceMatch } from '@root/middleware/shared/ports/esi-types'
import type { EtherCATDevice, NetworkInterface } from '@root/middleware/shared/ports/ethercat-types'

import { DiscoveredDeviceTable } from './discovered-device-table'
import { InterfaceSelector } from './interface-selector'
import { RuntimeStatusPanel } from './runtime-status-panel'

type DiagnosticsTabProps = {
  isConnectedToRuntime: boolean
  ipAddress: string | null
  jwtToken: string | null
  /** Master name to filter status from multi-master response */
  masterName?: string
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
  matchCounts: { total: number; exact: number; partial: number; none: number }
  // Selection
  selectedScannedDevices: Set<number>
  onSelectScannedDevice: (position: number, selected: boolean) => void
  onSelectAllScanned: (selected: boolean) => void
  onAddSelectedFromScan: () => void
}

const DiagnosticsTab = ({
  isConnectedToRuntime,
  ipAddress,
  jwtToken,
  masterName,
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
  matchCounts,
  selectedScannedDevices,
  onSelectScannedDevice,
  onSelectAllScanned,
  onAddSelectedFromScan,
}: DiagnosticsTabProps) => {
  return (
    <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
      {/* Runtime Status */}
      {isConnectedToRuntime && ipAddress && jwtToken && (
        <RuntimeStatusPanel
          ipAddress={ipAddress}
          jwtToken={jwtToken}
          isConnected={isConnectedToRuntime}
          masterName={masterName}
        />
      )}

      {/* Not connected state */}
      {!isConnectedToRuntime && (
        <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700'>
          <div className='text-center'>
            <p className='text-sm font-medium text-neutral-700 dark:text-neutral-300'>Not connected to runtime</p>
            <p className='mt-1 text-xs text-neutral-500 dark:text-neutral-400'>
              Connect to the OpenPLC Runtime to scan for EtherCAT devices.
            </p>
          </div>
        </div>
      )}

      {/* Service not available state */}
      {isConnectedToRuntime && serviceAvailable === false && (
        <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20'>
          <div className='text-center'>
            <p className='text-sm font-medium text-yellow-700 dark:text-yellow-300'>
              EtherCAT Discovery Service Not Available
            </p>
            <p className='mt-1 max-w-md text-xs text-yellow-600 dark:text-yellow-400'>{serviceMessage}</p>
          </div>
        </div>
      )}

      {/* Connected state - Discovery */}
      {isConnectedToRuntime && serviceAvailable !== false && (
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Interface Selection and Scan Controls */}
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
              disabled={isScanning || !selectedInterface}
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

          {/* Match summary */}
          {deviceMatches.length > 0 && (
            <div className='mb-4 flex items-center justify-between'>
              <div className='flex items-center gap-4'>
                <span className='text-sm text-neutral-700 dark:text-neutral-300'>
                  Found {matchCounts.total} device(s):
                </span>
                <span className='text-xs text-green-600 dark:text-green-400'>{matchCounts.exact} exact</span>
                <span className='text-xs text-yellow-600 dark:text-yellow-400'>{matchCounts.partial} partial</span>
                <span className='text-xs text-red-600 dark:text-red-400'>{matchCounts.none} no match</span>
              </div>
              {selectedScannedDevices.size > 0 && (
                <button
                  onClick={onAddSelectedFromScan}
                  className='rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-medium-dark'
                >
                  Add Selected ({selectedScannedDevices.size})
                </button>
              )}
            </div>
          )}

          {/* Discovered Devices Table */}
          <DiscoveredDeviceTable
            deviceMatches={deviceMatches}
            selectedDevices={selectedScannedDevices}
            onSelectDevice={onSelectScannedDevice}
            onSelectAll={onSelectAllScanned}
            isScanning={isScanning}
          />
        </div>
      )}
    </div>
  )
}

export { DiagnosticsTab }
