import { parseDurationLiteral } from '../../../../frontend/utils/iec-duration'
import type { RtosIntervalProblem } from './types'

export interface RtosTaskLike {
  name: string
  triggering?: string
  interval: string
}

/**
 * Tasks whose interval RTOS mode cannot release on time.
 *
 * The tasks are released on the RTOS tick, so a period must be a whole, non-zero
 * number of ticks; `T#1.5ms` on a 1 ms tick would really run every 1 ms or 2 ms,
 * and the build refuses it instead of shipping a different period than the one
 * written. Interrupt (IEC SINGLE) tasks are not periodic and are skipped: the
 * firmware runs them on the default 20 ms cycle.
 */
export function findIntervalsOffTick(tasks: readonly RtosTaskLike[], tickNs: number): RtosIntervalProblem[] {
  const tick = BigInt(tickNs)
  const problems: RtosIntervalProblem[] = []

  for (const task of tasks) {
    if (task.triggering === 'Interrupt') continue

    let ns: bigint
    try {
      ns = parseDurationLiteral(task.interval)
    } catch (error) {
      problems.push({
        task: task.name,
        interval: task.interval,
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    if (ns <= 0n) {
      problems.push({ task: task.name, interval: task.interval, reason: 'a cyclic task needs a period above zero' })
    } else if (ns % tick !== 0n) {
      problems.push({
        task: task.name,
        interval: task.interval,
        reason: `the period must be a whole number of ${formatTick(tickNs)} ticks`,
      })
    }
  }

  return problems
}

function formatTick(tickNs: number): string {
  if (tickNs % 1_000_000 === 0) return `${tickNs / 1_000_000} ms`
  if (tickNs % 1_000 === 0) return `${tickNs / 1_000} µs`
  return `${tickNs} ns`
}
