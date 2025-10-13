import { useOpenPLCStore } from '@root/renderer/store'
import { useMemo } from 'react'
import type { Props as ChartOptions } from 'react-apexcharts'
import Chart from 'react-apexcharts'

type Point = { t: number; y: number }

type ChartProps = {
  data: Point[]
  isBool: boolean
}

const LineChart = ({ data, isBool }: ChartProps) => {
  const {
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
  } = useOpenPLCStore()

  const graphColors = shouldUseDarkMode
    ? {
        stroke: '#B4D0FE',
        row: '#2E3038',
        border: '#3A3F4A',
      }
    : {
        stroke: '#0464FB',
        row: '#F5F7F8',
        border: '#DDE2E8',
      }

  const oldestTime = data.length > 0 ? data[0].t : Date.now()

  const seriesData = useMemo(
    () =>
      data.map((p) => ({
        x: (p.t - oldestTime) / 1000,
        y: isBool ? (p.y ? 1 : 0) : p.y,
      })),
    [data, oldestTime, isBool],
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

  const chartData: ChartOptions = {
    series: [
      {
        data: seriesData,
      },
    ],
    options: {
      chart: {
        id: 'realtime',
        type: 'line',
        toolbar: {
          show: false,
        },
        animations: {
          enabled: false,
        },
      },
      xaxis: {
        type: 'numeric',
        labels: {
          show: false,
        },
      },
      yaxis: {
        min: yMinMax.min,
        max: yMinMax.max,
        tickAmount: isBool ? 1 : 4,
        labels: {
          formatter: (value: number) => {
            return value.toFixed(0)
          },
          style: {
            cssClass: 'apexcharts-yaxis-label',
          },
        },
      },
      stroke: {
        curve: isBool ? 'stepline' : 'straight',
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

  return (
    <div className='w-full'>
      <Chart width={'100%'} options={chartData.options} series={chartData.series} height={115} type='line' />
    </div>
  )
}

export { LineChart }
