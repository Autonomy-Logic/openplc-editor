const padTo2Digits = (num: number) => num.toString().padStart(2, '0')
const padTo3Digits = (num: number) => num.toString().padStart(3, '0')

/**
 * Formats a timestamp for console and PLC logs display.
 * Returns format: YYYY-MM-DD HH:mm:ss.SSS or relative time
 *
 * @param timestamp - Date object or ISO string to format
 * @param relative - If true, returns relative time (e.g., "2m ago")
 * @returns Formatted timestamp string
 */
const formatTimestamp = (timestamp: Date | string, relative = false): string => {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp

  // Check if date is invalid
  if (isNaN(date.getTime())) {
    return 'Invalid Date'
  }

  // Return relative time if requested
  if (relative) {
    return formatRelativeTimestamp(date)
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

/**
 * Formats a timestamp as relative time (e.g., "2m ago", "just now")
 */
const formatRelativeTimestamp = (date: Date): string => {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 7) return `${diffDay}d ago`

  // For older logs, show the date
  const datePart = [date.getFullYear(), padTo2Digits(date.getMonth() + 1), padTo2Digits(date.getDate())].join('-')

  return datePart
}

export default formatTimestamp
