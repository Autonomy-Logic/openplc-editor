import { ColumnFiltersState, createColumnHelper, OnChangeFn } from '@tanstack/react-table'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../store'
import { GenericTable } from '../../_atoms/generic-table'
import {
  EditableDocumentationCell,
  EditableInitialValueCell,
  EditableLocationCell,
  EditableNameCell,
} from './editable-cell'
import { SelectableClassCell, SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCVariable>()

const columnsPrograms = [
  columnHelper.display({
    id: 'rowNumber',
    header: '#',
    size: 64,
    minSize: 32,
    maxSize: 64,
    enableResizing: true,
    cell: (props) => props.row.index,
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
    cell: SelectableClassCell,
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
    cell: EditableLocationCell,
  }),
  columnHelper.accessor('initialValue', {
    header: 'Initial Value',
    enableResizing: true,
    cell: EditableInitialValueCell,
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

const columns = [
  columnHelper.display({
    id: 'rowNumber',
    header: '#',
    size: 64,
    minSize: 32,
    maxSize: 64,
    enableResizing: true,
    cell: (props) => props.row.index,
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
    cell: SelectableClassCell,
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    enableResizing: true,
    size: 300,
    minSize: 80,
    maxSize: 300,
    cell: SelectableTypeCell,
  }),
  columnHelper.accessor('initialValue', {
    header: 'Initial Value',
    enableResizing: true,
    cell: EditableInitialValueCell,
  }),
  columnHelper.accessor('documentation', {
    header: 'Documentation',
    enableResizing: true,
    size: 568,
    minSize: 198,
    maxSize: 568,
    cell: EditableDocumentationCell,
  }),
  columnHelper.accessor('debug', { header: 'Debug', size: 64, minSize: 64, maxSize: 64, cell: SelectableDebugCell }),
]

type PLCVariablesTableProps = {
  tableData: PLCVariable[]
  filterValue?: string
  columnFilters?: ColumnFiltersState
  setColumnFilters?: OnChangeFn<ColumnFiltersState> | undefined
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const VariablesTable = ({
  tableData,
  filterValue,
  columnFilters,
  setColumnFilters,
  selectedRow,
  handleRowClick,
}: PLCVariablesTableProps) => {
  const {
    editor: {
      meta: { name },
    },
    project: {
      data: { pous },
    },
    projectActions: { updateVariable },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()
  const { captureAndPush } = usePouSnapshot()

  const pou = pous.find((p) => p.name === name)

  return (
    <GenericTable<PLCVariable>
      columns={pou?.pouType !== 'program' ? columns : columnsPrograms}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        captureAndPush(name)

        if (columnId === 'class' && filterValue !== undefined && filterValue !== 'all' && filterValue !== value) {
          return {
            ok: false,
            message: '',
          }
        }

        const result = updateVariable({
          scope: 'local',
          associatedPou: name,
          rowId: rowIndex,
          data: {
            [columnId]: value,
          },
        })
        if (result.ok) {
          handleFileAndWorkspaceSavedState(name)
        }
        return result
      }}
      tableContext='Variables'
      columnFilters={columnFilters}
      setColumnFilters={setColumnFilters}
      filterValue={filterValue}
    />
  )
}

export { VariablesTable }
