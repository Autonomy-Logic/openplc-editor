import type { ESIDevice, ESIFile } from '@root/types/ethercat/esi-types'
import { cn } from '@root/utils'
import { getDeviceSummary } from '@root/utils/ethercat/esi-parser'

type ESIDeviceInfoProps = {
  esiFile: ESIFile
  selectedDeviceIndex: number
  onSelectDevice: (index: number) => void
}

/**
 * ESI Device Info Component
 *
 * Displays vendor information and device details from an ESI file.
 */
const ESIDeviceInfo = ({ esiFile, selectedDeviceIndex, onSelectDevice }: ESIDeviceInfoProps) => {
  const selectedDevice: ESIDevice | undefined = esiFile.devices[selectedDeviceIndex]
  const summary = selectedDevice ? getDeviceSummary(selectedDevice) : null

  return (
    <div className='flex flex-col gap-4'>
      {/* Vendor Information */}
      <div className='rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
        <h4 className='mb-2 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>Vendor</h4>
        <div className='grid grid-cols-2 gap-2 text-sm'>
          <div>
            <span className='text-neutral-500 dark:text-neutral-400'>Name: </span>
            <span className='font-medium text-neutral-700 dark:text-neutral-300'>{esiFile.vendor.name}</span>
          </div>
          <div>
            <span className='text-neutral-500 dark:text-neutral-400'>ID: </span>
            <span className='font-mono text-neutral-700 dark:text-neutral-300'>{esiFile.vendor.id}</span>
          </div>
        </div>
      </div>

      {/* Device Selector (if multiple devices) */}
      {esiFile.devices.length > 1 && (
        <div className='flex flex-col gap-2'>
          <label className='text-xs font-medium text-neutral-950 dark:text-white'>Select Device</label>
          <div className='flex flex-wrap gap-2'>
            {esiFile.devices.map((device, index) => (
              <button
                key={index}
                onClick={() => onSelectDevice(index)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  selectedDeviceIndex === index
                    ? 'border-brand bg-brand text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:border-brand hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800',
                )}
              >
                {device.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected Device Information */}
      {selectedDevice && (
        <div className='rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900'>
          <div className='mb-3 flex items-start justify-between'>
            <div>
              <h3 className='text-base font-semibold text-neutral-900 dark:text-neutral-100'>{selectedDevice.name}</h3>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>{selectedDevice.type.name}</p>
            </div>
            {selectedDevice.groupName && (
              <span className='rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'>
                {selectedDevice.groupName}
              </span>
            )}
          </div>

          {/* Device Details Grid */}
          <div className='grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-4'>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Product Code</span>
              <p className='font-mono font-medium text-neutral-700 dark:text-neutral-300'>
                {selectedDevice.type.productCode}
              </p>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Revision</span>
              <p className='font-mono font-medium text-neutral-700 dark:text-neutral-300'>
                {selectedDevice.type.revisionNo}
              </p>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>Physics</span>
              <p className='font-medium text-neutral-700 dark:text-neutral-300'>{selectedDevice.physics || 'N/A'}</p>
            </div>
            <div>
              <span className='text-neutral-500 dark:text-neutral-400'>CoE Support</span>
              <p className='font-medium text-neutral-700 dark:text-neutral-300'>{summary?.hasCoe ? 'Yes' : 'No'}</p>
            </div>
          </div>

          {/* I/O Summary */}
          {summary && (
            <div className='mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-700'>
              <h4 className='mb-2 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>I/O Summary</h4>
              <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
                <div className='rounded-md bg-green-50 p-2 dark:bg-green-900/20'>
                  <p className='text-lg font-bold text-green-700 dark:text-green-400'>{summary.inputChannelCount}</p>
                  <p className='text-xs text-green-600 dark:text-green-500'>Input Channels</p>
                </div>
                <div className='rounded-md bg-blue-50 p-2 dark:bg-blue-900/20'>
                  <p className='text-lg font-bold text-blue-700 dark:text-blue-400'>{summary.outputChannelCount}</p>
                  <p className='text-xs text-blue-600 dark:text-blue-500'>Output Channels</p>
                </div>
                <div className='rounded-md bg-neutral-100 p-2 dark:bg-neutral-800'>
                  <p className='text-lg font-bold text-neutral-700 dark:text-neutral-300'>
                    {summary.totalInputBytes} B
                  </p>
                  <p className='text-xs text-neutral-500 dark:text-neutral-400'>Input Size</p>
                </div>
                <div className='rounded-md bg-neutral-100 p-2 dark:bg-neutral-800'>
                  <p className='text-lg font-bold text-neutral-700 dark:text-neutral-300'>
                    {summary.totalOutputBytes} B
                  </p>
                  <p className='text-xs text-neutral-500 dark:text-neutral-400'>Output Size</p>
                </div>
              </div>
            </div>
          )}

          {/* Sync Managers */}
          {selectedDevice.syncManagers.length > 0 && (
            <div className='mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-700'>
              <h4 className='mb-2 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>
                Sync Managers
              </h4>
              <div className='flex flex-wrap gap-2'>
                {selectedDevice.syncManagers.map((sm) => (
                  <div
                    key={sm.index}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs',
                      sm.type === 'Inputs' || sm.type === 'MbxIn'
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                        : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
                    )}
                  >
                    SM{sm.index}: {sm.type}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {selectedDevice.description && (
            <div className='mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-700'>
              <h4 className='mb-1 text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400'>Description</h4>
              <p className='text-xs text-neutral-600 dark:text-neutral-400'>{selectedDevice.description}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { ESIDeviceInfo }
