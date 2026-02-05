import { useOpenPLCStore } from '@root/renderer/store'
import { useCallback, useId, useMemo } from 'react'
import Chart from 'react-apexcharts'

type Point = { t: number; y: number }

type ChartProps = {
  data: Point[]
  isBool: boolean
  range: number
  now: number
  startTime: number
  label?: string
}

/**
 * Calculate a "nice" tick interval for the x-axis based on the range.
 * Returns an interval that produces approximately 5-6 evenly spaced ticks
 * with round numbers (e.g., every 2s, 5s, 10s, 30s, 1min, 2min).
 */
const getNiceTickInterval = (range: number): number => {
  const rawInterval = range / 5

  // Nice intervals for time (in seconds)
  const niceIntervals = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600]

  // Find the smallest nice interval that's >= raw interval
  for (const interval of niceIntervals) {
    if (interval >= rawInterval) {
      return interval
    }
  }
  return niceIntervals[niceIntervals.length - 1]
}

const LineChart = ({ data, isBool, range, now, startTime, label }: ChartProps) => {
  const chartId = useId()
  const {
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
  } = useOpenPLCStore()

  const graphColors = useMemo(
    () =>
      shouldUseDarkMode
        ? { stroke: '#B4D0FE', row: '#2E3038', border: '#3A3F4A' }
        : { stroke: '#0464FB', row: '#F5F7F8', border: '#DDE2E8' },
    [shouldUseDarkMode],
  )

  // Calculate elapsed time from debugger start
  const elapsedSeconds = (now - startTime) / 1000

  const seriesData = useMemo(
    () =>
      data.map((p) => ({
        x: (p.t - startTime) / 1000, // X is elapsed seconds since start
        y: isBool ? (p.y ? 1 : 0) : p.y,
      })),
    [data, isBool, startTime],
  )

  const yMinMax = useMemo(() => {
    if (isBool) return { min: 0, max: 1 }
    if (seriesData.length === 0) return { min: 0, max: 1 }
    const yValues = seriesData.map((p) => p.y)
    let min = Math.min(...yValues)
    let max = Math.max(...yValues)
    if (min === max) {
      min = min - 1
      max = max + 1
    } else {
      min = Math.floor(min) - 1
      max = Math.ceil(max) + 1
    }
    return { min, max }
  }, [seriesData, isBool])

  const yAxisFormatter = useCallback((value: number) => {
    return value.toFixed(0)
  }, [])

  // Calculate nice tick interval and amount based on range
  const tickInterval = useMemo(() => getNiceTickInterval(range), [range])
  const tickAmount = useMemo(() => Math.ceil(range / tickInterval), [range, tickInterval])

  const chartOptions = useMemo(
    () => ({
      chart: {
        id: chartId,
        type: 'line' as const,
        toolbar: {
          show: false,
        },
        animations: {
          enabled: false,
        },
      },
      tooltip: {
        enabled: false,
      },
      states: {
        hover: {
          filter: {
            type: 'none' as const,
          },
        },
        active: {
          filter: {
            type: 'none' as const,
          },
        },
      },
      markers: {
        size: 0,
        hover: {
          sizeOffset: 0,
        },
      },
      xaxis: {
        type: 'numeric' as const,
        min: Math.max(0, elapsedSeconds - range),
        max: elapsedSeconds,
        labels: {
          show: true,
          formatter: (value: string) => {
            const secs = Number(value)
            // For sub-second intervals, show decimal
            if (tickInterval < 1) {
              if (secs < 60) return `${secs.toFixed(1)}s`
              const mins = Math.floor(secs / 60)
              const remainingSecs = secs % 60
              return remainingSecs > 0 ? `${mins}m${remainingSecs.toFixed(1)}s` : `${mins}m`
            }
            // For whole second intervals
            const roundedSecs = Math.round(secs)
            if (roundedSecs < 60) return `${roundedSecs}s`
            const mins = Math.floor(roundedSecs / 60)
            const remainingSecs = roundedSecs % 60
            return remainingSecs > 0 ? `${mins}m${remainingSecs}s` : `${mins}m`
          },
        },
        tickAmount: tickAmount,
      },
      yaxis: {
        min: yMinMax.min,
        max: yMinMax.max,
        tickAmount: isBool ? 1 : 4,
        labels: {
          formatter: yAxisFormatter,
          style: {
            cssClass: 'apexcharts-yaxis-label',
          },
        },
      },
      stroke: {
        curve: isBool ? ('stepline' as const) : ('straight' as const),
        width: 2,
        colors: [graphColors.stroke],
      },
      grid: {
        row: {
          colors: [graphColors.row],
        },
        borderColor: graphColors.border,
        xaxis: {
          lines: {
            show: true,
            offsetY: 5,
          },
        },
        yaxis: {
          lines: {
            show: true,
            offsetY: 3,
          },
        },
      },
    }),
    [
      chartId,
      yMinMax.min,
      yMinMax.max,
      isBool,
      yAxisFormatter,
      graphColors.stroke,
      graphColors.row,
      graphColors.border,
      range,
      elapsedSeconds,
      tickInterval,
      tickAmount,
    ],
  )

  const chartSeries = useMemo(
    () => [
      {
        data: seriesData,
      },
    ],
    [seriesData],
  )

  return (
    <div className='relative w-full'>
      {label && (
        <div className='absolute left-10 top-1 z-10 rounded bg-neutral-100/80 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-400'>
          {label}
        </div>
      )}
      <Chart width={'100%'} options={chartOptions} series={chartSeries} height={115} type='line' />
    </div>
  )
}

export { LineChart }
