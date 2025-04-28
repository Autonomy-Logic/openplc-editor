import { ScrollArea } from '@radix-ui/react-scroll-area'
import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { baseTypeSchema, PLCArrayDatatype } from '@root/types/PLC/open-plc'
import { ChangeEvent, ComponentPropsWithoutRef, useEffect, useState } from 'react'
import { DimensionsTable } from './table'

type ArrayDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCArrayDatatype
}

const ArrayDataType = ({ data, ...rest }: ArrayDatatypeProps) => {
  const {
    editor,
    projectActions: { updateDatatype },
    project: {
      data: { dataTypes },
    },
  } = useOpenPLCStore()
  const baseTypes = baseTypeSchema.options
  const allTypes = [
    ...baseTypes,
    ...dataTypes.map((type) => (type.name !== editor.meta.name ? type.name : '')).filter((type) => type !== ''),
  ]

  const ROWS_NOT_SELECTED = -1

  const [arrayTable, setArrayTable] = useState<{ selectedRow: number }>({ selectedRow: ROWS_NOT_SELECTED })
  const [initialValueData, setInitialValueData] = useState<string>('')
  const [baseType, setBaseType] = useState<string>(data.baseType.value)

  const [tableData, setTableData] = useState<PLCArrayDatatype['dimensions']>([])

  useEffect(() => {
    setTableData(data.dimensions)
  }, [data.dimensions])

  useEffect(() => {
    setInitialValueData(data.initialValue || '')
  }, [])

  useEffect(() => {
    setBaseType(data.baseType.value)
  }, [data.baseType])

  const handleInitialValueChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInitialValueData(e.target.value)
    const updatedData = { ...data }
    updatedData.initialValue = e.target.value
    updateDatatype(data.name, updatedData as PLCArrayDatatype)
  }

  const onSelectValueChange = (selectedValue: string) => {
    setBaseType(selectedValue)
    let isBaseType = false
    baseTypes.forEach((type) => {
      if (type === selectedValue) isBaseType = true
    })
    const updatedData = {
      ...data,
      baseType: {
        value: selectedValue,
        definition: isBaseType ? 'base-type' : 'user-data-type',
      },
    }
    updateDatatype(data.name, updatedData as PLCArrayDatatype)
  }

  const addNewRow = () => {
    setTableData((prevRows) => {
      const newRows = [...prevRows, { dimension: '' }]
      setArrayTable({ selectedRow: newRows.length - 1 })
      updateDatatype(data.name, { dimensions: newRows } as PLCArrayDatatype)
      return newRows
    })
  }

  const removeRow = () => {
    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null) {
        const newRows = prevRows.filter((_, index) => index !== arrayTable.selectedRow)

        const newFocusIndex = arrayTable.selectedRow === newRows.length ? newRows.length - 1 : arrayTable.selectedRow
        setArrayTable({ selectedRow: newFocusIndex })

        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map((row) => ({ dimension: row?.dimension })),
          }
          updateDatatype(data.name, optionalSchema as PLCArrayDatatype)
        })
        prevRows = newRows
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

        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map((row) => ({ dimension: row?.dimension })),
          }
          updateDatatype(data.name, optionalSchema as PLCArrayDatatype)
        })
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

        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map((row) => ({ dimension: row?.dimension })),
          }
          updateDatatype(data.name, optionalSchema as PLCArrayDatatype)
        })
        prevRows = newRows
      }
      return prevRows
    })
  }

  return (
    <div aria-label='Array data type container' className='flex h-full w-full flex-col gap-4 bg-transparent' {...rest}>
      <div aria-label='Data type content actions container' className='flex h-fit w-full'>
        <div aria-label='Array base type container' className='flex w-1/2 flex-col gap-3'>
          <div aria-label='Array base type content' className='flex h-fit w-full items-center justify-between'>
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
              Base Type
            </label>
            <Select
              aria-label='Array data type base type select'
              onValueChange={(e) => onSelectValueChange(e)}
              value={baseType}
            >
              <SelectTrigger
                withIndicator
                placeholder='BOOL'
                className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
              />
              <SelectContent
                position='popper'
                side='bottom'
                sideOffset={-28}
                className='box h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
              >
                <ScrollArea className='max-h-[300px] overflow-y-auto'>
                  {allTypes.map((type) => {
                    return (
                      <SelectItem
                        key={type}
                        value={type}
                        className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                          {type.toLocaleUpperCase()}
                        </span>
                      </SelectItem>
                    )
                  })}
                </ScrollArea>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div aria-label='Array initial value container' className='w-1/2'>
          <div
            aria-label='Array data type initial value container'
            className='flex h-fit w-full items-center justify-end'
          >
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100 '>
              Initial Value:
            </label>
            <InputWithRef
              onChange={handleInitialValueChange}
              value={initialValueData}
              className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 focus-within:border-brand focus:border-brand focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
            />
          </div>
        </div>
      </div>

      <div className='flex w-[600px] flex-col gap-3'>
        <div aria-label='Array data type table actions container' className='flex h-fit items-center justify-between'>
          <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
            Dimensions
          </p>
          <div
            aria-label='Data type table actions buttons container'
            className='flex-start flex h-full *:rounded-md *:p-1'
          >
            <TableActionButton aria-label='Add table row button' onClick={addNewRow} id='add-new-row-button'>
              <PlusIcon className='!stroke-brand' />
            </TableActionButton>
            <TableActionButton aria-label='Remove table row button' onClick={removeRow}>
              <MinusIcon className='stroke-[#0464FB]' />
            </TableActionButton>
            <TableActionButton
              aria-label='Move table row up button'
              onClick={moveRowUp}
              disabled={arrayTable.selectedRow === ROWS_NOT_SELECTED || arrayTable.selectedRow === 0}
            >
              <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
            </TableActionButton>
            <TableActionButton
              aria-label='Move table row down button'
              onClick={moveRowDown}
              disabled={arrayTable.selectedRow === ROWS_NOT_SELECTED || arrayTable.selectedRow === tableData.length - 1}
            >
              <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
            </TableActionButton>
          </div>
        </div>

        <DimensionsTable
          name={data.name}
          tableData={tableData}
          handleRowClick={(row) => setArrayTable({ selectedRow: parseInt(row.id) })}
          selectedRow={arrayTable.selectedRow}
          setArrayTable={setArrayTable}
        />
      </div>
    </div>
  )
}

export { ArrayDataType }
