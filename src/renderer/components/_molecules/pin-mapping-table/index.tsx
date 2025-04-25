import type { DevicePin } from '@root/renderer/store/slices/device'
import { createColumnHelper } from '@tanstack/react-table'

const columnHelper = createColumnHelper<DevicePin>()

const _columns = [
  columnHelper.accessor('pin', {
    header: 'Pin',
    size: 64,
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    size: 64,
  }),
  columnHelper.accessor('address', {
    header: 'Address',
    size: 64,
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    size: 64,
  }),
]

const PinMappingTable = () => {
  return (
    <div id='Pin mapping table container' className='m-8 h-full w-full rounded-lg border-neutral-600 p-4'>
      <p>Here goes the table components</p>
    </div>
  )
}

export { PinMappingTable }
