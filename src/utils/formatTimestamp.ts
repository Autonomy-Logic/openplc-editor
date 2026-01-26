const padTo2Digits = (num: number) => num.toString().padStart(2, '0')
const padTo3Digits = (num: number) => num.toString().padStart(3, '0')

/**
 * Formats a timestamp for console and PLC logs display.
 * Returns format: YYYY-MM-DD HH:mm:ss.SSS
 *
 * @param timestamp - Date object or ISO string to format
 * @returns Formatted timestamp string
 */
const formatTimestamp = (timestamp: Date | string): string => {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp

  // Check if date is invalid
  if (isNaN(date.getTime())) {
    return 'Invalid Date'
  }

  const datePart = [date.getFullYear(), padTo2Digits(date.getMonth() + 1), padTo2Digits(date.getDate())].join('-')

  const timePart = [
    padTo2Digits(date.getHours()),
    padTo2Digits(date.getMinutes()),
    padTo2Digits(date.getSeconds()),
  ].join(':')

  const milliseconds = padTo3Digits(date.getMilliseconds())

  return `${datePart} ${timePart}.${milliseconds}`
}

export default formatTimestamp
