import { ColumnFiltersState, createColumnHelper, OnChangeFn } from '@tanstack/react-table'
import type { MouseEvent, ReactNode } from 'react'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../store'
import { GenericTable } from '../../_atoms/generic-table'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms/select'
import { TableCell, TableRow } from '../../_atoms/table'
import {
  EditableDocumentationCell,
  EditableInitialValueCell,
  EditableLocationCell,
  EditableNameCell,
} from './editable-cell'
import { SelectableClassCell, SelectableDebugCell, SelectableFlagCell, SelectableTypeCell } from './selectable-cell'

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
  columnHelper.accessor('flag', {
    header: 'Flags',
    enableResizing: true,
    size: 120,
    minSize: 90,
    maxSize: 160,
    cell: SelectableFlagCell,
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
  columnHelper.accessor('flag', {
    header: 'Flags',
    enableResizing: true,
    size: 120,
    minSize: 90,
    maxSize: 160,
    cell: SelectableFlagCell,
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
  /** Replaces the Class column header, for the class filter. */
  classHeader?: ReactNode
  /** A function's return type, shown as a pinned first row named after the function. */
  returnRow?: { name: string; type: string; options: string[]; disabled: boolean; onChange: (type: string) => void }
  /** Adds a variable at the end, from the Add variable row; no row when undefined. */
  onAddVariable?: () => void
  addDisabled?: boolean
  onRowContextMenu?: (rowIndex: number, event: MouseEvent<HTMLTableRowElement>) => void
}

/** The pinned return-type row of a function: only its Type cell can be edited. */
function ReturnTypeRow({
  columnIds,
  row,
}: {
  columnIds: string[]
  row: NonNullable<PLCVariablesTableProps['returnRow']>
}) {
  return (
    <TableRow aria-label='Return type row' className='h-8 italic'>
      {columnIds.map((id) => (
        <TableCell key={id} className={id === 'name' ? 'text-left' : undefined}>
          {id === 'name' && <span className='px-2'>{row.name}</span>}
          {id === 'class' && 'return'}
          {id === 'type' && (
            <Select value={row.type} onValueChange={row.onChange} disabled={row.disabled}>
              <SelectTrigger
                aria-label='Return type'
                placeholder={row.type}
                className='flex h-full w-full cursor-pointer items-center justify-center p-2 font-caption text-xs font-normal not-italic text-neutral-700 outline-none disabled:cursor-not-allowed dark:text-neutral-500'
              />
              <SelectContent
                position='popper'
                sideOffset={3}
                align='center'
                className='box h-fit max-h-[300px] min-w-44 overflow-y-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
              >
                {row.options.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                    className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  >
                    <span className='text-xs not-italic text-neutral-700 dark:text-neutral-500'>{option}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </TableCell>
      ))}
    </TableRow>
  )
}

const VariablesTable = ({
  tableData,
  filterValue,
  columnFilters,
  setColumnFilters,
  selectedRow,
  handleRowClick,
  classHeader,
  returnRow,
  onAddVariable,
  addDisabled = false,
  onRowContextMenu,
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
      columns={(pou?.pouType !== 'program' ? columns : columnsPrograms).map((column) =>
        classHeader !== undefined && 'accessorKey' in column && column.accessorKey === 'class'
          ? { ...column, header: () => classHeader }
          : column,
      )}
      leadingRow={returnRow ? (columnIds) => <ReturnTypeRow columnIds={columnIds} row={returnRow} /> : undefined}
      trailingRow={
        onAddVariable
          ? (columnCount) => (
              <TableRow aria-label='Add variable row' className='h-8'>
                <TableCell colSpan={columnCount} className='text-left'>
                  <button
                    aria-label='Add variable'
                    disabled={addDisabled}
                    onClick={onAddVariable}
                    className='w-full px-3 text-left text-neutral-500 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    + Add variable
                  </button>
                </TableCell>
              </TableRow>
            )
          : undefined
      }
      onRowContextMenu={onRowContextMenu}
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
