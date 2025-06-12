import { GenericTable } from '@root/renderer/components/_atoms/generic-table'
import { PinTextInputCell } from '@root/renderer/components/_molecules/pin-mapping-table'
import type { DevicePin } from '@root/renderer/store/slices/device'
import { createColumnHelper } from '@tanstack/react-table'
import { startCase } from 'lodash'

const columnHelper = createColumnHelper<DevicePin>()

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
    cell: PinTextInputCell,
  }),
]

type PinMappingTableProps = {
  pins: DevicePin[]
  selectedRowId: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const PinMappingTable = ({ pins, selectedRowId, handleRowClick }: PinMappingTableProps) => {
  const handleUpdateDataRequest = (rowIndex: number, columnId: string, value: unknown) => {
    console.log(rowIndex, columnId, value)
    return { ok: false }
  }
  return (
    <GenericTable<DevicePin>
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
