import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import {
  ColumnFiltersState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  OnChangeFn,
  useReactTable,
} from '@tanstack/react-table'
import { useEffect, useRef } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'
import { EditableDocumentationCell, EditableNameCell } from './editable-cell'
import { SelectableClassCell, SelectableDebugCell, SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCVariable>()

const columnsPrograms = [
  columnHelper.accessor('id', {
    header: '#',
    size: 64,
    minSize: 32,
    maxSize: 64,
    enableResizing: true,
    cell: (props) => props.row.id,
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 300,
    minSize: 150,
    maxSize: 300,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('class', {
    header: 'Class',
    enableResizing: true,
    cell: SelectableClassCell,
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    enableResizing: true,
    size: 300,
    minSize: 80,
    maxSize: 300,
    cell: SelectableTypeCell,
  }),
  columnHelper.accessor('location', {
    header: 'Location',
    enableResizing: true,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('initialValue', {
    header: 'Initial Value',
    enableResizing: true,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('documentation', {
    header: 'Documentation',
    enableResizing: true,
    size: 468,
    minSize: 198,
    maxSize: 468,
    cell: EditableDocumentationCell,
  }),
  columnHelper.accessor('debug', { header: 'Debug', size: 64, minSize: 64, maxSize: 64, cell: SelectableDebugCell }),
]

const columns = [
  columnHelper.accessor('id', {
    header: '#',
    size: 64,
    minSize: 32,
    maxSize: 64,
    enableResizing: true,
    cell: (props) => props.row.id,
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 300,
    minSize: 150,
    maxSize: 300,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('class', {
    header: 'Class',
    enableResizing: true,
    cell: SelectableClassCell,
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    enableResizing: true,
    size: 300,
    minSize: 80,
    maxSize: 300,
    cell: SelectableTypeCell,
  }),
  columnHelper.accessor('initialValue', {
    header: 'Initial Value',
    enableResizing: true,
    cell: EditableNameCell,
  }),
  columnHelper.accessor('documentation', {
    header: 'Documentation',
    enableResizing: true,
    size: 568,
    minSize: 198,
    maxSize: 568,
    cell: EditableDocumentationCell,
  }),
  columnHelper.accessor('debug', { header: 'Debug', size: 64, minSize: 64, maxSize: 64, cell: SelectableDebugCell }),
]

type PLCVariablesTableProps = {
  tableData: PLCVariable[]
  filterValue?: string
  columnFilters?: ColumnFiltersState
  setColumnFilters?: OnChangeFn<ColumnFiltersState> | undefined
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const VariablesTable = ({
  tableData,
  filterValue,
  columnFilters,
  setColumnFilters,
  selectedRow,
  handleRowClick,
}: PLCVariablesTableProps) => {
  const {
    editor: {
      meta: { name },
    },
    project: {
      data: { pous },
    },
    projectActions: { updateVariable },
  } = useOpenPLCStore()

  const tableHeaderRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)

  const pou = pous.find((p) => p.data.name === name)

  const resetBorders = () => {
    const parent = tableBodyRef.current
    const header = tableHeaderRef.current
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
    const row = tableBodyRowRef.current
    const parent = tableBodyRef.current
    const header = tableHeaderRef.current
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
    if (tableBodyRowRef.current) {
      setBorders()
    }
  }, [filterValue])

  const table = useReactTable({
    columns: pou?.type !== 'program' ? columns : columnsPrograms,
    columnResizeMode: 'onChange',
    data: tableData,
    debugTable: true,
    defaultColumn: {
      size: 128,
      minSize: 80,
      maxSize: 128,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    meta: {
      updateData: (rowIndex, columnId, value) => {
        if (columnId === 'class' && filterValue !== undefined && filterValue !== 'all' && filterValue !== value) {
          resetBorders()
        }
        return updateVariable({
          scope: 'local',
          associatedPou: name,
          rowId: rowIndex,
          data: {
            [columnId]: value,
          },
        })
      },
    },
  })

  return (
    <Table context='Variables' className='mr-1'>
      <TableHeader ref={tableHeaderRef}>
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
      <TableBody ref={tableBodyRef}>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            id={row.id}
            key={row.id}
            className={cn('h-8 cursor-pointer')}
            onClick={(e) => handleRowClick(e.currentTarget)}
            selected={selectedRow === parseInt(row.id)}
            ref={selectedRow === parseInt(row.id) ? tableBodyRowRef : null}
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
                  selected: selectedRow === parseInt(row.id),
                  scope: 'local',
                })}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { VariablesTable }
