type TimestampFormat = 'full' | 'time' | 'none'

const padTo2Digits = (num: number) => num.toString().padStart(2, '0')

/**
 * Formats a timestamp for console and PLC logs display.
 *
 * @param timestamp - Date object or ISO string to format
 * @param format - Format option: 'full' (DD-MM-YY HH:MM:SS), 'time' (HH:MM:SS), or 'none'
 * @returns Formatted timestamp string
 */
const formatTimestamp = (timestamp: Date | string, format: TimestampFormat = 'full'): string => {
  if (format === 'none') {
    return ''
  }

  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp

  // Check if date is invalid
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

  // format === 'full': DD-MM-YY HH:MM:SS
  const datePart = [
    padTo2Digits(date.getDate()),
    padTo2Digits(date.getMonth() + 1),
    String(date.getFullYear()).slice(-2),
  ].join('-')

  return `${datePart} ${timePart}`
}

export default formatTimestamp
