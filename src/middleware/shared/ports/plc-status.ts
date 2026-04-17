/**
 * PLC runtime status values
 * These represent the possible states of the OpenPLC Runtime
 */
export const PLC_VALID_STATUSES = ['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN'] as const

/**
 * Type representing valid PLC runtime status values
 */
export type PlcStatus = (typeof PLC_VALID_STATUSES)[number]

/**
 * Type guard to check if a string is a valid PLC status
 */
export function isValidPlcStatus(status: string): status is PlcStatus {
  return PLC_VALID_STATUSES.includes(status as PlcStatus)
}
