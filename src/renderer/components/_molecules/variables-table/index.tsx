import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import { EditableDocumentationCell, EditableNameCell } from './editable-cell'
import { SelectableClassCell, SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

export type IVariable = {
  id: number
  name: string
  class: 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp'
  type: 'BOOL' | 'INT' | 'DATE'
  location: string
  debug: boolean
  documentation: string
}

const columnHelper = createColumnHelper<IVariable>()

const columns = [
  columnHelper.accessor('id', { header: '#', cell: (info) => info.getValue() }),
  columnHelper.accessor('name', { header: 'Name', cell: EditableNameCell }),
  columnHelper.accessor('class', { header: 'Class', cell: SelectableClassCell }),
  columnHelper.accessor('type', { header: 'Type', cell: SelectableTypeCell }),
  columnHelper.accessor('location', { header: 'Location', cell: EditableNameCell }),
  columnHelper.accessor('documentation', { header: 'Documentation', cell: EditableDocumentationCell }),
  columnHelper.accessor('debug', { header: 'Debug', cell: SelectableDebugCell }),
]

const variables: IVariable[] = [
  {
    id: 1,
    name: 'Variable 1',
    class: 'input',
    type: 'BOOL',
    location: '%123',
    debug: false,
    documentation: 'Doc for var 1',
  },
  {
    id: 2,
    name: 'Variable 2',
    class: 'output',
    type: 'DATE',
    location: '%123',
    debug: false,
    documentation: 'Doc for var 2',
  },
  {
    id: 3,
    name: 'Variable 3',
    class: 'output',
    type: 'INT',
    location: '%123',
    debug: false,
    documentation: 'Doc for var 3',
  },
  {
    id: 4,
    name: 'Variable 4',
    class: 'output',
    type: 'DATE',
    location: '%123',
    debug: false,
    documentation: 'Doc for var 4',
  },
  {
    id: 5,
    name: 'Variable 5',
    class: 'input',
    type: 'INT',
    location: '%123',
    debug: false,
    documentation: 'Doc for var 5',
  },
  {
    id: 6,
    name: 'Variable 6',
    class: 'output',
    type: 'DATE',
    location: '%123',
    debug: false,
    documentation: 'Doc for var 6',
  },
]

const VariablesTable = () => {
  const [data, _setData] = useState<IVariable[]>(variables)
  const table = useReactTable({
    data,
    columns: columns,
    debugTable: true,
    getCoreRowModel: getCoreRowModel(),
  })

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
          <TableRow key={row.id} className='h-8'>
            {row.getVisibleCells().map((cell) => (
              <TableCell className='first:max-w-32 last:max-w-16' key={cell.id}>
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
