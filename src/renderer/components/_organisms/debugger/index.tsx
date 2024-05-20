import { DebuggerIcon } from '@root/renderer/assets'
import { useState } from 'react'

import LineGraph from '../../_molecules/charts/lineGraph'
import Header from '../../_molecules/header'

export default function Debugger() {
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
    <div className='w-full '>
      <div className='flex h-full w-full flex-col gap-2  rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-900'>
        <div className='header flex justify-between '>
          <div className='flex gap-4'>
            <button className='flex h-7 w-[133px] items-center justify-center gap-2 rounded-md bg-neutral-100 text-cp-sm font-medium text-neutral-1000 outline-none dark:bg-brand-dark dark:text-white'>
              <DebuggerIcon fill='#0464fb' className='h-3 w-3 stroke-brand' /> debugger terminal
            </button>
            <div className='flex gap-2'>
              <input
                type='text'
                onChange={(e) => updateRange(Number(e.target.value))}
                className='h-7 w-9 items-center rounded-md border border-neutral-200 bg-white p-2 text-center text-cp-sm font-medium text-neutral-1000 outline-none dark:bg-neutral-900'
              />
              <select className='h-7 w-[88px] rounded-md border border-neutral-200 bg-white outline-none dark:bg-neutral-900'>
                <option value='seconds'>seconds</option>
              </select>
            </div>
          </div>

          <div className='flex gap-2'>
            <Header isPaused={isPaused} setIsPaused={setIsPaused} />
          </div>
        </div>
        <div className='chart-content  h-full w-full  gap-2 overflow-hidden'>
          <div className='flex w-full justify-between p-2 text-cp-base font-semibold text-neutral-1000'>
            <div>
              <span>time</span>
              <p className='font-normal'>0m 0s 0ms</p>
            </div>
            <div>
              <span>ticks</span>
              <p className='font-normal'>0</p>
            </div>
          </div>
          <LineGraph isPaused={isPaused} range={range} value={data} setData={setData} />
        </div>
      </div>
    </div>
  )
}
