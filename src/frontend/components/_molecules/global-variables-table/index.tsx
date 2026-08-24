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

/**
 * The columns, built per table rather than shared as one constant.
 *
 * Two tables use these: the Resource globals and a Global Variable List's members. They
 * differ in exactly two ways, so those are the options — everything else, including every
 * cell, is the same code in both, which is the point of building them here.
 *
 * `includeDebug` is off for a list: nothing collects a list member into the debugger's
 * variable set, so the toggle would render a watch that never happens.
 *
 * `includeLocation` is off for a list for the same reason — an address on a list member does
 * not drive anything. The compiler shape a list becomes is a STRUCT, and `AT %QX0.0` on a
 * struct member is accepted and then silently discarded, producing no located mapping, so
 * the serializers deliberately omit it (see `global-variable-list-serializer`). An address a
 * project arrives with is still kept on the member and still written back on export to
 * CODESYS; what is withheld is the editing affordance for a binding openplc cannot honour.
 *
 * `skipReferenceImpact` is on for a list: see the prop's note on the name cell.
 */
const buildColumns = ({
  includeDebug = true,
  includeLocation = true,
  skipReferenceImpact = false,
}: { includeDebug?: boolean; includeLocation?: boolean; skipReferenceImpact?: boolean } = {}) => [
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
    cell: (props) => <EditableNameCell {...props} skipReferenceImpact={skipReferenceImpact} />,
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
const listColumns = buildColumns({ includeDebug: false, includeLocation: false, skipReferenceImpact: true })

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

/**
 * A Global Variable List's members, as a table.
 *
 * Same table and same cells as the Resource globals above — a member is a variable in the
 * same sense a resource global is — with the writes going to the list instead, through the
 * `global-variable-list` scope on the shared variable actions.
 */
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
