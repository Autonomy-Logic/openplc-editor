import { Table, TableBody, TableCell, TableRow } from '@components/_atoms'
import { MinusIcon, PlusIcon } from '@radix-ui/react-icons'
import { StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCArrayDatatype } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils/cn'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'
import React from 'react'

import { DimensionCell } from './editable-cell'

type DataTypeDimensionsTableProps = {
  name: string
  dimensions?: PLCArrayDatatype['dimensions']
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const DimensionsTable = ({ name, dimensions, selectedRow, handleRowClick }: DataTypeDimensionsTableProps) => {
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)
  const [tableData, setTableData] = useState<PLCArrayDatatype['dimensions']>(dimensions ? dimensions : [])

  const {
    workspaceActions: { updateDatatype },
    workspace: {
      projectData: { dataTypes },
    },
  } = useOpenPLCStore()

  const columnHelper = createColumnHelper<{ dimension: string }>()
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('dimension', {
        header: '',
        size: 300,
        minSize: 150,
        maxSize: 300,
        enableResizing: true,
        cell: (cellProps) => (
          <DimensionCell
            {...cellProps}
            onInputChange={(value) => handleInputChange(value, cellProps.row.index)}
            onBlur={() => handleBlur(cellProps.row.index)}
            id={`${cellProps.row.index}`}
            autoFocus={cellProps.row.index === focusIndex}
            name={name}
            dimensions={dimensions}
            selectedRow={selectedRow}
            handleRowClick={handleRowClick}
          />
        ),
      }),
    ],
    [focusIndex, name, dimensions, selectedRow, handleRowClick],
  )

  useEffect(() => {
    if (focusIndex !== null) {
      const inputElement = document.getElementById(`${focusIndex}`)
      if (inputElement) {
        inputElement.focus()
      }
    }
  }, [focusIndex])

  const handleInputChange = (value: string, index: number) => {
    setTableData((prevRows) => prevRows.map((row, i) => (i === index ? { ...row, dimension: value } : row)))
  }

  const handleBlur = (rowIndex: number) => {
    setTableData((prevRows) => {
      const newRows = prevRows.filter((_, index) => {
        const inputElement = document.getElementById(`dimension-input-${index}`) as HTMLInputElement
        return !(index === rowIndex && (!inputElement || inputElement.value.trim() === ''))
      })

      if (newRows.length !== prevRows.length) {
        return newRows
      } else {
        const inputElement = document.getElementById(`${rowIndex}`) as HTMLInputElement
        if (inputElement && inputElement.value.trim() !== '') {
          const newDataType = 'array'
          const optionalSchema = {
            name: inputElement.value.trim(),
            dimensions: [{ dimension: inputElement.value.trim() }],
          }
          updateDatatype(newDataType, optionalSchema)
        }
        return prevRows
      }
    })
  }

  const addNewRow = () => {
    setTableData((prevRows) => {
      const newRows = [...prevRows, { name: '', baseType: '', initialValue: '', dimensions: [{ dimension: '' }] }]
      setFocusIndex(newRows.length - 1)
      return newRows
    })
  }

  useEffect(() => {
    const dimensionsToTable = dataTypes.find((datatype) => datatype['name'] === name) as PLCArrayDatatype
    if (dimensionsToTable) setTableData(dimensionsToTable['dimensions'])
  }, [dataTypes])

  const resetBorders = () => {
    const parent = tableBodyRef.current
    if (!parent?.children) return

    const rows = Array.from(parent.children)
    rows.forEach((row) => {
      row.className = cn(
        row.className,
        '[&:last-child>td]:border-b-neutral-500 [&>td:first-child]:border-l-neutral-500 [&>td:last-child]:border-r-neutral-500 [&>td]:border-b-neutral-300',
        'dark:[&>td:first-child]:border-l-neutral-500 dark:[&>td:last-child]:border-r-neutral-500 dark:[&>td]:border-b-neutral-800',
        'shadow-none dark:shadow-none',
      )
    })
  }

  const setBorders = () => {
    const row = tableBodyRowRef.current
    const parent = tableBodyRef.current
    if (!row || !parent) return

    const element = row?.previousElementSibling

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
        className='flex h-fit w-full items-center justify-between'
      >
        <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
          Dimensions
        </p>
        <div
          aria-label='Data type table actions buttons container'
          className='flex h-full w-fit items-center justify-evenly *:rounded-md *:p-1'
        >
          <TableActionButton aria-label='Add table row button' onClick={addNewRow} id='add-new-row-button'>
            <PlusIcon className='!stroke-brand' />
          </TableActionButton>
          <TableActionButton aria-label='Remove table row button' onClick={() => console.log('Button clicked')}>
            <MinusIcon />
          </TableActionButton>
          <TableActionButton aria-label='Move table row up button' onClick={() => console.log('Button clicked')}>
            <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
          </TableActionButton>
          <TableActionButton aria-label='Move table row down button' onClick={() => console.log('Button clicked')}>
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
