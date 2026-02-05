import { useOpenPLCStore } from '@root/renderer/store'
import { useCallback, useMemo } from 'react'
import Chart from 'react-apexcharts'

type Point = { t: number; y: number }

type ChartProps = {
  data: Point[]
  isBool: boolean
  range: number
}

const LineChart = ({ data, isBool, range }: ChartProps) => {
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

  const seriesData = useMemo(() => {
    const currentTime = Date.now()
    return data.map((p) => ({
      x: (p.t - currentTime) / 1000,
      y: isBool ? (p.y ? 1 : 0) : p.y,
    }))
  }, [data, isBool])

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

  const chartOptions = useMemo(
    () => ({
      chart: {
        id: 'realtime',
        type: 'line' as const,
        toolbar: {
          show: false,
        },
        animations: {
          enabled: false,
        },
      },
      tooltip: {
        enabled: true,
        followCursor: false,
        intersect: false,
        fixed: {
          enabled: true,
          position: 'topRight' as const,
          offsetX: 0,
          offsetY: 0,
        },
        marker: {
          show: false,
        },
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
        min: -range,
        max: 0,
        labels: {
          show: false,
        },
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
    [yMinMax.min, yMinMax.max, isBool, yAxisFormatter, graphColors.stroke, graphColors.row, graphColors.border, range],
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
    <div className='w-full'>
      <Chart width={'100%'} options={chartOptions} series={chartSeries} height={115} type='line' />
    </div>
  )
}

export { LineChart }
