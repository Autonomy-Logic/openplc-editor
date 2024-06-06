import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'
import { Props } from 'react-apexcharts'
import Chart from 'react-apexcharts'
type ChartData = {
  range?: number
  value: boolean
  setData: React.Dispatch<React.SetStateAction<boolean>>
  isPaused: boolean
  variables: string[]
}

export default function LineGraph({ range, value, setData, isPaused }: ChartData) {
  const [history, setHistory] = useState<boolean[]>([value])
  const [chartInterval, setChartInterval] = useState<number[]>([0])
  const [graphColors, setGraphColors] = useState({
    stroke: '',
    row: '',
    border: '',
  })
  const {
    systemConfigs: { shouldUseDarkMode },
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
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) {
        setChartInterval((prevData) => [...prevData, prevData.length])
        setData((prevData) => !prevData)
        setHistory((prevHistory) => [...prevHistory, !prevHistory[prevHistory.length - 1]])
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [isPaused, setData])

  const chartData: Props = {
    series: [
      {
        data: history.map((val) => (val ? 1 : 0)),
      },
    ],
    options: {
      chart: {
        type: 'line',
        offsetX: 0,
        toolbar: {
          show: false,
        },
      },
      xaxis: {
        range: range,
        categories: chartInterval.map((i) => i.toString()),
        labels: {
          style: {
            cssClass: 'apexcharts-xaxis-label',
          },
        },
      },
      yaxis: {
        min: 0,
        max: 1,
        tickAmount: 3,
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

  return (
    <div className='w-full'>
      <Chart width={'100%'} options={chartData.options} series={chartData.series} height={115} type='line' />
      <div className='text-cp-base font-semibold text-black dark:text-neutral-50'>
        {value ? (
          <div className='flex items-center justify-end gap-1'>
            <p className='h-1 w-1 rounded-full bg-red-500' />
            False
          </div>
        ) : (
          <div className='flex items-center justify-end gap-1'>
            <p className='h-1 w-1 rounded-full bg-green-500' />
            True
          </div>
        )}
      </div>
    </div>
  )
}
