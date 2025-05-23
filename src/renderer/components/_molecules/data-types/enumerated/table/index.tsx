import { GenericDataTypeTable } from '@root/renderer/components/_atoms/generic-data-type-table'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { enumeratedValidation } from '@root/renderer/store/slices/project/validation/variables'
import { PLCDataType, PLCEnumeratedDatatype } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils/cn'
import { createColumnHelper, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import React, { useEffect, useRef } from 'react'

import { DescriptionCell } from './editable-cell'

type DataTypeEnumeratedTableProps = {
  name: string
  values: PLCEnumeratedDatatype['values']
  initialValue?: string
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
  setArrayTable: React.Dispatch<React.SetStateAction<{ selectedRow: number }>>
}

const EnumeratedTable = ({
  name,
  values,
  initialValue,
  selectedRow,
  handleRowClick,
  setArrayTable,
}: DataTypeEnumeratedTableProps) => {
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)

  const {
    projectActions: { updateDatatype },
  } = useOpenPLCStore()

  const columnHelper = createColumnHelper<{ description: string }>()
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('description', {
        size: 900,
        minSize: 350,
        maxSize: 900,
        enableResizing: true,
        cell: (cellProps) => (
          <DescriptionCell
            key={cellProps.row.id}
            onBlur={() => handleBlur(cellProps.row.index)}
            id={`description-input-${cellProps.row.index}`}
            selectedRow={selectedRow === cellProps.row.index ? selectedRow : -1}
            {...cellProps}
          />
        ),
      }),
    ],
    [values, name, selectedRow, initialValue],
  )

  const handleBlur = (rowIndex: number) => {
    const prevRows = [...values]
    console.log('rowIndex', rowIndex)
    const inputElement = document.getElementById(`description-input-${rowIndex}`) as HTMLInputElement
    if (inputElement) {
      const inputValue = inputElement.value.trim()

      if (inputValue === '') {
        const newRows = prevRows.filter((_, index) => index !== rowIndex)
        const optionalSchema = {
          name: name,
          values: newRows.map((row) => ({ description: row.description })),
          initialValue: initialValue,
        }
        updateDatatype(name, optionalSchema as PLCDataType)
        resetBorders()
        setArrayTable({ selectedRow: -1 })
        toast({
          title: 'Row removed',
          description: `The row was removed because the value was empty.`,
          variant: 'fail',
        })
        return newRows
      }

      if (prevRows[rowIndex].description === inputValue) {
        return prevRows
      }

      const validation = enumeratedValidation({ value: inputValue })
      const checkIfExists = prevRows.some((row, i) => i !== rowIndex && row.description === inputValue)

      if (checkIfExists) {
        const newRows = prevRows.filter((_, index) => index !== rowIndex)
        const optionalSchema = {
          name: name,
          values: newRows.map((row) => ({ description: row.description })),
          initialValue: initialValue,
        }
        updateDatatype(name, optionalSchema as PLCDataType)
        resetBorders()
        setArrayTable({ selectedRow: -1 })
        toast({
          title: 'Value already exists',
          description: `The value already exists in the list.`,
          variant: 'fail',
        })
        return newRows
      }

      if (!validation.ok) {
        const newRows = prevRows.filter((_, index) => index !== rowIndex)
        const optionalSchema = {
          name: name,
          values: newRows.map((row) => ({ description: row.description })),
          initialValue: initialValue,
        }
        updateDatatype(name, optionalSchema as PLCDataType)
        resetBorders()
        setArrayTable({ selectedRow: -1 })
        toast({
          title: 'Invalid enumerated value',
          description: `The enumerated value is invalid. Valid names: CamelCase, PascalCase or SnakeCase.`,
          variant: 'fail',
        })
        return newRows
      } else {
        const newRows = prevRows.map((row, index) => ({
          ...row,
          description: index === rowIndex ? inputValue : row.description,
        }))
        const optionalSchema = {
          name: name,
          values: newRows.map((row) => ({ description: row.description })),
          initialValue: initialValue,
        }
        updateDatatype(name, optionalSchema as PLCDataType)
        return newRows
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
    data: values,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  })

  return (
    <GenericDataTypeTable
      context='data-type-enumerated'
      table={table}
      selectedRow={selectedRow}
      tableBodyRef={tableBodyRef}
      tableBodyRowRef={tableBodyRowRef}
      handleRowClick={handleRowClick}
    />
  )
}

export { EnumeratedTable }
