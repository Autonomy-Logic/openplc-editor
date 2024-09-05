import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { getFilteredRowModel } from '@tanstack/react-table'
import { useState } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'

export default function TaskTable() {
  const ROWS_NOT_SELECTED = -1
  const columnHelper = createColumnHelper()
  const columns = [
    columnHelper.accessor('name', {
      header: 'Name',
      enableResizing: true,
      size: 150,
      minSize: 100,
      maxSize: 150,
    }),
    columnHelper.accessor('triggering', {
      header: 'Triggering',
      enableResizing: true,
      size: 200,
      minSize: 150,
      maxSize: 200,
    }),
    columnHelper.accessor('single', {
      header: 'Single',
      enableResizing: true,
      size: 200,
      minSize: 80,
      maxSize: 200,
    }),
    columnHelper.accessor('interval', {
      header: 'Interval',
      size: 200,
      minSize: 150,
      maxSize: 200,
      enableResizing: true,
    }),
    columnHelper.accessor('priority', {
      header: 'Priority',
      enableResizing: false,
      size: 568,
      minSize: 198,
      maxSize: 568,
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
  const [editorVariables] = useState({
    display: 'table',
    selectedRow: ROWS_NOT_SELECTED.toString(),
  })

  return (
    <Table context='Tasks' className='mr-1'>
      {editorVariables.display === 'table' && (
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
      )}
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            id={row.id}
            key={row.id}
            className='h-8 cursor-pointer'
            onClick={(e) => console.log(e.currentTarget)}
            // selected={selectedRow === parseInt(row.id)}
            // ref={selectedRow === parseInt(row.id) ? tableBodyRowRef : null}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                style={{
                  width: cell.column.getSize(),
                  maxWidth: cell.column.columnDef.maxSize,
                  minWidth: cell.column.columnDef.minSize,
                }}
                key={cell.id}
              >
                {flexRender(cell.column.columnDef.cell, {
                  ...cell.getContext(),
                  // editable: selectedRow === parseInt(row.id),
                })}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
