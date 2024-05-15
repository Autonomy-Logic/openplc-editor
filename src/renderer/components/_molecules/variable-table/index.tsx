import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'

import { EditableCell } from './editable-cell'

// type IVariableTableProps<TData, TValue> = {
//   columns: ColumnDef<TData, TValue>[]
//   data: TData[]
// }

// const VariableTable = <TData, TValue>({ columns, data }: IVariableTableProps<TData, TValue>) => {
//   const table = useReactTable({
//     data,
//     columns,
//     getCoreRowModel: () => getCoreRowModel(),
//   })
//   return (
//     <table id='Variable table' className='w-full flex-1'>
//       <thead id='Variable table header container' className='border-b border-neutral-300 dark:border-neutral-850 '>
//         <tr id='Variable table header row' className='divide-x divide-neutral-300 dark:divide-neutral-850'>
//           {columns.map((column) => (
//             <TableHeaderCell key={column.id} label={column.header as string} />
//           ))}
//         </tr>
//       </thead>
//       <tbody id='Variable table body' className='divide-x divide-y divide-neutral-300 dark:divide-neutral-850'>
//         {data.map((variable) => (
//           <TableDataRow key={variable.id} variable={variable} />
//         ))}
//       </tbody>
//     </table>
//   )
// }

type IVariable = {
  id: number
  name: string
  class: 'input' | 'output'
  type: 'BOOL' | 'INT' | 'DATE'
  location: string
  debug: boolean
  documentation: string
}

const columns: ColumnDef<IVariable>[] = [
  {
    accessorKey: 'id',
    header: '#',
    cell: (props: { getValue: () => unknown }) => <p>{props.getValue() as number}</p>,
  },
  {
    accessorKey: 'name',
    header: 'Name',
    cell: EditableCell.cell,
  },
  {
    accessorKey: 'class',
    header: 'Class',
    cell: (props: { getValue: () => unknown }) => <p>{props.getValue() as 'input' | 'output'}</p>,
  },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: (props: { getValue: () => unknown }) => <p>{props.getValue() as 'BOOL' | 'INT' | 'DATE'}</p>,
  },
  {
    accessorKey: 'location',
    header: 'Location',
    cell: (props: { getValue: () => unknown }) => <p>{props.getValue() as string}</p>,
  },
  {
    accessorKey: 'debug',
    header: 'Debug',
    cell: (props: { getValue: () => unknown }) => <p>{props.getValue() as boolean}</p>,
  },
  {
    accessorKey: 'documentation',
    header: 'Documentation',
    cell: (props: { getValue: () => unknown }) => <p>{props.getValue() as string}</p>,
  },
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

const Example = () => {
  const [data, _setData] = useState<IVariable[]>(variables)
  const table = useReactTable({
    data,
    columns: columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div
      id='Variable table container'
      className='h-full max-h-[500px] w-full max-w-[786px] rounded-md border border-neutral-300 dark:border-neutral-850'
    >
      <table className='h-full w-full'>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr
            id='Variable table header container'
            className='border-b border-neutral-300 dark:border-neutral-850'
            key={headerGroup.id}
          >
            {headerGroup.headers.map((header) => (
              <th key={header.id}>{header.column.columnDef.header as string}</th>
            ))}
          </tr>
        ))}
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} id='Variable table row' className='divide-x divide-neutral-300 dark:divide-neutral-850'>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </table>
    </div>
  )
}

export { Example }
