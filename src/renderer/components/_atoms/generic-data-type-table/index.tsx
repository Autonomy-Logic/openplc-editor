import { Table, TableBody, TableCell, TableRow } from '@components/_atoms'
import { flexRender, Table as ReactTable } from '@tanstack/react-table'
import React, { RefObject } from 'react'

interface GenericTableProps {
  context: 'data-type-array' | 'data-type-enumerated'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: ReactTable<any>
  selectedRow: number
  handleRowClick: (target: HTMLTableRowElement) => void
  tableBodyRowRef: RefObject<HTMLTableRowElement> | null
  tableBodyRef: RefObject<HTMLTableSectionElement>
}

const GenericDataTypeTable: React.FC<GenericTableProps> = ({
  context,
  table,
  selectedRow,
  handleRowClick,
  tableBodyRowRef,
  tableBodyRef,
}) => {
  return (
    <Table context={context} className='w-full'>
      <TableBody ref={tableBodyRef}>
        {table.getRowModel().rows.map((row, index: number) => (
          <TableRow
            id={`${index}`}
            key={index}
            className='h-8'
            selected={selectedRow === index}
            ref={selectedRow === index ? tableBodyRowRef : null}
            onClick={(e) => handleRowClick(e.currentTarget)}
            tableHasHeader={false}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                style={{ maxWidth: cell.column.columnDef.maxSize, minWidth: cell.column.columnDef.minSize }}
                key={cell.id}
              >
                {flexRender(cell.column.columnDef.cell, {
                  ...cell.getContext(),
                  editable: selectedRow === index,
                })}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { GenericDataTypeTable }
