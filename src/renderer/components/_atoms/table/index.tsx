import { ComponentPropsWithRef, forwardRef } from 'react'

const Table = forwardRef<HTMLTableElement, ComponentPropsWithRef<'table'>>(({ className, ...res }, ref) => (
  <div>
    <table ref={ref} className='' {...res} />
  </div>
))

Table.displayName = 'Table'

const TableHeader = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'thead'>>(
  ({ className, ...res }, ref) => <thead ref={ref} className={className} {...res} />,
)

TableHeader.displayName = 'TableHeader'

const TableBody = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tbody'>>(({ className, ...res }, ref) => (
  <tbody ref={ref} className={className} {...res} />
))

TableBody.displayName = 'TableBody'

const TableFooter = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tfoot'>>(
  ({ className, ...res }, ref) => <tfoot ref={ref} className={className} {...res} />,
)

TableFooter.displayName = 'TableFooter'

const TableRow = forwardRef<HTMLTableRowElement, ComponentPropsWithRef<'tr'>>(({ className, ...res }, ref) => (
  <tr ref={ref} className={className} {...res} />
))

TableRow.displayName = 'TableRow'

const TableCell = forwardRef<HTMLTableCellElement, ComponentPropsWithRef<'td'>>(({ className, ...res }, ref) => (
  <td ref={ref} className={className} {...res} />
))

TableCell.displayName = 'TableCell'

const TableHead = forwardRef<HTMLTableCellElement, ComponentPropsWithRef<'th'>>(({ className, ...res }, ref) => (
  <th ref={ref} className={className} {...res} />
))

TableHead.displayName = 'TableHead'

export { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow }
