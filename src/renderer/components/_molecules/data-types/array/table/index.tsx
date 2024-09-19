import { Table, TableBody, TableCell, TableRow } from '@components/_atoms'
import { cn } from '@root/utils/cn'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'

import { DimensionCell } from './editable-cell'

const columnHelper = createColumnHelper<{ dimension: string }>()
const columns = [
  columnHelper.accessor('dimension', {
    header: '',
    size: 300,
    minSize: 150,
    maxSize: 300,
    enableResizing: true,
    cell: DimensionCell,
  }),
]

type DataTypeDimensionsTableProps = {
  tableData?: {
    dimension: string
  }[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const DimensionsTable = ({ selectedRow, handleRowClick }: DataTypeDimensionsTableProps) => {
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)

  const [tableData, _setTableData] = useState<{ dimension: string }[]>([
    { dimension: '1' },
    { dimension: '2' },
    { dimension: '3' },
    { dimension: '4' },
  ])

  const resetBorders = () => {
    const parent = tableBodyRef.current
    if (!parent?.children) return

    const rows = Array.from(parent.children)
    rows.forEach((row) => {
      row.className = cn(
        row.className,
        '[&:last-child>td]:border-b-neutral-500 [&>td:first-child]:border-l-neutral-500 [&>td:last-child]:border-r-neutral-500 [&>td]:border-b-neutral-300',
        'dark:[&>td:first-child]:border-l-neutral-500 dark:[&>td:last-child]:border-r-neutral-500 dark:[&>td]:border-b-neutral-800',
        'shadow-none dark:shadow-none',
      )
    })
  }

  const setBorders = () => {
    const row = tableBodyRowRef.current
    const parent = tableBodyRef.current
    if (!row || !parent) return

    const element = row?.previousElementSibling

    if (element) {
      element.className = cn(
        element.className,
        '[&>td]:border-b-brand dark:[&>td]:border-b-brand',
        '[&>th]:border-b-brand dark:[&>th]:border-b-brand',
      )
    }
    row.className = cn(
      row.className,
      '[&:last-child>td]:border-b-brand [&>td:first-child]:border-l-brand [&>td:last-child]:border-r-brand [&>td]:border-b-brand',
      'dark:[&>td:first-child]:border-l-brand dark:[&>td:last-child]:border-r-brand dark:[&>td]:border-b-brand',
    )
  }

  useEffect(() => {
    resetBorders()
    setBorders()
  }, [selectedRow])

  const table = useReactTable({
    columns: columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  })

  return (
    <Table context='data-type-array'>
      <TableBody ref={tableBodyRef} >
        {table.getRowModel().rows.map((row) => (
          <TableRow
            id={row.id}
            key={row.id}
            className='h-8'
            selected={selectedRow === parseInt(row.id)}
            ref={selectedRow === parseInt(row.id) ? tableBodyRowRef : null}
            onClick={(e) => handleRowClick(e.currentTarget)}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                style={{ maxWidth: cell.column.columnDef.maxSize, minWidth: cell.column.columnDef.minSize }}
                key={cell.id}
              >
                {flexRender(cell.column.columnDef.cell, {
                  ...cell.getContext(), 
                  editable: selectedRow === parseInt(row.id)
                })}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { DimensionsTable }
