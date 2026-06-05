type TimestampFormat = 'full' | 'time' | 'none'

const padTo2Digits = (num: number) => num.toString().padStart(2, '0')

const formatTimestamp = (timestamp: Date | string, format: TimestampFormat = 'full'): string => {
  if (format === 'none') {
    return ''
  }

  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp

  if (isNaN(date.getTime())) {
    return 'Invalid Date'
  }

  const timePart = [
    padTo2Digits(date.getHours()),
    padTo2Digits(date.getMinutes()),
    padTo2Digits(date.getSeconds()),
  ].join(':')

  if (format === 'time') {
    return timePart
  }

  const datePart = [
    padTo2Digits(date.getDate()),
    padTo2Digits(date.getMonth() + 1),
    String(date.getFullYear()).slice(-2),
  ].join('-')

  return `${datePart} ${timePart}`
}

export default formatTimestamp
export type { TimestampFormat }
