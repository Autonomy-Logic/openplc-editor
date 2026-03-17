import { useId, useMemo } from 'react'
import Chart from 'react-apexcharts'

type LineChartProps = {
  data: { x: number; y: number }[]
  isBool?: boolean
  range: number
  now: number
  startTime: number
  label?: string
}

const graphColors = ['#E5B300', '#3FB950', '#2F81F7', '#DB6D28', '#A371F7', '#DA3633']

const getNiceTickInterval = (rangeSeconds: number): number => {
  const candidate = rangeSeconds / 5
  const niceValues = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
  for (const nice of niceValues) {
    if (nice >= candidate) return nice
  }
  return niceValues[niceValues.length - 1]
}

const formatElapsedLabel = (elapsedSeconds: number): string => {
  if (elapsedSeconds < 60) return `${Math.round(elapsedSeconds)}s`
  if (elapsedSeconds < 3600) {
    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = Math.round(elapsedSeconds % 60)
    return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`
  }
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.round((elapsedSeconds % 3600) / 60)
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
}

const LineChart = ({ data, isBool = false, range, now, startTime, label }: LineChartProps) => {
  const chartId = useId()

  const elapsedSeconds = useMemo(() => (now - startTime) / 1000, [now, startTime])

  const chartOptions = useMemo(() => {
    const tickInterval = getNiceTickInterval(range)
    const xMin = elapsedSeconds - range
    const xMax = elapsedSeconds

    return {
      chart: {
        id: chartId,
        animations: { enabled: true, easing: 'linear' as const, dynamicAnimation: { speed: 500 } },
        toolbar: { show: false },
        zoom: { enabled: false },
        background: 'transparent',
      },
      colors: graphColors,
      xaxis: {
        type: 'numeric' as const,
        min: xMin,
        max: xMax,
        tickAmount: Math.max(2, Math.ceil(range / tickInterval)),
        labels: {
          show: true,
          formatter: (val: string) => formatElapsedLabel(Number(val)),
          style: { colors: '#9ca3af', fontSize: '10px' },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        min: isBool ? -0.2 : undefined,
        max: isBool ? 1.2 : undefined,
        tickAmount: isBool ? 2 : undefined,
        labels: {
          show: true,
          style: { colors: '#9ca3af', fontSize: '10px' },
          formatter: isBool ? (val: number) => (val === 0 ? 'FALSE' : val === 1 ? 'TRUE' : '') : undefined,
        },
      },
      grid: {
        borderColor: '#374151',
        strokeDashArray: 3,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } },
      },
      stroke: { curve: isBool ? ('stepline' as const) : ('smooth' as const), width: 2 },
      tooltip: { enabled: false },
      states: {
        hover: { filter: { type: 'none' } },
        active: { filter: { type: 'none' } },
      },
      markers: { size: 0 },
      theme: { mode: 'dark' as const },
    }
  }, [chartId, isBool, range, elapsedSeconds])

  const chartSeries = useMemo(
    () => [
      {
        name: 'value',
        data: data.map((point) => ({
          x: (point.x - startTime) / 1000,
          y: point.y,
        })),
      },
    ],
    [data, startTime],
  )

  return (
    <div className='relative w-full'>
      {label && <div className='absolute left-12 top-1 z-10 text-xs font-medium text-neutral-400'>{label}</div>}
      <Chart options={chartOptions} series={chartSeries} type='line' height={150} />
    </div>
  )
}

export { LineChart }
