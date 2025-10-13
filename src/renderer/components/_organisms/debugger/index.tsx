import * as Select from '@radix-ui/react-select'
import { ArrowIcon, PauseIcon, PlayIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { calculateCommonTickTime } from '@root/utils/task-interval-utils'
import { useMemo, useState } from 'react'

import { Button } from '../../_atoms'
import { LineChart } from '../../_molecules/charts/line-chart'

type DebuggerData = {
  graphList: string[]
}

const Debugger = ({ graphList }: DebuggerData) => {
  const [isPaused, setIsPaused] = useState(false)
  const [range, setRange] = useState(10)

  const {
    project: {
      data: {
        configuration: {
          resource: { tasks },
        },
      },
    },
  } = useOpenPLCStore()

  const commonTickTime = useMemo(() => calculateCommonTickTime(tasks), [tasks])

  const updateRange = (value: number) => {
    if (value > 100) {
      setRange(100)
    } else {
      setRange(value)
    }
  }

  return (
    <div className='h-full w-full text-cp-sm'>
      <div className='flex h-full w-full flex-col gap-1 rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-900'>
        <div className='header relative flex justify-between'>
          <div className='flex '>
            <span className='flex h-7 select-none items-center justify-center rounded-md bg-inherit  p-2 text-cp-sm font-medium text-neutral-1000 outline-none  dark:text-white'>
              Range
            </span>
            <div className='relative z-[999999] flex gap-2'>
              <Select.Root onValueChange={(value) => updateRange(Number(value))}>
                <Select.Trigger
                  value={String(range)}
                  className='bg-neultral-100 flex h-7 w-[88px] items-center justify-between rounded-md border border-neutral-200 px-2 outline-none dark:bg-neutral-900 dark:text-neutral-50'
                >
                  {range > 59 && (
                    <div className='flex gap-1'>
                      {range >= 60 ? '1' : ''} minute{'s'}
                    </div>
                  )}
                  {range < 60 && (
                    <div className='flex gap-1'>
                      {range} second{'s'}
                    </div>
                  )}
                  <ArrowIcon direction='down' className='stroke-brand' />
                </Select.Trigger>

                <Select.Content
                  sideOffset={1}
                  position='popper'
                  align='center'
                  side='bottom'
                  className='z-[999999] w-[--radix-select-trigger-width] flex-col gap-1 overflow-hidden rounded-md border border-neutral-200 bg-white dark:bg-neutral-900'
                >
                  {[1, 2, 60].map((value) => (
                    <Select.Item
                      key={value}
                      className='w-full cursor-pointer rounded-sm p-1 hover:bg-neutral-100 dark:hover:bg-neutral-850'
                      value={String(value)}
                    >
                      {value === 60 ? '1 minute' : `${value} second${value > 1 ? 's' : ''}`}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          <div aria-label='Debugger header' className='flex justify-between '>
            <div className='flex gap-4'>
              <Button
                onClick={() => setIsPaused(!isPaused)}
                className='h-7 w-[38px] items-center justify-center rounded-md bg-brand  p-0 outline-none'
              >
                {isPaused ? (
                  <PlayIcon fill='#FFFFFF' className='h-fit w-[10px]' />
                ) : (
                  <PauseIcon fill='#FFFFFF' className='h-fit w-[10px]' />
                )}
              </Button>
            </div>
          </div>
        </div>
        <div className='chart-content flex h-auto w-full flex-col gap-2 overflow-y-auto overflow-x-hidden'>
          {graphList.map((variableName) => (
            <LineChart
              key={variableName}
              variableName={variableName}
              isPaused={isPaused}
              range={range}
              commonTickTime={commonTickTime}
            />
          ))}
        </div>
      </div>
      <div className='flex w-full justify-between p-[6px] pb-0 text-cp-base font-semibold text-neutral-1000 dark:text-neutral-50'>
        <div>
          <span>time</span>
          <p className='font-normal'>0m 0s 0ms</p>
        </div>
        <div>
          <span>ticks</span>
          <p className='font-normal'>0</p>
        </div>
      </div>
    </div>
  )
}

export { Debugger }
