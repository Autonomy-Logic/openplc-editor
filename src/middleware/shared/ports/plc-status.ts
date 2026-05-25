/**
 * PLC runtime status values
 * These represent the possible states of the OpenPLC Runtime.
 *
 * TRANSITIONING is reported by the runtime while a STOP/START worker
 * is in flight — plc_state has flipped (so the running task threads
 * can exit their `while (plc_get_state() == RUNNING)` loops) but the
 * actual load/unload work is still happening on the transition
 * worker thread, and the runtime can't yet accept another command.
 * UI should show a "stopping…" / "starting…" indicator and
 * automation flows should keep polling until they see a settled
 * state.
 */
export const PLC_VALID_STATUSES = ['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'TRANSITIONING', 'UNKNOWN'] as const

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
