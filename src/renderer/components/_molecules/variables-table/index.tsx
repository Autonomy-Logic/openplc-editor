import { PLCVariable } from '@root/types/PLC/test'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import { EditableDocumentationCell, EditableNameCell } from './editable-cell'
import { SelectableClassCell, SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCVariable>()

const columns = [
  columnHelper.accessor('id', { header: '#', cell: (info) => info.getValue() }),
  columnHelper.accessor('name', { header: 'Name', cell: EditableNameCell }),
  columnHelper.accessor('class', { header: 'Class', cell: SelectableClassCell }),
  columnHelper.accessor('type', { header: 'Type', cell: SelectableTypeCell }),
  columnHelper.accessor('location', { header: 'Location', cell: EditableNameCell }),
  columnHelper.accessor('documentation', { header: 'Documentation', cell: EditableDocumentationCell }),
  columnHelper.accessor('debug', { header: 'Debug', cell: SelectableDebugCell }),
]

type PLCVariablesTableProps = {
  tableData: PLCVariable[]
}
const VariablesTable = ({ tableData }: PLCVariablesTableProps) => {
  const table = useReactTable({
    data: tableData,
    columns: columns,
    debugTable: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const [selectedRow, setSelectedRow] = useState<string>('')

  const handleRowClick = (row: HTMLTableRowElement) => {
    const { id } = row
    setSelectedRow(id)
  }

  return (
    <Table context='Variables'>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead className='first:max-w-32 last:max-w-16' key={header.id}>
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
            className='h-8'
            onClick={(e) => handleRowClick(e.currentTarget)}
            selected={selectedRow === row.id}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell className='first:max-w-32 last:max-w-16' key={cell.id}>
                {flexRender(cell.column.columnDef.cell, { ...cell.getContext(), editable: selectedRow === row.id })}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { VariablesTable }
