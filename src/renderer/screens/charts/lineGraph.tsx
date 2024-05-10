import { useEffect, useState } from 'react'
import Chart from 'react-apexcharts'

export default function LineGraph() {
  const [data, setData] = useState([false])

  const changeData = () => {
    setData([...data, !data[data.length - 1]])
  }

  useEffect(() => {
    const interval = setInterval(() => {
      changeData()
      console.log(data)
    }, 1000)

    return () => clearInterval(interval)
  }, [data])

  const mapDataToBinary = (data: boolean[]) => {
    return data.map((value) => (value ? 1 : 0))
  }

  const chartData = {
    series: [
      {
        data: mapDataToBinary(data),
      },
    ],
    options: {
      chart: {
        type: 'line',
        height: 350,
        animations: {
          enabled: true,
          easing: 'linear',
          dynamicAnimation: {
            speed: 1000,
          },
        },
      },
      zoom: {
        autoScaleYaxis: false,
      },
      dataLabels: {
        enabled: false,
      },
      stroke: {
        curve: 'stepline',
      },
      title: {
        text: 'Stepline Chart',
        align: 'left',
      },

      yaxis: {
        max: 1,
        min: 0,

        floating: false,
      },
      markers: {
        size: 0,
      },
    },
  }

  return (
    <Chart
      className='  !overflow-auto !stroke-red-500'
      options={chartData.options}
      series={chartData.series}
      height='300px'
      type='line'
    />
  )
}
