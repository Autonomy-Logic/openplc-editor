import { Table, TableBody, TableCell, TableRow } from '@components/_atoms'
import { MinusIcon, PlusIcon } from '@radix-ui/react-icons'
import { StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { enumeratedValidation } from '@root/renderer/store/slices/project/utils/variables'
import { PLCDataType, PLCEnumeratedDatatype } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils/cn'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'
import React from 'react'

import { DescriptionCell } from './editable-cell'

type DataTypeEnumeratedTableProps = {
  name: string
  values: PLCEnumeratedDatatype['values']
  initialValue?: string
}

const EnumeratedTable = ({ name, values, initialValue }: DataTypeEnumeratedTableProps) => {
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const [tableData, setTableData] = useState<PLCEnumeratedDatatype['values']>(values)
  const [selectedRow, setSelectedRow] = useState<number>(-1)

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
            onInputChange={(value) => handleInputChange(value, cellProps.row.index)}
            onBlur={() => handleBlur(cellProps.row.index)}
            id={`description-input-${cellProps.row.index}`}
            autoFocus={cellProps.row.index === focusIndex}
            selectedRow={selectedRow}
            {...cellProps}
          />
        ),
      }),
    ],
    [focusIndex, values, name, selectedRow, initialValue],
  )

  useEffect(() => {
    setTableData([...values])
  }, [values])

  useEffect(() => {
    if (focusIndex !== null) {
      const inputElement = document.getElementById(`description-input-${focusIndex}`)
      if (inputElement) {
        inputElement.focus()
      }
    }
  }, [focusIndex])

  useEffect(() => {
    setFocusIndex(selectedRow)
  }, [selectedRow])

  const handleInputChange = (inputValue: string, index: number) => {
    setTableData((prevRows) => prevRows.map((row, i) => (i === index ? { ...row, value: inputValue } : row)))
    setFocusIndex(index)
  }

  const updateDescriptions = (newValues: PLCEnumeratedDatatype['values']) => {
    newValues.map((row) => ({ description: row.description }))
  }

  const handleSelectRow = (index: number) => {
    if (focusIndex !== null) {
      const inputElement = document.getElementById(`description-input-${focusIndex}`) as HTMLInputElement
      if (inputElement) {
        const inputValue = inputElement.value.trim()
        if (inputValue !== tableData[focusIndex]?.description) {
          setTableData((prevRows) => {
            const newRows = [...prevRows]
            newRows[focusIndex] = { ...newRows[focusIndex], description: inputValue }
            return newRows
          })
        }
      }
    }
    setSelectedRow(index)
    setFocusIndex(index)
  }

  const handleBlur = (rowIndex: number) => {
    if (rowIndex !== selectedRow) {
      setTableData((prevRows) => {
        const inputElement = document.getElementById(`description-input-${rowIndex}`) as HTMLInputElement
        if (inputElement) {
          const inputValue = inputElement.value.trim()

          if (inputValue === '') {
            const newRows = prevRows.filter((_, index) => index !== rowIndex)
            updateDescriptions(newRows)
            setFocusIndex(null)
            toast({
              title: 'Row removed',
              description: `The row was removed because the value was empty.`,
              variant: 'fail',
            })
            return newRows
          }

          if (prevRows[rowIndex].description === inputValue) {
            setFocusIndex(null)
            return prevRows
          }

          const validation = enumeratedValidation({ value: inputValue })
          const checkIfExists = prevRows.some((row, i) => i !== rowIndex && row.description === inputValue)

          if (checkIfExists) {
            const newRows = prevRows.filter((_, index) => index !== rowIndex)
            updateDescriptions(newRows)
            setFocusIndex(null)
            toast({
              title: 'Value already exists',
              description: `The value already exists in the list.`,
              variant: 'fail',
            })
            return newRows
          }

          if (!validation.ok) {
            const newRows = prevRows.filter((_, index) => index !== rowIndex)
            updateDescriptions(newRows)
            setFocusIndex(null)
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
            updateDescriptions(newRows)
            return newRows
          }
        }
        setFocusIndex(null)
        return prevRows
      })
    }
  }

  useEffect(() => {
    if (initialValue !== '') {
      updateDatatype(name, {
        values,
        derivation: 'enumerated',
        name,
        initialValue: initialValue,
      })
    } else {
      updateDatatype(name, {
        initialValue: '',
        values,
        derivation: 'enumerated',
        name,
      })
    }
  }, [initialValue,name])

  const addNewRow = () => {
    setTableData((prevRows) => {
      const newRows = [...prevRows, { description: '' }]
      setFocusIndex(newRows?.length - 1)
      resetBorders()
      return newRows
    })
  }

  const removeRow = () => {
    setTableData((prevRows) => {
      if (focusIndex !== null) {
        const newRows = prevRows.filter((_, index) => index !== focusIndex)

        updateDatatype(name, {
          values: newRows.map((row) => ({ description: row?.description })),
          initialValue: initialValue,
        } as PLCEnumeratedDatatype)

        let newFocusIndex = focusIndex
        if (focusIndex === prevRows.length - 1) {
          newFocusIndex = prevRows.length - 2
        }

        setFocusIndex(newFocusIndex)

        return newRows
      }
      return prevRows
    })
  }
  const moveRow = (direction: 'up' | 'down') => {
    if (focusIndex === null) return

    const inputElement = document.getElementById(`description-input-${focusIndex}`) as HTMLInputElement
    if (inputElement) {
      const inputValue = inputElement.value.trim()
      if (inputValue !== tableData[focusIndex]?.description) {
        setTableData((prevRows) => {
          const newRows = [...prevRows]
          newRows[focusIndex] = { ...newRows[focusIndex], description: inputValue }
          return newRows
        })
      }
    }

    setTableData((prevRows) => {
      const newRows = [...prevRows]
      const swapIndex = direction === 'up' ? focusIndex - 1 : focusIndex + 1

      if (swapIndex >= 0 && swapIndex < prevRows.length) {
        ;[newRows[focusIndex], newRows[swapIndex]] = [newRows[swapIndex], newRows[focusIndex]]
        setFocusIndex(swapIndex)
        setSelectedRow(swapIndex)
      }
      return newRows
    })
  }

  useEffect(() => {
    setTableData([...values])
  }, [values])

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

    const rows = Array.from(parent.children)

    if (indexFocus !== null) {
      rows.forEach((child, index) => {
        if (index !== indexFocus) {
          child.className = cn(child.className, '[&>td]:border-neutral-500 dark:[&>td]:border-neutral-500')
        }
      })

      const currentRow = rows[indexFocus]
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
    <div className='flex w-full flex-auto flex-col gap-4 overflow-hidden'>
      <div aria-label='Enum data type table actions container' className='flex h-8 w-3/5 items-center justify-between'>
        <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
          Description
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
          <TableActionButton
            aria-label='Move table row up button'
            disabled={focusIndex === null || focusIndex === 0 || focusIndex === -1}
            onClick={() => moveRow('up')}
          >
            <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
          </TableActionButton>
          <TableActionButton
            aria-label='Move table row down button'
            disabled={
              focusIndex === null || focusIndex === tableData.length - 1 || tableData.length === 1 || focusIndex === -1
            }
            onClick={() => moveRow('down')}
          >
            <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
          </TableActionButton>
        </div>
      </div>
      <div className='flex h-fit  w-[355px] scroll-ml-1 overflow-y-auto'>
        <Table context='data-type-enumerated'>
          <TableBody ref={tableBodyRef}>
            {table.getRowModel().rows.map((row, index) => (
              <TableRow
                id={`${index}`}
                key={index}
                className='h-8'
                selected={selectedRow === index}
                ref={selectedRow === index ? tableBodyRowRef : null}
                onClick={() => handleSelectRow(index)}
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
      </div>
    </div>
  )
}

export { EnumeratedTable }
