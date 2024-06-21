import { cn } from '@root/utils'
import { ComponentPropsWithRef, forwardRef } from 'react'

const Table = forwardRef<HTMLTableElement, ComponentPropsWithRef<'table'> & { context?: string }>(
  ({ className, context, ...res }, ref) => (
    <div aria-label='Table container' className='h-fit w-fit'>
      <table
        aria-label={`${context} table`}
        ref={ref}
        className='table-auto border-separate border-spacing-0 text-center font-caption text-xs font-normal'
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
      className={cn('sticky top-0 h-8 cursor-default bg-neutral-50 dark:bg-neutral-950', className)}
      {...res}
    >
      <tr className='-z-1 absolute h-1 w-full bg-neutral-50 dark:bg-neutral-950' />
      {res.children}
    </thead>
  ),
)

TableHeader.displayName = 'TableHeader'

const TableBody = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tbody'>>(({ className, ...res }, ref) => (
  <tbody aria-label='Table body' ref={ref} className={cn('', className)} {...res} />
))

TableBody.displayName = 'TableBody'

const TableFooter = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tfoot'>>(
  ({ className, ...res }, ref) => <tfoot aria-label='Table footer' ref={ref} className={className} {...res} />,
)

TableFooter.displayName = 'TableFooter'

const TableRow = forwardRef<HTMLTableRowElement, ComponentPropsWithRef<'tr'> & { selected?: boolean }>(({ className, selected, ...res }, ref) => (
  <tr
    aria-label='Table row'
    ref={ref}
    className={cn(
      'h-8',
      // header cell
      '[&:nth-child(2)>th:first-child]:rounded-tl-md [&:nth-child(2)>th:last-child]:rounded-tr-md [&:nth-child(2)>th]:border-t',
      // body cell
      '[&:last-child>td:first-child]:rounded-bl-md [&:last-child>td:last-child]:rounded-br-md',
      // all cells
      '[&>*:first-child]:border-l [&>*]:border-b [&>*]:border-r [&>*]:border-neutral-500 dark:[&>*]:border-neutral-850',
      { 'bg-neutral-50 dark:bg-neutral-900': selected }
      className,
    )}
    {...res}
  />
))

TableRow.displayName = 'TableRow'

const TableCell = forwardRef<HTMLTableCellElement, ComponentPropsWithRef<'td'>>(({ className, ...res }, ref) => (
  <td
    aria-label='Table cell'
    ref={ref}
    className={cn(
      'h-full max-h-8 w-[200px] p-2 text-neutral-700 lg:w-[300px] 2xl:w-[375px] dark:text-neutral-500',
      'has-[:focus]:has-[input]:bg-neutral-200 has-[button[data-state=open]]:bg-neutral-200 has-[div[data-state=open]]:bg-neutral-200',
      'dark:has-[:focus]:has-[input]:bg-neutral-850 dark:has-[button[data-state=open]]:bg-neutral-850 dark:has-[div[data-state=open]]:bg-neutral-850',
      className,
    )}
    {...res}
  />
))

TableCell.displayName = 'TableCell'

type TableHeadProps = ComponentPropsWithRef<'th'> & {
  resizable?: boolean
  isResizing?: boolean
  resizeHandler?: (event: unknown) => void
}
const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, resizable = false, isResizing, resizeHandler, ...res }, ref) => (
    <th
      aria-label='Table header cell'
      ref={ref}
      className={cn(
        // REVIEW: width is set to 200px, 300px, or 375px based on the screen size, but to make the table resizable we had to change it with Tanstack/react-table
        'relative max-h-8 w-[200px] p-2 text-neutral-850 lg:w-[300px] 2xl:w-[375px] dark:text-neutral-300',
        className,
      )}
      {...res}
    >
      {res.children}
      {resizable && (
        <div
          aria-label='Table header cell resize handle'
          className={cn(
            'absolute -right-[3px] top-0 h-full w-[5px] cursor-col-resize touch-none select-none rounded-xl bg-brand opacity-0 hover:opacity-100',
            { 'bg-brand-dark': isResizing },
          )}
          onMouseDown={resizeHandler}
          onTouchStart={resizeHandler}
        />
      )}
    </th>
  ),
)

TableHead.displayName = 'TableHead'

export { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow }
