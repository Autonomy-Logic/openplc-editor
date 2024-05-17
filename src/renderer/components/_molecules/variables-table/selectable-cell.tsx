import { CellContext } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { IVariable } from '.'

type ISelectableCellProps = CellContext<IVariable, unknown>

const VariableTypes = ['BOOL', 'INT', 'DATE']

const SelectableTypeCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const _onBlur = () => {
    // Todo: Must update the data in the store
    table.options.meta?.updateData(index, id, cellValue)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])
  return (
    <Select value={cellValue as string} onValueChange={(value) => setCellValue(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className='flex h-full w-full justify-center font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300'
      />
      <SelectContent
        position='item-aligned'
        className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
      >
        {VariableTypes.map((type) => (
          <SelectItem
            key={type}
            value={type}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {type}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
const VariableClasses = ['input', 'output', 'inOut', 'external', 'local', 'temp']

const SelectableClassCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const _onBlur = () => {
    // Todo: Must update the data in the store
    table.options.meta?.updateData(index, id, cellValue)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => setCellValue(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className='flex h-full w-full justify-center font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300'
      />
      <SelectContent
        position='item-aligned'
        className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
      >
        {VariableClasses.map((type) => (
          <SelectItem
            key={type}
            value={type}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {type}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { SelectableClassCell, SelectableTypeCell }
