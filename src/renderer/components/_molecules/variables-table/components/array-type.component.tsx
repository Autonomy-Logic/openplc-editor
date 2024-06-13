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
    <div aria-label='Array data type' className='flex h-full w-full'>
      <table className='table-auto'>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export { ArrayTypeComponent }
