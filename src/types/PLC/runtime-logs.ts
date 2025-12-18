/**
 * Maximum number of log entries to keep in the client-side buffer.
 * This prevents unbounded memory growth when polling logs continuously.
 */
export const LOG_BUFFER_CAP = 1000

/**
 * Log levels supported by OpenPLC Runtime v4.
 * These map to the LogComponent's level prop for styling.
 */
export type RuntimeLogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

/**
 * A single log entry from OpenPLC Runtime v4.
 * V4 returns structured log objects with metadata.
 */
export type RuntimeLogEntry = {
  id: number | null
  timestamp: string
  level: RuntimeLogLevel
  message: string
}

/**
 * Union type representing logs from either v3 (string) or v4 (array) runtime.
 * Used for backward compatibility.
 */
export type PlcLogs = string | RuntimeLogEntry[]

/**
 * Type guard to check if logs are in v4 format (array of objects).
 */
export function isV4Logs(logs: PlcLogs): logs is RuntimeLogEntry[] {
  return Array.isArray(logs)
}

/**
 * Type guard to check if logs are in v3 format (plain string).
 */
export function isV3Logs(logs: PlcLogs): logs is string {
  return typeof logs === 'string'
}
