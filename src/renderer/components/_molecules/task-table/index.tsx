import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { getFilteredRowModel } from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import { EditableDocumentationCell, EditableNameCell } from '../variables-table/editable-cell'
import { SelectableClassCell, SelectableTypeCell } from '../variables-table/selectable-cell'

export default function TaskTable() {
  const columnHelper = createColumnHelper()
  const columns = [
    columnHelper.accessor('name', {
      header: 'Name',
      enableResizing: true,
      size: 120,
      minSize: 100,
      maxSize: 120,
      cell: EditableNameCell,
    }),
    columnHelper.accessor('triggering', {
      header: 'Triggering',
      enableResizing: true,
      size: 300,
      minSize: 150,
      maxSize: 300,
      cell: SelectableClassCell,
    }),
    columnHelper.accessor('single', {
      header: 'single',
      enableResizing: true,
      size: 300,
      minSize: 80,
      maxSize: 300,
      cell: SelectableTypeCell,
    }),
    columnHelper.accessor('interval', {
      header: 'Interval',
      size: 300,
      minSize: 150,
      maxSize: 300,
      enableResizing: true,
      cell: EditableNameCell,
    }),
    columnHelper.accessor('priority', {
      header: 'Priority',
      enableResizing: true,
      size: 568,
      minSize: 198,
      maxSize: 568,
      cell: EditableDocumentationCell,
    }),
  ]

  const table = useReactTable({
    columns: columns,
    columnResizeMode: 'onChange',
    data: [],
    debugTable: true,
    defaultColumn: {
      size: 128,
      minSize: 80,
      maxSize: 128,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <Table context='Tasks' className='mr-1'>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                resizable={header.column.columnDef.enableResizing}
                isResizing={header.column.getIsResizing()}
                resizeHandler={header.getResizeHandler()}
                style={{
                  width: header.getSize(),
                  maxWidth: header.column.columnDef.maxSize,
                  minWidth: header.column.columnDef.minSize,
                }}
                key={header.id}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        <TableRow className='h-8 cursor-pointer'>
          <TableCell></TableCell>
          <TableCell></TableCell>
          <TableCell></TableCell>
          <TableCell></TableCell>
          <TableCell></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
