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
      xaxis: {
        type: 'numeric',
        labels: {
          formatter: function (value: number) {
            return value.toFixed(0)
          },
        },
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
      className=' overflow-auto !stroke-red-500'
      options={chartData.options}
      series={chartData.series}
      width='80%'
      height='300px'
      type='line'
    />
  )
}
