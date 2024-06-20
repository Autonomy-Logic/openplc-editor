import { cn } from '@root/utils'
import { ComponentPropsWithRef, forwardRef } from 'react'

const Table = forwardRef<HTMLTableElement, ComponentPropsWithRef<'table'> & { context?: string }>(
  ({ className, context, ...res }, ref) => (
    <div
      aria-label='Table container'
      // className='h-fit w-fit rounded-md border border-neutral-500 dark:border-neutral-850'
      className='h-fit w-fit'
    >
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
      className={cn(
        // 'sticky top-0 h-8 cursor-default bg-neutral-50 dark:bg-neutral-950 [&>*:first-child>*:first-child]:rounded-tl-md [&>*:first-child>*:last-child]:rounded-tr-md [&>*:first-child>*]:border-t [&>*:first-child>*]:border-t-transparent',
        `sticky top-0 h-8 cursor-default bg-neutral-50 dark:bg-neutral-950 [&>*:first-child>*:first-child]:rounded-tl-md [&>*:first-child>*:last-child]:rounded-tr-md [&>*:first-child>*]:border-t`,
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
    // className={cn('[&>*:last-child>*]:border-b-transparent', className)}
    className={cn(
      '[&>*:last-child>*:first-child]:rounded-bl-md [&>*:last-child>*:last-child]:rounded-br-md',
      className,
    )}
    {...res}
  />
))

TableBody.displayName = 'TableBody'

const TableFooter = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tfoot'>>(
  ({ className, ...res }, ref) => <tfoot aria-label='Table footer' ref={ref} className={className} {...res} />,
)

TableFooter.displayName = 'TableFooter'

const TableRow = forwardRef<HTMLTableRowElement, ComponentPropsWithRef<'tr'>>(({ className, ...res }, ref) => (
  <tr
    aria-label='Table row'
    ref={ref}
    className={cn(
      // 'h-8 [&>*]:border-b [&>*]:border-r [&>*]:border-neutral-500 last:[&>*]:border-r-transparent dark:[&>*]:border-neutral-850',
      'h-8 [&>*:first-child]:border-l [&>*]:border-b [&>*]:border-r [&>*]:border-neutral-500 dark:[&>*]:border-neutral-850',
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
      // REVIEW: width is set to 200px, 300px, or 375px based on the screen size, but to make the table resizable we had to change it with Tanstack/react-table
      'h-full max-h-8 w-[200px] p-2 text-neutral-700 has-[:focus]:has-[input]:bg-neutral-200 has-[:focus]:has-[textarea]:bg-neutral-200 lg:w-[300px] 2xl:w-[375px] dark:text-neutral-500 dark:has-[:focus]:has-[input]:bg-neutral-800 dark:has-[:focus]:has-[textarea]:bg-neutral-800',
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
