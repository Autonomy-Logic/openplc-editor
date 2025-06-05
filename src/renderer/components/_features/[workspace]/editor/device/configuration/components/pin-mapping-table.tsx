import { GenericTable } from '@root/renderer/components/_atoms/generic-table'
import type { DevicePin } from '@root/renderer/store/slices/device'
import { createColumnHelper } from '@tanstack/react-table'
import { startCase } from 'lodash'

type DevicePinColumns = DevicePin & {
  pinType?: 'digitalInput' | 'digitalOutput' | 'analogInput' | 'analogOutput'
}

const columnHelper = createColumnHelper<DevicePinColumns>()

const columns = [
  columnHelper.accessor('pin', {
    header: 'Pin',
    cell: (props) => props.getValue(),
  }),
  columnHelper.accessor('pinType', {
    header: 'Type',
    cell: (props) => startCase(props.getValue()),
  }),
  columnHelper.accessor('address', {
    header: 'Address',
    cell: (props) => props.getValue(),
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (props) => props.getValue(),
  }),
]

type PinMappingTableProps = {
  pins: DevicePinColumns[]
  selectedRowId: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const PinMappingTable = ({ pins, selectedRowId, handleRowClick }: PinMappingTableProps) => {
  const handleUpdateDataRequest = (rowIndex: number, columnId: string, value: unknown) =>
    console.log(rowIndex, columnId, value)
  return (
    <GenericTable<DevicePinColumns>
      columns={columns}
      tableData={pins}
      selectedRow={selectedRowId}
      handleRowClick={handleRowClick}
      updateData={handleUpdateDataRequest}
      tableContext='Pin mapping table'
    />
  )
}

export { PinMappingTable }
