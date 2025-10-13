import { PLCTask } from '@root/types/PLC/open-plc'

/**
 * Parses a task interval string (e.g., "T#20ms", "T#1h2min3s") to milliseconds
 * @param interval - The interval string in IEC 61131-3 format
 * @returns The interval in milliseconds, or null if parsing fails
 */
export function parseTaskInterval(interval: string): number | null {
  const regex = /T#(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)min)?(?:(\d+)s)?(?:(\d+)ms)?(?:(\d+)us)?/i
  const match = interval.match(regex)

  if (!match) return null

  const [, day = 0, hour = 0, min = 0, sec = 0, ms = 0, us = 0] = match.map((v) => (v ? Number(v) : 0))

  return day * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000 + min * 60 * 1000 + sec * 1000 + ms + us / 1000
}

/**
 * Calculates the greatest common divisor of two numbers
 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * Calculates the common tick time (GCD of all task intervals) for a project
 * This represents the minimum time unit that divides all task periods
 * @param tasks - Array of project tasks
 * @returns The common tick time in milliseconds, or 20 if no valid tasks
 */
export function calculateCommonTickTime(tasks: PLCTask[]): number {
  const DEFAULT_TICK_TIME = 20

  if (!tasks || tasks.length === 0) return DEFAULT_TICK_TIME

  const intervals: number[] = []
  for (const task of tasks) {
    const intervalMs = parseTaskInterval(task.interval)
    if (intervalMs !== null && intervalMs > 0) {
      intervals.push(intervalMs)
    }
  }

  if (intervals.length === 0) return DEFAULT_TICK_TIME

  return intervals.reduce((acc, interval) => gcd(acc, interval))
}
