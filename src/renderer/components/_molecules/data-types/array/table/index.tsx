import { GenericDataTypeTable } from '@root/renderer/components/_atoms/generic-data-type-table'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { arrayValidation } from '@root/renderer/store/slices/project/validation/variables'
import { PLCArrayDatatype, PLCDataType } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils/cn'
import { createColumnHelper, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import React, { useEffect, useRef } from 'react'

import { DimensionCell } from './editable-cell'

type DataTypeDimensionsTableProps = {
  name: string
  tableData: PLCArrayDatatype['dimensions']
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
  setArrayTable: React.Dispatch<React.SetStateAction<{ selectedRow: number }>>
}

const DimensionsTable = ({
  name,
  tableData,
  selectedRow,
  handleRowClick,
  setArrayTable,
}: DataTypeDimensionsTableProps) => {
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)

  const {
    editor,
    projectActions: { updateDatatype, pushToHistory },
  } = useOpenPLCStore()

  const columnHelper = createColumnHelper<{ dimension: string }>()
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('dimension', {
        size: 900,
        minSize: 350,
        maxSize: 900,
        enableResizing: true,

        cell: (cellProps) => (
          <DimensionCell
            id={`dimension-input-${cellProps.row.index}`}
            key={cellProps.row.id}
            onBlur={() => handleBlur(cellProps.row.index)}
            selectedRow={selectedRow === cellProps.row.index ? selectedRow : -1}
            {...cellProps}
          />
        ),
      }),
    ],
    [name, selectedRow],
  )

  const handleBlur = (rowIndex: number) => {
    const inputElement = document.getElementById(`dimension-input-${rowIndex}`) as HTMLInputElement
    const prevRows = tableData

    if (inputElement) {
      const inputValue = inputElement.value.trim()
      const validation = arrayValidation({ value: inputValue })

      if (!validation.ok || inputValue === '') {
        pushToHistory(editor.meta.name)

        const newRows = prevRows.filter((_, index) => index !== rowIndex)
        const optionalSchema = {
          name: name,
          dimensions: newRows.map((row) => ({ dimension: row.dimension })),
        }
        updateDatatype(name, optionalSchema as PLCArrayDatatype)
        setArrayTable({ selectedRow: -1 })
        toast({
          title: 'Invalid array',
          description: `The array value is invalid. Pattern: "LEFT_number..RIGHT_number" and RIGHT must be GREATER than LEFT. Example: 0..10.`,
          variant: 'fail',
        })
      } else {
        pushToHistory(editor.meta.name)

        const newRows = prevRows.map((row, index) => ({
          ...row,
          dimension: index === rowIndex ? inputValue : row.dimension,
        }))
        const optionalSchema = {
          name: name,
          dimensions: newRows.map((row) => ({ dimension: row.dimension })),
        }
        updateDatatype(name, optionalSchema as PLCDataType)
      }
    }
  }

  const resetBorders = () => {
    const parent = tableBodyRef.current
    if (!parent?.children) return

    const rows = Array.from(parent.children)
    rows.forEach((row) => {
      row.className = cn(
        row.className,
        '[&:last-child>td]:border-b-neutral-500 [&>td:first-child]:border-l-neutral-500 [&>td:last-child]:border-r-neutral-500 [&>td]:border-b-neutral-300',
        'dark:[&>td:first-child]:border-l-neutral-500 dark:[&>td:last-child]:border-r-neutral-500 dark:[&>td]:border-b-neutral-800',
        '[&:first-child>td]:border-t-neutral-500 dark:[&:first-child>td]:border-t-neutral-500',
        'shadow-none dark:shadow-none',
      )
    })
  }

  const setBorders = () => {
    const row = tableBodyRowRef.current
    const parent = tableBodyRef.current
    if (!row || !parent) return

    const element = row?.previousElementSibling ? row?.previousElementSibling : parent?.children[0]

    element.className = cn(element.className, '[&>td]:border-b-brand dark:[&>td]:border-b-brand')

    // First row
    if (row === element) {
      row.className = cn(row.className, '[&:first-child>td]:border-t-brand dark:[&:first-child>td]:border-t-brand')
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
    <GenericDataTypeTable
      context='data-type-array'
      table={table}
      selectedRow={selectedRow}
      tableBodyRef={tableBodyRef}
      tableBodyRowRef={tableBodyRowRef}
      handleRowClick={handleRowClick}
    />
  )
}

export { DimensionsTable }
