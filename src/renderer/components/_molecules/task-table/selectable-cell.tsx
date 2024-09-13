import * as PrimitivePopover from '@radix-ui/react-popover'
import type { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'

type ISelectableCellProps = CellContext<PLCTask, unknown> & { editable?: boolean }

const triggerOptions = ['Cyclic', 'Interrupt']

const SelectableTriggerCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
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
      <SelectTrigger
        placeholder={cellValue as string}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          { 'pointer-events-none': !editable },
        )}
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {triggerOptions.map((option) => (
          <SelectItem
            key={option}
            value={option}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {_.startCase(option)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SelectableIntervalCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue()
  const [intervalModalOpen, setIntervalModalIsOpen] = useState(false)
  const [values, setValues] = useState({
    day: 0,
    hour: 0,
    min: 0,
    sec: 0,
    ms: 0,
    microsec: 0,
  })

  useEffect(() => {
    if (typeof initialValue === 'string') {
      const regex = /T#(\d+)d(\d+)h(\d+)m(\d+)s(\d+)ms/
      const match = initialValue.match(regex)
      if (match) {
        setValues({
          day: Number(match[1]),
          hour: Number(match[2]),
          min: Number(match[3]),
          sec: Number(match[4]),
          ms: Number(match[5]),
          microsec: 0, 
        })
      }
    }
  }, [initialValue])

  const formattedInterval = `T#${values.day}d${values.hour}h${values.min}m${values.sec}s${values.ms}ms`

  const handleBlur = () => {
    table.options.meta?.updateData(index, id, formattedInterval)
  }

  return (
    <PrimitivePopover.Root open={intervalModalOpen} onOpenChange={setIntervalModalIsOpen}>
      <PrimitivePopover.Trigger className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'>
        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
          {formattedInterval}
        </span>
      </PrimitivePopover.Trigger>
      <PrimitivePopover.Content
        sideOffset={3}
        className='flex h-20 w-[--radix-popover-trigger-width] items-center justify-center gap-2 rounded-lg bg-neutral-900 p-2'
      >
        {['day', 'hour', 'min', 'sec', 'ms', 'microsec'].map((interval) => (
          <div
            key={interval}
            className='flex h-full w-full flex-col justify-center gap-1 font-caption text-xs outline-none'
          >
            <label className='w-full text-neutral-950 dark:text-white' htmlFor={interval}>
              {interval}
            </label>
            <input
              onBlur={handleBlur}
              id={interval}
              type='number'
              className={cn(
                'h-5 w-full rounded-sm bg-white p-2 text-center text-cp-sm outline-none ring-brand focus:ring-2',
              )}
              value={values[interval as keyof typeof values]}
              onChange={(e) =>
                setValues((prevValues) => ({
                  ...prevValues,
                  [interval]: Number(e.target.value),
                }))
              }
            />
          </div>
        ))}
      </PrimitivePopover.Content>
    </PrimitivePopover.Root>
  )
}
export { SelectableIntervalCell, SelectableTriggerCell }
