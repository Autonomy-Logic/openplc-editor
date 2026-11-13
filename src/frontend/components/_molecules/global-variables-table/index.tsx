import { createColumnHelper } from '@tanstack/react-table'

import type { PLCGlobalVariable } from '../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../store'
import { GenericTable } from '../../_atoms/generic-table'
import {
  EditableDocumentationCell,
  EditableInitialValueCell,
  EditableLocationCell,
  EditableNameCell,
} from './editable-cell'
import { SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCGlobalVariable>()

/** Builds the global variables table columns; the options drop the debug and location columns and skip the reference impact handling. */
const buildColumns = ({
  includeDebug = true,
  includeLocation = true,
  skipReferenceImpact = false,
  isResourceGlobal = true,
}: {
  includeDebug?: boolean
  includeLocation?: boolean
  skipReferenceImpact?: boolean
  isResourceGlobal?: boolean
} = {}) => [
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
    cell: (props) => (
      <EditableNameCell {...props} skipReferenceImpact={skipReferenceImpact} isResourceGlobal={isResourceGlobal} />
    ),
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
    cell: (props) => <SelectableTypeCell {...props} skipReferenceImpact={skipReferenceImpact} />,
  }),
  ...(includeLocation
    ? [
        columnHelper.accessor('location', {
          header: 'Location',
          enableResizing: true,
          cell: EditableLocationCell,
        }),
      ]
    : []),
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
  ...(includeDebug
    ? [
        columnHelper.accessor('debug', {
          header: 'Debug',
          size: 64,
          minSize: 64,
          maxSize: 64,
          cell: SelectableDebugCell,
        }),
      ]
    : []),
]

/** The Resource globals table's columns, which never change. */
const resourceColumns = buildColumns()

/** A list's columns: no address, no debugger watch, no bare-name reference rewriting. */
const listColumns = buildColumns({
  includeDebug: false,
  includeLocation: false,
  skipReferenceImpact: true,
  isResourceGlobal: false,
})

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
    projectActions: { updateVariable },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const { captureAndPush } = usePouSnapshot()

  return (
    <GenericTable<PLCGlobalVariable>
      columns={resourceColumns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        captureAndPush(name)
        const result = updateVariable({ scope: 'global', rowId: rowIndex, data: { [columnId]: value } })
        if (result.ok) {
          handleFileAndWorkspaceSavedState('Resource')
        }
        return result
      }}
      tableContext='Variables'
    />
  )
}

/** A Global Variable List's members as a table, written through the `global-variable-list` scope of the variable actions. */
const GlobalVariableListTable = ({
  listName,
  tableData,
  selectedRow,
  handleRowClick,
}: PLCVariablesTableProps & { listName: string }) => {
  const {
    projectActions: { updateVariable },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  return (
    <GenericTable<PLCGlobalVariable>
      columns={listColumns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        const result = updateVariable({
          scope: 'global-variable-list',
          associatedList: listName,
          rowId: rowIndex,
          data: { [columnId]: value },
        })
        if (result.ok) {
          handleFileAndWorkspaceSavedState(listName)
        }
        return result
      }}
      tableContext='Variables'
    />
  )
}

export { GlobalVariableListTable, GlobalVariablesTable }
