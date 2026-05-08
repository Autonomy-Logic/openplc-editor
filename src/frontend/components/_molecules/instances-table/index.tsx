import { createColumnHelper } from '@tanstack/react-table'

import type { PLCInstance } from '../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../store'
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
  } = useOpenPLCStore()

  const { captureAndPush } = usePouSnapshot()

  return (
    <GenericTable<PLCInstance>
      columns={columns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        captureAndPush(name)
        // @ts-expect-error - The data value is a literal type that need to be parsed
        const result = updateInstance({ rowId: rowIndex, data: { [columnId]: value } })
        return result
      }}
      tableContext='Instances'
    />
  )
}

export { InstancesTable }
