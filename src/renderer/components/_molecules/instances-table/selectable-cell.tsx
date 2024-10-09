import { useOpenPLCStore } from '@root/renderer/store'
import { PLCInstance } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'

type ISelectableCellProps = CellContext<PLCInstance, unknown> & { editable?: boolean }
const SelectableTaskCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const {
    project: {
      data: {
        configuration: {
          resource: { tasks },
        },
      },
    },
  } = useOpenPLCStore()
  const initialValue = getValue()

  const [cellValue, setCellValue] = useState(initialValue)

  const onValueChange = (value: string) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => onValueChange(value)}>
      {!_.isEmpty(tasks) && (
        <SelectTrigger
          placeholder={cellValue as string}
          className={cn(
            'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
            { 'pointer-events-none': !editable },
          )}
        />
      )}
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit max-h-[300px] w-[200px] overflow-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {tasks.map(
          (option) =>
            option.name !== 'undefined' &&
            option.name !== '' && (
              <SelectItem
                key={option.name}
                value={option.name}
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                  {option.name}
                </span>
              </SelectItem>
            ),
        )}
      </SelectContent>
    </Select>
  )
}
const SelectableProgramCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const {
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()
  const initialValue = getValue<string>()

  const [cellValue, setCellValue] = useState<string>(initialValue)

  const onValueChange = (value: string) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue} onValueChange={onValueChange}>
      {!_.isEmpty(pous) && (
        <SelectTrigger
          placeholder={cellValue}
          className={cn(
            'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
            { 'pointer-events-none': !editable },
          )}
        />
      )}
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit max-h-[300px] w-[200px] overflow-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {pous
          .filter((option) => option.type === 'program')
          .map((option) => (
            <SelectItem
              key={option.data.name}
              value={option.data.name}
              className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
            >
              <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                {option.data.name}
              </span>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

export { SelectableProgramCell, SelectableTaskCell }
