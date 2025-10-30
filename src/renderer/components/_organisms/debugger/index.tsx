import * as Select from '@radix-ui/react-select'
import { ArrowIcon, PauseIcon, PlayIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '../../_atoms'
import { LineChart } from '../../_molecules/charts/line-chart'

type DebuggerData = {
  graphList: string[]
}

type Point = { t: number; y: number }
type SeriesEntry = { points: Point[]; isBool: boolean; compositeKey: string }

const Debugger = ({ graphList }: DebuggerData) => {
  const [isPaused, setIsPaused] = useState(false)
  const [range, setRange] = useState(10)
  const [renderTrigger, setRenderTrigger] = useState(0)
  const historiesRef = useRef<Map<string, SeriesEntry>>(new Map())

  const {
    workspace: { debugVariableValues },
  } = useOpenPLCStore()

  useEffect(() => {
    const set = historiesRef.current
    for (const key of Array.from(set.keys())) {
      if (!graphList.includes(key)) set.delete(key)
    }
    for (const compositeKey of graphList) {
      if (!set.has(compositeKey)) {
        set.set(compositeKey, { points: [], isBool: false, compositeKey })
      }
    }
  }, [graphList])

  useEffect(() => {
    if (isPaused) return
    const now = Date.now()
    const set = historiesRef.current
    for (const [, entry] of set) {
      const raw = entry.compositeKey ? debugVariableValues.get(entry.compositeKey) : undefined
      if (raw === undefined) continue
      let y: number | null = null
      const rawStr = String(raw).toUpperCase()
      if (rawStr === 'TRUE') {
        y = 1
        entry.isBool = true
      } else if (rawStr === 'FALSE') {
        y = 0
        entry.isBool = true
      } else {
        const n = Number(raw)
        y = Number.isNaN(n) ? null : n
      }
      if (y !== null) {
        entry.points.push({ t: now, y })
        const cutoff = now - range * 1000
        const validStartIndex = entry.points.findIndex((p) => p.t >= cutoff)
        if (validStartIndex === -1) {
          entry.points.length = 0
        } else if (validStartIndex > 0) {
          entry.points.splice(0, validStartIndex)
        }
      }
    }
    setRenderTrigger((prev) => prev + 1)
  }, [debugVariableValues, isPaused, range])

  const renderSeries = useMemo(() => {
    const now = Date.now()
    const cutoff = now - range * 1000
    return graphList.map((compositeKey) => {
      const entry = historiesRef.current.get(compositeKey)
      const points = entry ? entry.points.filter((p) => p.t >= cutoff) : []
      return { name: compositeKey, points, isBool: entry?.isBool ?? false }
    })
  }, [graphList, range, renderTrigger])

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
                  {range >= 60 && (
                    <div className='flex gap-1'>
                      {range >= 60 ? Math.floor(range / 60) : ''} minute{range >= 120 ? 's' : ''}
                    </div>
                  )}
                  {range < 60 && (
                    <div className='flex gap-1'>
                      {range} second{range > 1 ? 's' : ''}
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
                  {[1, 10, 30, 60, 300, 600].map((value) => (
                    <Select.Item
                      key={value}
                      className='w-full cursor-pointer rounded-sm p-1 hover:bg-neutral-100 dark:hover:bg-neutral-850'
                      value={String(value)}
                    >
                      {value >= 60
                        ? `${Math.floor(value / 60)} minute${value >= 120 ? 's' : ''}`
                        : `${value} second${value > 1 ? 's' : ''}`}
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
          {renderSeries.map(({ name, points, isBool }) => (
            <LineChart key={name} data={points} isBool={isBool} />
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
