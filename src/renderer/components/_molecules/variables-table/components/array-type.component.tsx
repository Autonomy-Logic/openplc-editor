import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'

const columnHelper = createColumnHelper<{ val: string }>()

const columns = [columnHelper.accessor('val', { header: 'Value', cell: (info) => info.getValue() })]

const tableData = [{ val: 'a' }, { val: 'b' }, { val: 'c' }]
const ArrayTypeComponent = () => {
  const table = useReactTable({
    data: tableData,
    columns: columns,
    debugTable: true,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <div aria-label='Array data type' className='my-1 flex h-full w-full'>
      <table className='w-full table-auto'>
        <tbody className='flex w-full flex-col gap-1'>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className='flex max-h-7 w-full flex-1 rounded-lg border border-neutral-300 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 '
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className='flex h-full max-h-7 w-full items-center justify-start p-2 font-caption text-xs font-normal text-neutral-800 dark:text-neutral-100'
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export { ArrayTypeComponent }
