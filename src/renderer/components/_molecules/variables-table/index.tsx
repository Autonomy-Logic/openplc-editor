import { PLCVariable } from '@root/types/PLC/test'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import { EditableDocumentationCell, EditableNameCell } from './editable-cell'
import { SelectableClassCell, SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCVariable>()

const columns = [
  columnHelper.accessor('id', { header: '#', enableResizing: true, cell: (info) => info.getValue() }),
  columnHelper.accessor('name', { header: 'Name', enableResizing: true, cell: EditableNameCell }),
  columnHelper.accessor('class', { header: 'Class', enableResizing: true, cell: SelectableClassCell }),
  columnHelper.accessor('type', { header: 'Type', enableResizing: true, cell: SelectableTypeCell }),
  columnHelper.accessor('location', { header: 'Location', enableResizing: true, cell: EditableNameCell }),
  columnHelper.accessor('documentation', { header: 'Documentation', enableResizing: true, cell: EditableDocumentationCell }),
  columnHelper.accessor('debug', { header: 'Debug', cell: SelectableDebugCell }),
]

type PLCVariablesTableProps = {
  tableData: PLCVariable[]
}
const VariablesTable = ({ tableData }: PLCVariablesTableProps) => {
  const table = useReactTable({
    data: tableData,
    columns: columns,
    columnResizeMode: 'onChange',
    debugTable: true,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Table context='Variables'>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                className='first:max-w-32 last:max-w-16'
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
          <TableRow key={row.id} className='h-8'>
            {row.getVisibleCells().map((cell) => (
              <TableCell
                className='first:max-w-32 last:max-w-16'
                style={{ width: cell.column.getSize() }}
                key={cell.id}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { VariablesTable }
