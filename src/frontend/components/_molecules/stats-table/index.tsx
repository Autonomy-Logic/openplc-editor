import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@root/frontend/components/_atoms/table'
import { cn } from '@root/frontend/utils/cn'
import { ReactNode } from 'react'

export interface StatsTableColumn<R> {
  /** Stable identifier used for the React key when rendering the cell. */
  key: string
  /** Header text shown at the top of the column. */
  header: string
  /** Cell alignment. Defaults to centered (matches scan-cycle / ethercat). */
  align?: 'left' | 'center'
  /** Extra classes appended to both header and body cells in this column. */
  className?: string
  /** Renders the cell body for `row`. Receives the full row so it can pull
   *  out whatever fields it needs — keeps the table generic over R. */
  render: (row: R) => ReactNode
}

export interface StatsTableProps<R> {
  /** ARIA label / DOM-id stem. Section becomes `${context}-section`,
   *  title `${context}-title`. Must be unique on the page. */
  context: string
  /** Section heading. */
  title: string
  /** Optional subtitle (e.g. units / interpretation hint). */
  description?: string
  columns: StatsTableColumn<R>[]
  rows: R[]
  /** Stable per-row React key. */
  rowKey: (row: R) => string
}

/**
 * Shared statistics table.
 *
 * One implementation backs every stats panel in the device-config screen
 * (scan-cycle, EtherCAT bus, VPP plugin telemetry). Differences across
 * sections are expressed in the `columns` array and the row type — the
 * frame, header, and per-cell layout are identical so the panels stack
 * uniformly. Custom-rendered cells (e.g. `RangeCell` for avg/min/max
 * stacks) plug in through the `render` callback on each column.
 *
 * Generic over `R` so each call site can pass its own row type without
 * casting through `Record<string, unknown>`.
 */
export function StatsTable<R>({ context, title, description, columns, rows, rowKey }: StatsTableProps<R>) {
  return (
    <div id={`${context}-section`} className='flex w-full flex-col gap-3'>
      <h2 id={`${context}-title`} className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
        {title}
      </h2>
      {description && <span className='select-none text-xs text-neutral-500 dark:text-neutral-400'>{description}</span>}
      <Table context={context} className='w-full'>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={cn('w-auto px-3', c.align === 'left' && 'text-left', c.className)}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((c) => (
                <TableCell key={c.key} className={cn('px-3', c.align === 'left' && 'text-left', c.className)}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { formatNumber, formatRange } from './format-helpers'
export { RangeCell } from './range-cell'
