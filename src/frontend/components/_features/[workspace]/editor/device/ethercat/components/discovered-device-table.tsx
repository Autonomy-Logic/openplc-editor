import { getBestMatchQuality } from '@root/backend/shared/ethercat/device-matcher'
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { cn } from '@root/frontend/utils/cn'
import type { ScannedDeviceMatch } from '@root/middleware/shared/ports/esi-types'

type DiscoveredDeviceTableProps = {
  deviceMatches: ScannedDeviceMatch[]
  selectedDevices: Set<number>
  onSelectDevice: (position: number, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  isScanning: boolean
}

/**
 * Discovered Device Table Component
 *
 * Displays scanned EtherCAT devices with match indicators and selection checkboxes.
 */
const DiscoveredDeviceTable = ({
  deviceMatches,
  selectedDevices,
  onSelectDevice,
  onSelectAll,
  isScanning,
}: DiscoveredDeviceTableProps) => {
  // All scanned devices are selectable. Devices without a repository match get
  // a visual "No XML" hint — they're still selectable, but on "Add Selected"
  // the parent opens a modal explaining they can't be added until the ESI XML
  // is imported in the Repository tab.
  const allSelected = deviceMatches.length > 0 && deviceMatches.every((dm) => selectedDevices.has(dm.device.position))
  const someSelected = deviceMatches.some((dm) => selectedDevices.has(dm.device.position))

  const handleSelectAll = () => {
    onSelectAll(!allSelected)
  }

  return (
    <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
      <table className='w-full'>
        <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
          <tr>
            <th className='w-[40px] px-2 py-2'>
              <Checkbox
                checked={someSelected && !allSelected ? 'indeterminate' : allSelected}
                onCheckedChange={handleSelectAll}
                disabled={deviceMatches.length === 0}
              />
            </th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Pos</th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Name</th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Vendor</th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Product</th>
          </tr>
        </thead>
        <tbody>
          {deviceMatches.length === 0 ? (
            <tr>
              <td colSpan={5} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                {isScanning
                  ? 'Scanning for devices...'
                  : 'No devices found. Click "Scan" to discover EtherCAT devices on the network.'}
              </td>
            </tr>
          ) : (
            deviceMatches.map((dm) => {
              const bestQuality = getBestMatchQuality(dm.matches)
              const bestMatch = dm.matches.length > 0 ? dm.matches[0] : null
              const displayName = bestMatch?.esiDevice?.name || dm.device.name
              const hasNoXml = bestQuality === 'none'
              const isSelected = selectedDevices.has(dm.device.position)

              return (
                <tr
                  key={dm.device.position}
                  onClick={() => onSelectDevice(dm.device.position, !isSelected)}
                  className={cn(
                    'cursor-pointer border-b border-neutral-200 transition-colors dark:border-neutral-800',
                    'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                    isSelected && 'bg-brand/10 dark:bg-brand/20',
                  )}
                >
                  <td className='px-2 py-2'>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => onSelectDevice(dm.device.position, !!checked)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select device at position ${dm.device.position}`}
                    />
                  </td>
                  <td className='px-2 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300'>
                    {dm.device.position}
                  </td>
                  <td
                    className='whitespace-nowrap px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'
                    title={hasNoXml ? `${displayName} — no ESI XML in repository` : displayName}
                  >
                    <span className='inline-flex items-center gap-2'>
                      {displayName}
                      {hasNoXml && (
                        <span
                          className='rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 dark:bg-neutral-700/60 dark:text-neutral-300'
                          title='ESI XML not in repository — import it from the Repository tab before adding.'
                        >
                          No XML
                        </span>
                      )}
                    </span>
                  </td>
                  <td className='px-2 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                    0x{dm.device.vendor_id.toString(16).padStart(4, '0').toUpperCase()}
                  </td>
                  <td className='px-2 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                    0x{dm.device.product_code.toString(16).padStart(8, '0').toUpperCase()}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export { DiscoveredDeviceTable }
