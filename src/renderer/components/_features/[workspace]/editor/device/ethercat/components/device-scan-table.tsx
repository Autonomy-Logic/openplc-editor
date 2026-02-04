import type { EtherCATDevice } from '@root/types/ethercat'
import { cn } from '@root/utils'

type DeviceScanTableProps = {
  devices: EtherCATDevice[]
  selectedPosition: number | null
  onSelectDevice: (position: number) => void
  isScanning: boolean
}

/**
 * Get CSS class for EtherCAT state badge
 */
const getStateBadgeClass = (state: EtherCATDevice['state']) => {
  switch (state) {
    case 'OP':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    case 'SAFE-OP':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    case 'PRE-OP':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    case 'INIT':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    case 'BOOT':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
    case 'NONE':
    case 'UNKNOWN':
    default:
      return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400'
  }
}

/**
 * Table displaying discovered EtherCAT devices
 */
const DeviceScanTable = ({ devices, selectedPosition, onSelectDevice, isScanning }: DeviceScanTableProps) => {
  return (
    <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
      <table className='w-full table-fixed'>
        <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
          <tr>
            <th className='w-[8%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              Pos
            </th>
            <th className='w-[20%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              Name
            </th>
            <th className='w-[12%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              Vendor
            </th>
            <th className='w-[15%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              Product
            </th>
            <th className='w-[10%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              State
            </th>
            <th className='w-[10%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
              CoE
            </th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>I/O Size</th>
          </tr>
        </thead>
        <tbody>
          {isScanning ? (
            <tr>
              <td colSpan={7} className='px-4 py-8 text-center'>
                <div className='flex flex-col items-center gap-2'>
                  <div className='h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent' />
                  <span className='text-sm text-neutral-500 dark:text-neutral-400'>Scanning for devices...</span>
                </div>
              </td>
            </tr>
          ) : devices.length === 0 ? (
            <tr>
              <td colSpan={7} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                No devices found. Select an interface and click "Scan Devices".
              </td>
            </tr>
          ) : (
            devices.map((device) => (
              <tr
                key={device.position}
                onClick={() => onSelectDevice(device.position)}
                className={cn(
                  'cursor-pointer border-b border-neutral-200 transition-colors dark:border-neutral-800',
                  'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                  selectedPosition === device.position && 'bg-brand/10 dark:bg-brand/20',
                )}
              >
                <td className='px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'>
                  {device.position}
                </td>
                <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300' title={device.name}>
                  <span className='block truncate'>{device.name}</span>
                </td>
                <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>
                  0x{device.vendor_id.toString(16).toUpperCase().padStart(4, '0')}
                </td>
                <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>
                  0x{device.product_code.toString(16).toUpperCase().padStart(8, '0')}
                </td>
                <td className='px-2 py-2'>
                  <span
                    className={cn(
                      'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
                      getStateBadgeClass(device.state),
                    )}
                  >
                    {device.state}
                  </span>
                </td>
                <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>
                  {device.has_coe ? 'Yes' : 'No'}
                </td>
                <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>
                  {device.input_bytes}B / {device.output_bytes}B
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export { DeviceScanTable }
