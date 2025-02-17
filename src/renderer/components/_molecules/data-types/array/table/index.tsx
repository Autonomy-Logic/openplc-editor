/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Table, TableBody, TableCell, TableRow } from '@components/_atoms'
import { MinusIcon, PlusIcon } from '@radix-ui/react-icons'
import { StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { arrayValidation } from '@root/renderer/store/slices/project/validation/variables'
import { PLCArrayDatatype, PLCDataType } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils/cn'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'
import React from 'react'

import { DimensionCell } from './editable-cell'

type DataTypeDimensionsTableProps = {
  name: string
  dimensions: PLCArrayDatatype['dimensions']
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const DimensionsTable = ({ name, dimensions, selectedRow, handleRowClick }: DataTypeDimensionsTableProps) => {
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)
  const [tableData, setTableData] = useState<PLCArrayDatatype['dimensions']>(dimensions)

  const {
    projectActions: { updateDatatype },
  } = useOpenPLCStore()

  const columnHelper = createColumnHelper<{ dimension: unknown }>()
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('dimension', {
        size: 900,
        minSize: 350,
        maxSize: 900,
        enableResizing: true,

        cell: (cellProps) => (
          <DimensionCell
            key={cellProps.row.id}
            onInputChange={(value) => handleInputChange(value, cellProps.row.index)}
            onBlur={() => handleBlur(cellProps.row.index)}
            id={`dimension-input-${cellProps.row.index}`}
            autoFocus={cellProps.row.index === focusIndex}
            name={name}
            dimensions={dimensions}
            selectedRow={selectedRow}
             {...cellProps}
        />
        ),
      }),
    ],
    [focusIndex, dimensions, name, selectedRow],
  )

  useEffect(() => {
    setTableData([...dimensions])
  }, [dimensions, name])

  useEffect(() => {
    if (focusIndex !== null) {
      const inputElement = document.getElementById(`dimension-input-${focusIndex}`)
      if (inputElement) {
        inputElement.focus()
      }
    }
  }, [focusIndex])

  useEffect(() => {
    setFocusIndex(selectedRow)
  }, [selectedRow])

  const handleInputChange = (value: string, index: number) => {
    setTableData((prevRows) => prevRows.map((row, i) => (i === index ? { ...row, dimension: value } : row)))
    setFocusIndex(index)
  }

  const updateDimensions = (newDimensions: unknown[]) => {
    newDimensions.map((row) => ({ dimension: row.dimension }))
  }

  const handleBlur = (rowIndex: number) => {
    setTableData((prevRows) => {
      const inputElement = document.getElementById(`dimension-input-${rowIndex}`) as HTMLInputElement;
      if (inputElement) {
        const inputValue = inputElement.value.trim();
        const validation = arrayValidation({ value: inputValue });

        if (!validation.ok || inputValue === '') {
          const newRows = prevRows.filter((_, index) => index !== rowIndex);
          updateDimensions(newRows);
          setFocusIndex(null);
          toast({
            title: 'Invalid array',
            description: `The array value is invalid. Pattern: "LEFT_number..RIGHT_number" and RIGHT must be GREATER than LEFT. Example: 0..10.`,
            variant: 'fail',
          })
          removeRow()
          return newRows;
        } else {
          const newRows = prevRows.map((row, index) => ({
            ...row,
            dimension: index === rowIndex ? inputValue : row.dimension,
          }));
          const optionalSchema = {
            name: name,
            dimensions: newRows.map((row) => ({ dimension: row.dimension })),
          };
          updateDatatype(name, optionalSchema as PLCDataType);
          updateDimensions(newRows);
          return newRows;
        }
      }
      setFocusIndex(null)
      return prevRows;
    });
  };

  const addNewRow = () => {
    setTableData((prevRows) => {
      const newRows = [...prevRows, { dimension: '' }]
      setFocusIndex(newRows?.length - 1)
      resetBorders()
      return newRows
    })
  }

  const removeRow = () => {
    setTableData((prevRows) => {
      if (focusIndex !== null) {
        const newRows = prevRows.filter((_, index) => index !== focusIndex)

        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map((row) => ({ dimension: row?.dimension })),
          }
          updateDatatype(name, optionalSchema as PLCArrayDatatype)
        })
        prevRows = newRows
      }
      return prevRows
    })
  }

  const moveRowUp = () => {
    setTableData((prevRows) => {
      if (focusIndex !== null && focusIndex > 0) {
        const newRows = [...prevRows]
        const temp = newRows[focusIndex]
        newRows[focusIndex] = newRows[focusIndex - 1]
        newRows[focusIndex - 1] = temp

        const newFocusIndex = focusIndex - 1
        setFocusIndex(newFocusIndex)

        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map((row) => ({ dimension: row?.dimension })),
          }
          updateDatatype(name, optionalSchema as PLCArrayDatatype)
        })

        setBorders(newFocusIndex)
        prevRows = newRows
      }
      return prevRows
    })
  }

  const moveRowDown = () => {
    setTableData((prevRows) => {
      if (focusIndex !== null && focusIndex < prevRows.length - 1) {
        const newRows = [...prevRows]
        const temp = newRows[focusIndex]
        newRows[focusIndex] = newRows[focusIndex + 1]
        newRows[focusIndex + 1] = temp

        const newFocusIndex = focusIndex + 1
        setFocusIndex(newFocusIndex)

        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map((row) => ({ dimension: row?.dimension })),
          }
          updateDatatype(name, optionalSchema as PLCArrayDatatype)
        })
        setBorders(newFocusIndex)
        prevRows = newRows
      }
      return prevRows
    })
  }

  const resetBorders = () => {
    const parent = tableBodyRef.current
    if (!parent?.children) return

    const rows = Array.from(parent.children)
    rows.forEach((row) => {
      row.className = cn(
        row.className,
        '[&:last-child>td]:border-b-neutral-500 [&>td:first-child]:border-l-neutral-500 [&>td:last-child]:border-r-neutral-500 [&>td]:border-b-neutral-300',
        '[&>td]:border-t-neutral-500',
        'dark:[&>td:first-child]:border-l-neutral-500 dark:[&>td:last-child]:border-r-neutral-500 dark:[&>td]:border-b-neutral-800',
        'dark:[&>td]:border-t-neutral-500',
        'shadow-none dark:shadow-none',
      )
    })
  }

  const setBorders = (indexFocus: number | null) => {
    const parent = tableBodyRef.current
    if (!parent) return

    ;[...parent.children].forEach((child, index) => {
      if (index !== indexFocus) {
        child.className = cn(child.className, '[&>td]:border-neutral-500 dark:[&>td]:border-neutral-500')
      }
    })

    const currentRow = parent.children[indexFocus]
    if (currentRow) {
      currentRow.className = cn(
        currentRow.className,
        '[&:last-child>td]:border-b-brand [&>td:first-child]:border-l-brand [&>td:last-child]:border-r-brand [&>td]:border-b-brand',
        '[&>td]:border-t-brand',
        'dark:[&>td:first-child]:border-l-brand dark:[&>td:last-child]:border-r-brand dark:[&>td]:border-b-brand',
        'dark:[&>td]:border-t-brand',
      )
    }
  }

  useEffect(() => {
    const parent = tableBodyRef.current
    if (!parent) return

    if (parent.children[0]) {
      parent.children[0].className = cn(
        parent.children[0].className,
        '[&>td:first-child]:rounded-tl-md [&>td:last-child]:rounded-tr-md',
        '[&>td]:border-t-neutral-500 dark:[&>td]:border-t-neutral-500',
      )
    }
  }, [tableBodyRef, tableBodyRowRef, tableData])

  useEffect(() => {
    resetBorders()
    setBorders(focusIndex)
  }, [focusIndex, tableBodyRef, tableBodyRowRef])

  const table = useReactTable({
    columns: columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  })

  return (
    <>
      <div
        aria-label='Array data type table actions container'
        className='flex h-fit w-3/5 items-center justify-between'
      >
        <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
          Dimensions
        </p>
        <div
          aria-label='Data type table actions buttons container'
          className='flex-start flex h-full w-2/5 *:rounded-md *:p-1'
        >
          <TableActionButton aria-label='Add table row button' onClick={addNewRow} id='add-new-row-button'>
            <PlusIcon className='!stroke-brand' />
          </TableActionButton>
          <TableActionButton aria-label='Remove table row button' onClick={removeRow}>
            <MinusIcon className='stroke-[#0464FB]' />
          </TableActionButton>
          <TableActionButton aria-label='Move table row up button' onClick={moveRowUp}>
            <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
          </TableActionButton>
          <TableActionButton aria-label='Move table row down button' onClick={moveRowDown}>
            <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
          </TableActionButton>
        </div>
      </div>
      <Table context='data-type-array'>
        <TableBody ref={tableBodyRef}>
          {table.getRowModel().rows.map((row, index) => (
            <TableRow
              id={`${index}`}
              key={index}
              className='h-8'
              selected={selectedRow === index}
              ref={selectedRow === index ? tableBodyRowRef : null}
              onClick={(e) => handleRowClick(e.currentTarget)}
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
    </>
  )
}

export { DimensionsTable }
