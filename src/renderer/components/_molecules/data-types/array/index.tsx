import { ScrollArea } from '@radix-ui/react-scroll-area'
import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { baseTypeSchema, PLCArrayDatatype } from '@root/types/PLC/open-plc'
import _ from 'lodash'
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
  const [arrayTable, setArrayTable] = useState<{ selectedRow: string }>({ selectedRow: ROWS_NOT_SELECTED.toString() })
  const [initialValueData, setInitialValueData] = useState<string>('')
  const [baseType, setBaseType] = useState<string>(data.baseType.value)

  useEffect(() => {
    setInitialValueData(data.initialValue || '')
  }, [])

  useEffect(() => {
    setBaseType(data.baseType.value)
  }, [data.baseType])

  const handleInitialValueChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInitialValueData(e.target.value)
    _.debounce(() => {
      const updatedData = { ...data }
      updatedData.initialValue = e.target.value
      updateDatatype(data.name, updatedData as PLCArrayDatatype)
    }, 1000)()
  }

  const onSelectValueChange = (selectedValue: string) => {
    setBaseType(selectedValue)
    _.debounce(() => {
      let isBaseType = false
      baseTypes.forEach((type) => {
        if (type === selectedValue) isBaseType = true
      })
      const updatedData = {
        ...data,
        type: {
          value: selectedValue,
          definition: isBaseType ? 'base-type' : 'user-data-type',
        },
      }
      updateDatatype(data.name, updatedData as PLCArrayDatatype)
    }, 100)()
  }

  return (
    <div aria-label='Array data type container' className='flex h-full w-full flex-col gap-4 bg-transparent' {...rest}>
      <div aria-label='Data type content actions container' className='flex h-fit w-full gap-8'>
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
              Initial Value
            </label>
            <InputWithRef
              onChange={handleInitialValueChange}
              value={initialValueData}
              className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 focus-within:border-brand focus:border-brand focus:outline-none dark:border-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:bg-neutral-950 dark:text-neutral-100'
            />
          </div>
        </div>
      </div>

      <DimensionsTable
        name={data.name}
        dimensions={data.dimensions}
        handleRowClick={(row) => setArrayTable({ selectedRow: row.id })}
        selectedRow={parseInt(arrayTable.selectedRow)}
      />
    </div>
  )
}

export { ArrayDataType }
