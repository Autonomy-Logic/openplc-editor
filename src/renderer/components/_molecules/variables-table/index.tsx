import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC/open-plc'
import {
  ColumnFiltersState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  OnChangeFn,
  useReactTable,
} from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import { EditableDocumentationCell, EditableNameCell } from './editable-cell'
import { SelectableClassCell, SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCVariable>()

const columns = [
  columnHelper.accessor('id', {
    header: '#',
    size: 64,
    minSize: 64,
    maxSize: 64,
    enableResizing: true,
    cell: (props) => props.row.id,
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 150,
    minSize: 150,
    maxSize: 400,
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
    cell: SelectableTypeCell,
  }),
  columnHelper.accessor('location', {
    header: 'Location',
    enableResizing: true,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('documentation', {
    header: 'Documentation',
    enableResizing: true,
    size: 198,
    minSize: 198,
    maxSize: 640,
    cell: EditableDocumentationCell,
  }),
  columnHelper.accessor('debug', { header: 'Debug', size: 64, minSize: 64, maxSize: 64, cell: SelectableDebugCell }),
]

type PLCVariablesTableProps = {
  tableData: PLCVariable[]
  columnFilters?: ColumnFiltersState
  setColumnFilters?: OnChangeFn<ColumnFiltersState> | undefined
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const VariablesTable = ({
  tableData,
  columnFilters,
  setColumnFilters,
  selectedRow,
  handleRowClick,
}: PLCVariablesTableProps) => {
  const {
    editor: {
      meta: { name },
    },
    workspace: {
      projectData: { pous },
    },
    workspaceActions: { updateVariable },
  } = useOpenPLCStore()

  const table = useReactTable({
    columns: columns,
    columnResizeMode: 'onChange',
    data: tableData,
    debugTable: true,
    defaultColumn: {
      size: 128,
      minSize: 80,
      maxSize: 128,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    meta: {
      updateData: (rowIndex, columnId, value) => {
        return updateVariable({
          scope: 'local',
          associatedPou: pous.find((pou) => pou.data.name === name)?.data.name,
          rowId: rowIndex,
          data: {
            [columnId]: value,
          },
        })
      },
    },
  })

  return (
    <Table context='Variables' className='mr-1'>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                resizable={header.column.columnDef.enableResizing}
                isResizing={header.column.getIsResizing()}
                resizeHandler={header.getResizeHandler()}
                style={{ width: header.getSize() }}
                key={header.id}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            id={row.id}
            key={row.id}
            className='h-8 cursor-pointer'
            onClick={(e) => handleRowClick(e.currentTarget)}
            selected={selectedRow === parseInt(row.id)}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell style={{ width: cell.column.getSize() }} key={cell.id}>
                {flexRender(cell.column.columnDef.cell, {
                  ...cell.getContext(),
                  editable: selectedRow === parseInt(row.id),
                })}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { VariablesTable }
