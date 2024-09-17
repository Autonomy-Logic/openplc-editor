import { useOpenPLCStore } from '@root/renderer/store'
import { PLCInstance } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { getFilteredRowModel } from '@tanstack/react-table'
import { useEffect, useRef } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import EditableNameCell from './editable-cell'
import { SelectableProgramCell, SelectableTaskCell } from './selectable-cell'

type PLCInstancesTableProps = {
  tableData: PLCInstance[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const columnHelper = createColumnHelper<PLCInstance>()
const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('program', {
    header: 'Program',
    size: 768,
    minSize: 150,
    maxSize: 768,
    enableResizing: true,
    cell: SelectableProgramCell,
  }),
  columnHelper.accessor('task', {
    header: ' Task',
    enableResizing: true,
    size: 768,
    minSize: 150,
    maxSize: 768,
    cell: SelectableTaskCell,
  }),
]

export default function InstancesTable({ tableData, handleRowClick, selectedRow }: PLCInstancesTableProps) {
  const {
    workspaceActions: { updateInstance },
  } = useOpenPLCStore()
  const InstanceBodyRef = useRef<HTMLTableSectionElement>(null)
  const InstanceTableRowRef = useRef<HTMLTableRowElement>(null)
  const InstanceTableHeaderRef = useRef<HTMLTableSectionElement>(null)

  const resetBorders = () => {
    const parent = InstanceBodyRef.current
    const header = InstanceTableHeaderRef.current
    if (!parent?.children || !header?.children) return

    const rows = Array.from(parent.children)
    const headers = Array.from(header.children)
    rows.forEach((row) => {
      row.className = cn(
        row.className,
        '[&:last-child>td]:border-b-neutral-500 [&>td:first-child]:border-l-neutral-500 [&>td:last-child]:border-r-neutral-500 [&>td]:border-b-neutral-300',
        'dark:[&>td:first-child]:border-l-neutral-500 dark:[&>td:last-child]:border-r-neutral-500 dark:[&>td]:border-b-neutral-800',
        'shadow-none dark:shadow-none',
      )
    })
    headers.forEach((header) => {
      header.className = cn(header.className, '[&>th]:border-neutral-300 dark:[&>th]:border-neutral-800')
    })
  }

  const setBorders = () => {
    const row = InstanceTableRowRef.current
    const parent = InstanceBodyRef.current
    const header = InstanceTableHeaderRef.current
    if (!row || !parent || !header) return

    const headerRow = row === parent?.firstChild ? header?.lastElementChild : null
    const element = headerRow ?? row?.previousElementSibling

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

  useEffect(() => {
    resetBorders()
    if (InstanceTableRowRef.current) {
      setBorders()
    }
  }, [])

  const table = useReactTable<PLCInstance>({
    columns: columns,
    columnResizeMode: 'onChange',
    data: tableData,
    debugTable: true,
    defaultColumn: {
      size: 128,
      minSize: 80,
      maxSize: 128,
    },
    meta: {
      updateData: (rowIndex: number, columnId: string, value: unknown) => {
        const updateInstances = { ...tableData[rowIndex], [columnId]: value }
        updateInstance({
          data: { ...updateInstances },
          rowId: rowIndex,
        })
        return {
          ok: true,
          message: 'Instance updated successfully',
        }
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })
  return (
    <Table context='Instances' className='mr-1'>
      <TableHeader ref={InstanceTableHeaderRef}>
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
      <TableBody ref={InstanceBodyRef}>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            id={row.id}
            key={row.id}
            className='h-8 cursor-pointer'
            onClick={(e) => handleRowClick(e.currentTarget)}
            selected={selectedRow === parseInt(row.id)}
            ref={selectedRow === parseInt(row.id) ? InstanceTableRowRef : null}
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
                  editable: selectedRow === parseInt(row.id),
                })}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
