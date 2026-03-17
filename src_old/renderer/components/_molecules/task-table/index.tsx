import { useOpenPLCStore } from '@root/renderer/store'
import { PLCTask } from '@root/types/PLC/open-plc'
import { createColumnHelper } from '@tanstack/react-table'

import { GenericTable } from '../../_atoms/generic-table'
import { EditableNameCell, EditablePriorityCell } from './editable-cell'
import { SelectableIntervalCell, SelectableTriggerCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCTask>()
const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('triggering', {
    header: 'Triggering',
    enableResizing: true,
    size: 468,
    minSize: 150,
    maxSize: 468,
    cell: SelectableTriggerCell,
  }),
  columnHelper.accessor('interval', {
    header: 'Interval',
    size: 468,
    minSize: 150,
    maxSize: 468,
    enableResizing: true,
    cell: SelectableIntervalCell,
  }),
  columnHelper.accessor('priority', {
    header: 'Priority',
    enableResizing: false,
    size: 468,
    minSize: 150,
    maxSize: 468,
    cell: EditablePriorityCell,
  }),
]

type PLCTaskTableProps = {
  tableData: {
    name: string
    triggering: 'Cyclic' | 'Interrupt'
    interval: string
    priority: number
  }[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const TaskTable = ({ tableData, selectedRow, handleRowClick }: PLCTaskTableProps) => {
  const {
    editor: {
      meta: { name },
    },
    projectActions: { updateTask },
    snapshotActions: { addSnapshot },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  return (
    <GenericTable<PLCTask>
      columns={columns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        addSnapshot(name)
        // @ts-expect-error - The data value is a literal type that need to be parsed
        const result = updateTask({ rowId: rowIndex, data: { [columnId]: value } })
        if (result.ok) {
          handleFileAndWorkspaceSavedState('Resource')
        }
        return result
      }}
      tableContext='Tasks'
    />
  )
}

export { TaskTable }
