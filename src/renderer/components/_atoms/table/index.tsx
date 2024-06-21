import { cn } from '@root/utils'
import { ComponentPropsWithRef, forwardRef } from 'react'

const Table = forwardRef<HTMLTableElement, ComponentPropsWithRef<'table'> & { context?: string }>(
  ({ className, context, ...res }, ref) => (
    <div
      aria-label='Table container'
      className='h-fit w-fit min-w-[1035px] rounded-md border border-neutral-500 dark:border-neutral-850'
    >
      <table
        aria-label={`${context} table`}
        ref={ref}
        className='table-auto text-center font-caption text-xs font-normal dark:divide-neutral-850'
        {...res}
      />
    </div>
  ),
)

Table.displayName = 'Table'

const TableHeader = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'thead'>>(
  ({ className, ...res }, ref) => (
    <thead
      aria-label='Table header'
      ref={ref}
      className={cn(
        'h-8 cursor-default divide-x divide-neutral-500 border-b border-neutral-500 dark:divide-neutral-850 dark:border-neutral-850',
        className,
      )}
      {...res}
    />
  ),
)

TableHeader.displayName = 'TableHeader'

const TableBody = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tbody'>>(({ className, ...res }, ref) => (
  <tbody
    aria-label='Table body'
    ref={ref}
    className={cn('divide-y divide-neutral-500 dark:divide-neutral-850', className)}
    {...res}
  />
))

TableBody.displayName = 'TableBody'

const TableFooter = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tfoot'>>(
  ({ className, ...res }, ref) => <tfoot aria-label='Table footer' ref={ref} className={className} {...res} />,
)

TableFooter.displayName = 'TableFooter'

const TableRow = forwardRef<HTMLTableRowElement, ComponentPropsWithRef<'tr'> & { selected?: boolean }>(
  ({ className, selected, ...res }, ref) => {
    return (
      <tr
        aria-label='Table row'
        ref={ref}
        className={cn('h-8 divide-x divide-neutral-500 dark:divide-neutral-850', className, {
          'bg-neutral-100 dark:bg-neutral-900': selected,
        })}
        {...res}
      />
    )
  },
)

TableRow.displayName = 'TableRow'

const TableCell = forwardRef<HTMLTableCellElement, ComponentPropsWithRef<'td'>>(({ className, ...res }, ref) => (
  <td
    aria-label='Table cell'
    ref={ref}
    className={cn(
      'h-full max-h-8 w-[200px] p-2 text-neutral-700 lg:w-[300px] 2xl:w-[375px] dark:text-neutral-500',
      className,
    )}
    {...res}
  />
))

TableCell.displayName = 'TableCell'

const TableHead = forwardRef<HTMLTableCellElement, ComponentPropsWithRef<'th'>>(({ className, ...res }, ref) => (
  <th
    aria-label='Table header cell'
    ref={ref}
    className={cn('max-h-8 w-[200px] p-2 text-neutral-850 lg:w-[300px] 2xl:w-[375px] dark:text-neutral-300', className)}
    {...res}
  />
))

TableHead.displayName = 'TableHead'

export { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow }
