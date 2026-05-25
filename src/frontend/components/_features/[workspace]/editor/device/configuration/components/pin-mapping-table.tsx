import { pinSelectors } from '@root/frontend/hooks/use-store-selectors'
import { useOpenPLCStore } from '@root/frontend/store'
import type { DevicePin } from '@root/middleware/shared/ports/types'
import { createColumnHelper } from '@tanstack/react-table'

import { GenericTable } from '../../../../../../_atoms/generic-table'
import { PinComboboxInputCell } from '../../../../../../_molecules/pin-mapping-table/combobox-input'
import { PinSelectInputCell } from '../../../../../../_molecules/pin-mapping-table/select-input'
import { PinTextInputCell } from '../../../../../../_molecules/pin-mapping-table/text-input'

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
  columnHelper.accessor('alias', {
    header: 'Alias',
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
    // Pin alias / address edits are producer mutations — refresh
    // variables bound to the affected addresses so the table
    // reflects the new bindings without a save/reload.
    if (res?.ok && (columnId === 'alias' || columnId === 'address')) {
      useOpenPLCStore.getState().projectActions.syncVariableAliases()
    }
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
