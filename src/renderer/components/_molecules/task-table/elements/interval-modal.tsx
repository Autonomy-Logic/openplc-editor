import * as PrimitivePopover from '@radix-ui/react-popover'
import { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useState } from 'react'


type IIntervalModalProps = {
  intervalModalOpen: boolean
  setIntervalModalIsOpen: (value: boolean) => void
  currentTask: PLCTask
  updateTaskInterval: (taskId: string | undefined, interval: string) => void
}

export default function IntervalModal({
  intervalModalOpen,
  setIntervalModalIsOpen,
  currentTask,
  updateTaskInterval,
}: IIntervalModalProps) {
  const intervals = ['day', 'hour', 'min', 'sec', 'ms', 'microsec']
  const [values, setValues] = useState({
    day: 0,
    hour: 0,
    min: 0,
    sec: 0,
    ms: 0,
    microsec: 0,
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    setValues((prevValues) => ({
      ...prevValues,
      [id]: Number(value), 
    }))
  }

  const formattedInterval = `T#${values.day}d${values.hour}h${values.min}m${values.sec}s${values.ms}ms`

  const handleBlur = () => {
    updateTaskInterval(currentTask.id, formattedInterval)
  }


  return (
    <PrimitivePopover.Root open={intervalModalOpen} onOpenChange={setIntervalModalIsOpen}>
      <PrimitivePopover.Trigger
        className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'
        onClick={() => setIntervalModalIsOpen(true)}
      >
        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
          {formattedInterval}
        </span>
      </PrimitivePopover.Trigger>
      <PrimitivePopover.Content
        sideOffset={3}
        className='flex h-20 w-[--radix-popover-trigger-width] items-center justify-center gap-2 rounded-lg bg-neutral-900 p-2'
      >
        {intervals.map((interval) => (
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
              onChange={handleChange}
            />
          </div>
        ))}
    
      </PrimitivePopover.Content>
    </PrimitivePopover.Root>
  )
}
