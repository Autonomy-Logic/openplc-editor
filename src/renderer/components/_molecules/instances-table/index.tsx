import { useOpenPLCStore } from '@root/renderer/store'
import { PLCInstance } from '@root/types/PLC/open-plc'
import { createColumnHelper } from '@tanstack/react-table'

import { GenericTable } from '../../_atoms/generic-table'
import EditableNameCell from './editable-cell'
import { SelectableProgramCell, SelectableTaskCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCInstance>()
const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('program', {
    header: 'Program',
    size: 768,
    minSize: 150,
    maxSize: 768,
    enableResizing: true,
    cell: SelectableProgramCell,
  }),
  columnHelper.accessor('task', {
    header: ' Task',
    enableResizing: true,
    size: 768,
    minSize: 150,
    maxSize: 768,
    cell: SelectableTaskCell,
  }),
]

type PLCInstancesTableProps = {
  tableData: PLCInstance[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const InstancesTable = ({ tableData, handleRowClick, selectedRow }: PLCInstancesTableProps) => {
  const {
    editor: {
      meta: { name },
    },
    projectActions: { updateInstance },
    snapshotActions: { addSnapshot },
  } = useOpenPLCStore()

  return (
    <GenericTable<PLCInstance>
      columns={columns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        addSnapshot(name)
        // @ts-expect-error - The data value is a literal type that need to be parsed
        return updateInstance({ rowId: rowIndex, data: { [columnId]: value } })
      }}
      tableContext='Instances'
    />
  )
}

export { InstancesTable }
