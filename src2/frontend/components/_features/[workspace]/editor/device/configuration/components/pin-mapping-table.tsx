import { GenericTable } from '../../../../../../../_atoms/generic-table'
import {
  PinComboboxInputCell,
  PinSelectInputCell,
  PinTextInputCell,
} from '../../../../../../../_molecules/pin-mapping-table'
import { pinSelectors } from '../../../../../../../../hooks/use-store-selectors'
import type { DevicePin } from '../../../../../../../../../middleware/shared/ports/types'
import { createColumnHelper } from '@tanstack/react-table'

const columnHelper = createColumnHelper<DevicePin>()

const columns = [
  columnHelper.accessor('pin', {
    header: 'Pin',
    cell: PinComboboxInputCell,
  }),
  columnHelper.accessor('pinType', {
    header: 'Type',
    cell: PinSelectInputCell,
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
  const updatePin = pinSelectors.useUpdatePin()

  const handleUpdateDataRequest = (_rowIndex: number, columnId: string, value: unknown) => {
    const res = updatePin({
      [columnId as keyof DevicePin]: value,
    })
    return res
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
