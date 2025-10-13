import { useOpenPLCStore } from '@root/renderer/store'
import type { DebugVariableHistoryMap } from '@root/renderer/store/slices/workspace/types'
import { useEffect, useMemo, useState } from 'react'
import type { Props as ChartOptions } from 'react-apexcharts'
import Chart from 'react-apexcharts'

const DEBUGGER_POLL_INTERVAL_MS = 200

type HistoryDataPoint = {
  tick: number
  value: string
}

type ChartProps = {
  variableName: string
  range: number
  isPaused: boolean
  commonTickTime: number
}

const LineChart = ({ variableName, range, isPaused, commonTickTime }: ChartProps) => {
  const [graphColors, setGraphColors] = useState<{ stroke: string; row: string; border: string }>({
    stroke: '',
    row: '',
    border: '',
  })

  const {
    workspace: {
      systemConfigs: { shouldUseDarkMode },
      debugVariableHistory,
    },
  } = useOpenPLCStore()

  useEffect(() => {
    if (shouldUseDarkMode) {
      setGraphColors({
        stroke: '#B4D0FE',
        row: '#2E3038',
        border: '#b1b9c8',
      })
    } else {
      setGraphColors({
        stroke: '#0464FB',
        row: '#F5F7F8',
        border: '#DDE2E8',
      })
    }
  }, [shouldUseDarkMode])

  const { filteredData, currentValue } = useMemo(() => {
    const historyMap = debugVariableHistory as DebugVariableHistoryMap
    const history = historyMap.get(variableName) || []

    if (history.length === 0) {
      return { filteredData: [] as HistoryDataPoint[], currentValue: null as string | null }
    }

    const latestTick = history[history.length - 1].tick

    const rangeMs = range * 1000
    const ticksToShow = Math.ceil(rangeMs / commonTickTime)

    const minTickToShow = Math.max(0, latestTick - ticksToShow)
    const filtered = history.filter((point) => point.tick >= minTickToShow)

    const currentValue = history[history.length - 1].value

    return {
      filteredData: filtered,
      currentValue,
    }
  }, [debugVariableHistory, variableName, range, commonTickTime])

  const chartData: ChartOptions = useMemo(() => {
    const seriesData = filteredData.map((point: HistoryDataPoint) => {
      const value = point.value.toUpperCase()

      if (value === 'TRUE' || value === '1') return 1
      if (value === 'FALSE' || value === '0') return 0

      const numValue = parseFloat(point.value)
      if (!isNaN(numValue)) return numValue

      return 0
    })

    const tickValues = filteredData.map((point: HistoryDataPoint) => point.tick)

    let yMin: number | undefined
    let yMax: number | undefined

    if (seriesData.every((v) => v === 0 || v === 1)) {
      yMin = 0
      yMax = 1
    } else {
      yMin = undefined
      yMax = undefined
    }

    return {
      series: [
        {
          data: seriesData,
        },
      ],
      options: {
        chart: {
          type: 'line',
          offsetX: 0,
          toolbar: {
            show: false,
          },
          animations: {
            enabled: !isPaused,
            dynamicAnimation: {
              enabled: true,
              speed: DEBUGGER_POLL_INTERVAL_MS,
            },
          },
        },
        xaxis: {
          categories: tickValues.map((tick: number) => tick.toString()),
          labels: {
            style: {
              cssClass: 'apexcharts-xaxis-label',
            },
          },
          title: {
            text: 'Tick',
          },
        },
        yaxis: {
          min: yMin,
          max: yMax,
          labels: {
            style: {
              cssClass: 'apexcharts-yaxis-label',
            },
          },
        },
        stroke: {
          curve: 'stepline',
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
      },
    }
  }, [filteredData, graphColors, isPaused])

  return (
    <div className='w-full'>
      <Chart width={'100%'} options={chartData.options} series={chartData.series} height={115} type='line' />
      <div className='text-cp-base font-semibold text-black dark:text-neutral-50'>
        {currentValue !== null && (
          <div className='flex items-center justify-end gap-1'>
            <p
              className={`h-1 w-1 rounded-full ${currentValue === '1' || currentValue.toUpperCase() === 'TRUE' ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {currentValue}
          </div>
        )}
      </div>
    </div>
  )
}

export { LineChart }
