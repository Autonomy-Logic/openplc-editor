import { MinusIcon, PlusIcon } from '@radix-ui/react-icons'
import { StickArrowIcon } from '@root/renderer/assets'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCEnumeratedDatatype } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'

import { EnumeratedTable } from './table'

type EnumDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCEnumeratedDatatype
}
const EnumeratorDataType = ({ data, ...rest }: EnumDatatypeProps) => {
  const {
    projectActions: { updateDatatype },
  } = useOpenPLCStore()
  const ROWS_NOT_SELECTED = -1

  const [arrayTable, setArrayTable] = useState<{ selectedRow: number }>({ selectedRow: ROWS_NOT_SELECTED })
  const [initialValueData, setInitialValueData] = useState<string>('')

  const [tableData, setTableData] = useState<PLCEnumeratedDatatype['values']>([])

  useEffect(() => {
    setInitialValueData(data.initialValue || '')
  }, [])

  useEffect(() => {
    setTableData(data.values)
  }, [data.values])

  const handleInitialValueChange = (value: string) => {
    setInitialValueData(value)
    updateDatatype(data.name, {
      ...data,
      initialValue: value,
    })
  }

  const addNewRow = () => {
    setTableData((prevRows) => {
      const newRows = [...prevRows, { description: '' }]
      setArrayTable({ selectedRow: newRows.length - 1 })
      updateDatatype(data.name, {
        values: newRows.map((row) => ({ description: row?.description })),
        initialValue: data.initialValue,
      } as PLCEnumeratedDatatype)
      return newRows
    })
  }

  const removeRow = () => {
    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null) {
        const newRows = prevRows.filter((_, index) => index !== arrayTable.selectedRow)

        const newFocusIndex = arrayTable.selectedRow === newRows.length ? newRows.length - 1 : arrayTable.selectedRow
        setArrayTable({ selectedRow: newFocusIndex })

        updateDatatype(data.name, {
          values: newRows.map((row) => ({ description: row?.description })),
          initialValue: data.initialValue,
        } as PLCEnumeratedDatatype)

        return newRows
      }
      return prevRows
    })
  }

  const moveRowUp = () => {
    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null && arrayTable.selectedRow > 0) {
        const newRows = [...prevRows]
        const temp = newRows[arrayTable.selectedRow]
        newRows[arrayTable.selectedRow] = newRows[arrayTable.selectedRow - 1]
        newRows[arrayTable.selectedRow - 1] = temp

        const newFocusIndex = arrayTable.selectedRow - 1
        setArrayTable({ selectedRow: newFocusIndex })

        updateDatatype(data.name, {
          values: newRows.map((row) => ({ description: row?.description })),
          initialValue: data.initialValue,
        } as PLCEnumeratedDatatype)

        prevRows = newRows
      }
      return prevRows
    })
  }

  const moveRowDown = () => {
    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null && arrayTable.selectedRow < prevRows.length - 1) {
        const newRows = [...prevRows]
        const temp = newRows[arrayTable.selectedRow]
        newRows[arrayTable.selectedRow] = newRows[arrayTable.selectedRow + 1]
        newRows[arrayTable.selectedRow + 1] = temp

        const newFocusIndex = arrayTable.selectedRow + 1
        setArrayTable({ selectedRow: newFocusIndex })

        updateDatatype(data.name, {
          values: newRows.map((row) => ({ description: row?.description })),
          initialValue: data.initialValue,
        } as PLCEnumeratedDatatype)

        prevRows = newRows
      }
      return prevRows
    })
  }

  return (
    <div
      aria-label='Enumerated data type container'
      className='flex h-full w-full flex-1 flex-col gap-4 overflow-hidden bg-transparent'
      {...rest}
    >
      <div aria-label='Data type content actions container' className='flex h-8 w-full gap-8'>
        <div aria-label='Enumerated base type container' className='flex w-1/2 flex-col gap-3'></div>
        <div aria-label='Enumerated initial value container' className='w-1/2'>
          <div
            aria-label='Enumerated data type initial value container'
            className='h- flex w-full items-center justify-end'
          >
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100 '>
              Initial Value:
            </label>
            <Select
              onValueChange={(value) =>
                value === 'none' ? handleInitialValueChange('') : handleInitialValueChange(value)
              }
              value={initialValueData === '' ? '' : initialValueData}
            >
              <SelectTrigger
                withIndicator
                className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 focus-within:border-brand focus:border-brand focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
              >
                {initialValueData === '' ? '' : initialValueData}
              </SelectTrigger>
              <SelectContent className='box h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-auto rounded-lg bg-white outline-none dark:bg-neutral-950'>
                <SelectItem
                  value='none'
                  className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                >
                  <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'></span>
                </SelectItem>
                {data.values.map((value) => (
                  <>
                    {value.description !== '' && (
                      <SelectItem
                        key={value.description}
                        value={value.description}
                        className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                          {value.description}
                        </span>
                      </SelectItem>
                    )}
                  </>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
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
            disabled={arrayTable.selectedRow === null || arrayTable.selectedRow === 0 || arrayTable.selectedRow === -1}
            onClick={() => moveRowUp()}
          >
            <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
          </TableActionButton>
          <TableActionButton
            aria-label='Move table row down button'
            disabled={
              arrayTable.selectedRow === null ||
              arrayTable.selectedRow === tableData.length - 1 ||
              tableData.length === 1 ||
              arrayTable.selectedRow === -1
            }
            onClick={() => moveRowDown()}
          >
            <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
          </TableActionButton>
        </div>
      </div>

      <EnumeratedTable
        name={data.name}
        values={tableData}
        initialValue={initialValueData}
        selectedRow={arrayTable.selectedRow}
        handleRowClick={(row) => setArrayTable({ selectedRow: parseInt(row.id) })}
        setArrayTable={setArrayTable}
      />
    </div>
  )
}

export { EnumeratorDataType }
