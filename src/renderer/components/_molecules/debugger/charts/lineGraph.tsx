import { useEffect, useState } from 'react'
import Chart from 'react-apexcharts'

type ChartData = {
  range?: number
  data: boolean[]
  setData: React.Dispatch<React.SetStateAction<boolean[]>>
}

export default function LineGraph({ range, data, setData }: ChartData) {
  const [latestData, setLatestData] = useState<boolean | undefined>(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setData((prevData) => [...prevData, !prevData[prevData.length - 1] || prevData.length === 0])
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setLatestData(data[data.length - 1])
  }, [data])

  const mapDataToYAxis = (data: boolean[]) => {
    return data.map((value) => (value ? 1 : 0))
  }

  const mapDataToXAxis = (data: boolean[]) => {
    return Array.from({ length: data.length }, (_, i) => i)
  }

  const chartData = {
    series: [
      {
        data: mapDataToYAxis(data),
      },
    ],
    options: {
      chart: {
        type: 'line',
        animations: {
          enabled: true,
          easing: 'linear',
          dynamicAnimation: {
            enabled: true,
            speed: 1000,
            animateGradually: {
              enabled: true,
              delay: 150,
            },
          },
        },
        toolbar: {
          show: false,
          autoSelected: 'pan',
        },
        dataLabels: {
          enabled: true,
        },
        title: {
          text: 'Stepline Chart',
          align: 'left',
        },
        markers: {
          size: 0,
        },
      },
      xaxis: {
        categories: mapDataToXAxis(data),
        range: range,
        tickAmount: 5,
      },
      yaxis: {
        min: 0,
        max: 1,
        tickAmount: 4,
        
      },
      stroke: {
        curve: 'stepline',
        width: 2,
        colors: ['#0464FB'],
      },
      grid: {
        row: {
          colors: ['#F5F7F8'],
        },
        borderColor: '#b1b9c8',
        xaxis: {
          lines: {
            show: true,
            offsetY: 5,
          },
        },
        yaxis: {
          lines: {
            show: true,
            offsetY: 5,
          },
        },
      },
    },
  }

  return (
    <div className='w-full '>
      <Chart width={'100%'} options={chartData.options} series={chartData.series} height='120px' type='line' />
      <p className='pl-[90%] text-black dark:text-white'>{latestData ? 'true' : 'false'}</p>
    </div>
  )
}
