/**
 * The rule a polling file watcher applies to tell a change made outside the app from one the app
 * made itself. Pure, so the desktop watcher holds no decision of its own.
 */

/** Whether a poll saw a change the app did not make. */
export function shouldReportExternalChange(mtimes: {
  prevMtimeMs: number
  currMtimeMs: number
  recordedMtimeMs: number
}): boolean {
  return mtimes.currMtimeMs > mtimes.prevMtimeMs && mtimes.currMtimeMs > mtimes.recordedMtimeMs
}

/** The recorded time after the app wrote the file: raise only, never lower. */
export function raiseRecordedMtime(recordedMtimeMs: number, observedMtimeMs: number): number {
  return Math.max(recordedMtimeMs, observedMtimeMs)
}
