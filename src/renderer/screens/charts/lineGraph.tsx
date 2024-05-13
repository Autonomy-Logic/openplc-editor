import { useEffect, useState } from 'react'
import Chart from 'react-apexcharts'

type ChartData = {
  range: number
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
  const mapDataToBinary = (data: boolean[]) => {
    return data.map((value) => (value ? 1 : 0))
  }

  console.log(latestData)
  const chartData = {
    series: [
      {
        data: mapDataToBinary(data),
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
        type: 'numeric',
        range: range,
      },
      yaxis: {
        tickAmount: 2,
        
      },
      stroke: {
        curve: 'stepline',
      },
    },
  }
  return (
    <div>
      <Chart options={chartData.options} series={chartData.series} height='120px' type='line' />
      <p className='pl-[90%] text-white'>{latestData ? 'false' : 'true'}</p>
    </div>
  )
}
