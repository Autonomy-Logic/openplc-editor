import { useOpenPLCStore } from '@root/renderer/store'
import { PLCGlobalVariable } from '@root/types/PLC/open-plc'
import { createColumnHelper } from '@tanstack/react-table'

import { GenericTable } from '../../_atoms/generic-table'
import { EditableDocumentationCell, EditableNameCell } from './editable-cell'
import { SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCGlobalVariable>()

const columns = [
  columnHelper.accessor('id', {
    header: '#',
    size: 64,
    minSize: 32,
    maxSize: 64,
    enableResizing: true,
    cell: (props) => props.row.id,
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 300,
    minSize: 150,
    maxSize: 300,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('class', {
    header: 'Class',
    enableResizing: true,
    cell: 'Global',
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    enableResizing: true,
    size: 300,
    minSize: 80,
    maxSize: 300,
    cell: SelectableTypeCell,
  }),
  columnHelper.accessor('location', {
    header: 'Location',
    enableResizing: true,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('initialValue', {
    header: 'Initial Value',
    enableResizing: true,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('documentation', {
    header: 'Documentation',
    enableResizing: true,
    size: 468,
    minSize: 198,
    maxSize: 468,
    cell: EditableDocumentationCell,
  }),
  columnHelper.accessor('debug', { header: 'Debug', size: 64, minSize: 64, maxSize: 64, cell: SelectableDebugCell }),
]

type PLCVariablesTableProps = {
  tableData: PLCGlobalVariable[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const GlobalVariablesTable = ({ tableData, selectedRow, handleRowClick }: PLCVariablesTableProps) => {
  const {
    editor: {
      meta: { name },
    },
    projectActions: { updateVariable, pushToHistory },
  } = useOpenPLCStore()

  return (
    <GenericTable<PLCGlobalVariable>
      columns={columns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        pushToHistory(name)
        return updateVariable({ scope: 'global', rowId: rowIndex, data: { [columnId]: value } })
      }}
      tableContext='Variables'
    />
  )
}

export { GlobalVariablesTable }
