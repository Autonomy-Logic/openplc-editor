import { useOpenPLCStore } from '@root/renderer/store'
import { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useEffect, useRef } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import { EditableNameCell, EditablePriorityCell } from './editable-cell'
import { SelectableIntervalCell, SelectableTriggerCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCTask>()
const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 150,
    minSize: 100,
    maxSize: 150,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('triggering', {
    header: 'Triggering',
    enableResizing: true,
    size: 468,
    minSize: 150,
    maxSize: 468,
    cell: SelectableTriggerCell,
  }),
  columnHelper.accessor('interval', {
    header: 'Interval',
    size: 468,
    minSize: 150,
    maxSize: 468,
    enableResizing: true,
    cell: SelectableIntervalCell,
  }),
  columnHelper.accessor('priority', {
    header: 'Priority',
    enableResizing: false,
    size: 468,
    minSize: 150,
    maxSize: 468,
    cell: EditablePriorityCell,
  }),
]

type PLCTaskTableProps = {
  tableData: {
    name: string
    triggering: 'Cyclic' | 'Interrupt'
    interval: string
    priority: number
  }[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

export default function TaskTable({ tableData, selectedRow, handleRowClick }: PLCTaskTableProps) {
  const {
    workspaceActions: { updateTask },
  } = useOpenPLCStore()
  const TaskBodyRef = useRef<HTMLTableSectionElement>(null)
  const TaskTableRowRef = useRef<HTMLTableRowElement>(null)
  const TaskTableHeaderRef = useRef<HTMLTableSectionElement>(null)

  const resetBorders = () => {
    const parent = TaskBodyRef.current
    const header = TaskTableHeaderRef.current
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
    const row = TaskTableRowRef.current
    const parent = TaskBodyRef.current
    const header = TaskTableHeaderRef.current
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
    if (TaskTableRowRef.current) {
      setBorders()
    }
  }, [])

  const table = useReactTable<PLCTask>({
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
        const updatedTask = { ...tableData[rowIndex], [columnId]: value }
        updateTask({
          data: { ...updatedTask },
          rowId: rowIndex,
        })
        return {
          ok: true,
          message: 'Task updated successfully',
        }
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })
  return (
    <Table context='Tasks' className='mr-1'>
      <TableHeader ref={TaskTableHeaderRef}>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow className='select-none' key={headerGroup.id}>
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
      <TableBody ref={TaskBodyRef}>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            id={row.id}
            key={row.id}
            className='h-8 cursor-pointer'
            onClick={(e) => handleRowClick(e.currentTarget)}
            selected={selectedRow === parseInt(row.id)}
            ref={selectedRow === parseInt(row.id) ? TaskTableRowRef : null}
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
