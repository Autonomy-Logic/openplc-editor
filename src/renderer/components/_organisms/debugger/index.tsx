import * as Select from '@radix-ui/react-select'
import { DebuggerIcon } from '@root/renderer/assets'
import { useState } from 'react'

import LineGraph from '../../_molecules/charts/lineGraph'
import Header from '../../_molecules/header'

type DebuggerData = {
  graphList: string[]
}

export default function Debugger({ graphList }: DebuggerData) {
  const [isPaused, setIsPaused] = useState(false)
  const [range, setRange] = useState(10)
  const [data, setData] = useState(false)

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
          <div className='flex gap-4'>
            <div className='flex h-7 w-[133px] select-none items-center justify-center gap-2 rounded-md bg-inherit bg-neutral-100 text-cp-sm font-medium text-neutral-1000 outline-none dark:bg-brand-dark dark:text-white'>
              <DebuggerIcon fill='#0464fb' className='h-3 w-3 stroke-brand' /> debugger terminal
            </div>
            <div className='flex gap-2'>
          
              <Select.Root onValueChange={(value) => updateRange(Number(value))}>
                <Select.Trigger
                  value={String(range)}
                  className='h-7 flex justify-between px-2 items-center w-[88px] rounded-md border border-neutral-200 bg-inherit outline-none dark:text-neutral-50'
                >
                  <p>{range}</p>
                  <Select.Icon />
                </Select.Trigger>

                <Select.Content
                  sideOffset={1}
                  position='popper'
                  align='center'
                  side='bottom'
                  className='w-[--radix-select-trigger-width] flex-col rounded-sm px-2 gap-1 border border-neutral-200 '
                >
                  <Select.Item
                    className='w-full cursor-pointer rounded-sm p-1 hover:bg-neutral-100 dark:hover:bg-neutral-200'
                    value={'1'}
                  >
                    1 second
                  </Select.Item>
                  <Select.Item
                    className='w-full cursor-pointer rounded-sm p-1 hover:bg-neutral-100 dark:hover:bg-neutral-200'
                    value={'2'}
                  >
                    2 seconds
                  </Select.Item>
                  <Select.Item
                    className='w-full cursor-pointer rounded-sm p-1 hover:bg-neutral-100 dark:hover:bg-neutral-200'
                    value={'60'}
                  >
                    1 min
                  </Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div className='flex gap-2'>
            <Header isPaused={isPaused} setIsPaused={setIsPaused} />
          </div>
        </div>
        <div className='chart-content flex h-auto w-full flex-col gap-2 overflow-y-auto overflow-x-hidden'>
          {graphList.map((variableName, index) => (
            <LineGraph
              key={index}
              variables={[variableName]}
              isPaused={isPaused}
              range={range}
              value={data}
              setData={setData}
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
