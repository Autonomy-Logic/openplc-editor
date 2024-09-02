import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { getFilteredRowModel } from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'

export default function InstancesTable() {
  const columnHelper = createColumnHelper()
  const columns = [
    columnHelper.accessor('name', {
      header: 'Name',
      enableResizing: true,
      size: 150,
      minSize: 100,
      maxSize: 150,
    }),
    columnHelper.accessor('type', {
      header: 'Type',
      enableResizing: true,
      size: 710,
      minSize: 150,
      maxSize: 710,
    }),
    columnHelper.accessor('task', {
      header: 'Task',
      enableResizing: false,
      size: 710,
      minSize: 80,
      maxSize: 710,
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
        </TableRow>
      </TableBody>
    </Table>
  )
}
