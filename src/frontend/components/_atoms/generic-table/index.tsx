import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  OnChangeFn,
  useReactTable,
} from '@tanstack/react-table'
import { type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useVirtualRows } from '../../../hooks/use-virtual-rows'
import type { ProjectResponse } from '../../../store/slices/project'
import { cn } from '../../../utils/cn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table'

/** Row height assumed until a data row is measured; virtualization treats every data row as one height. */
const DEFAULT_ROW_HEIGHT = 32
const VIRTUAL_OVERSCAN = 20
const DEFAULT_VIRTUAL_THRESHOLD = 200

type GenericTableVirtualization = {
  /** Row count above which only the rows near the viewport mount. */
  threshold?: number
}

/** The nearest ancestor of `element` that scrolls vertically, or null. */
const findScrollParent = (element: HTMLElement | null): HTMLElement | null => {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node
  }
  return null
}

type GenericTableProps<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  tableData: T[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
  updateData: (rowIndex: number, columnId: string, value: unknown) => ProjectResponse
  tableContext: string
  filterValue?: string
  columnFilters?: ColumnFiltersState
  setColumnFilters?: OnChangeFn<ColumnFiltersState> | undefined
  /** A row drawn before the data rows, given the visible column ids. */
  leadingRow?: (columnIds: string[]) => ReactNode
  /** A row drawn after the data rows, given the number of visible columns. */
  trailingRow?: (columnCount: number) => ReactNode
  onRowContextMenu?: (rowIndex: number, event: MouseEvent<HTMLTableRowElement>) => void
  /** Mounts only the rows near the viewport once the table has more rows than the threshold. */
  virtualization?: GenericTableVirtualization
}

function GenericTable<T>({
  columns,
  tableData,
  selectedRow,
  handleRowClick,
  updateData,
  tableContext,
  filterValue,
  columnFilters,
  setColumnFilters,
  leadingRow,
  trailingRow,
  onRowContextMenu,
  virtualization,
}: GenericTableProps<T>) {
  const tableHeaderRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)

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

  const table = useReactTable<T>({
    columns,
    data: tableData,
    columnResizeMode: 'onChange',
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
        return updateData(rowIndex, columnId, value)
      },
    },
    debugTable: true,
  })

  const rows = table.getRowModel().rows
  const virtualized =
    virtualization !== undefined && rows.length > (virtualization.threshold ?? DEFAULT_VIRTUAL_THRESHOLD)
  const scrollElement = useRef<HTMLElement | null>(null)
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)

  useLayoutEffect(() => {
    scrollElement.current = virtualized ? findScrollParent(tableBodyRef.current) : null
  }, [virtualized])

  const getOffsetTop = useCallback(() => {
    const element = scrollElement.current
    const firstRow = tableBodyRef.current?.querySelector<HTMLTableRowElement>('tr[data-row-position]')
    if (!element || !firstRow) return 0
    const position = Number(firstRow.dataset.rowPosition)
    return (
      firstRow.getBoundingClientRect().top -
      element.getBoundingClientRect().top +
      element.scrollTop -
      position * rowHeight
    )
  }, [rowHeight, scrollElement])

  const { start, end, paddingTop, paddingBottom, scrollToIndex } = useVirtualRows({
    count: rows.length,
    rowHeight,
    overscan: VIRTUAL_OVERSCAN,
    scrollElement,
    getOffsetTop,
    enabled: virtualized,
  })

  useLayoutEffect(() => {
    if (!virtualized) return
    const measured = tableBodyRef.current
      ?.querySelector<HTMLTableRowElement>('tr[data-row-position]')
      ?.getBoundingClientRect().height
    if (measured && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured)
  }, [virtualized, rowHeight, start, end])

  useEffect(() => {
    if (!virtualized) return
    const position = rows.findIndex((row) => parseInt(row.id) === selectedRow)
    if (position >= 0) scrollToIndex(position)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow, virtualized])

  useEffect(() => {
    resetBorders()
    setBorders()
  }, [selectedRow, start, end])

  useEffect(() => {
    resetBorders()
    if (tableBodyRowRef.current) {
      setBorders()
    }
  }, [filterValue])

  return (
    <Table context={tableContext} className='mr-1 w-full'>
      <TableHeader ref={tableHeaderRef}>
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
      <TableBody ref={tableBodyRef}>
        {leadingRow?.(table.getVisibleLeafColumns().map((column) => column.id))}
        {paddingTop > 0 && <tr aria-hidden='true' style={{ height: paddingTop }} />}
        {rows.slice(start, end).map((row, offset) => (
          <TableRow
            id={row.id}
            key={row.id}
            data-row-position={start + offset}
            className='h-8 cursor-pointer'
            onClick={(e) => handleRowClick(e.currentTarget)}
            onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(parseInt(row.id), e) : undefined}
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
                  editable: selectedRow === parseInt(row.id),
                  selected: selectedRow === parseInt(row.id),
                  scope: 'local',
                })}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {paddingBottom > 0 && <tr aria-hidden='true' style={{ height: paddingBottom }} />}
        {trailingRow?.(table.getVisibleLeafColumns().length)}
      </TableBody>
    </Table>
  )
}

export type { GenericTableVirtualization }
export { GenericTable }
