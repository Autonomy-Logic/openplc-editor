import type { PlcStatus } from '@root/types/plc-status'
import { isValidPlcStatus } from '@root/types/plc-status'

/**
 * Parses raw PLC status string from the runtime API
 * Removes the 'STATUS:' prefix, newlines, and trims whitespace
 *
 * @param rawStatus - Raw status string from the runtime (e.g., "STATUS:RUNNING\n")
 * @returns Cleaned status string or null if invalid
 *
 * @example
 * parsePlcStatus("STATUS:RUNNING\n") // returns "RUNNING"
 * parsePlcStatus("STOPPED") // returns "STOPPED"
 * parsePlcStatus("INVALID") // returns null
 */
export function parsePlcStatus(rawStatus: string): PlcStatus | null {
  const cleaned = rawStatus
    .replace(/^STATUS:\s*/, '')
    .replace(/[\r\n]+/g, '')
    .trim()
  return isValidPlcStatus(cleaned) ? cleaned : null
}
