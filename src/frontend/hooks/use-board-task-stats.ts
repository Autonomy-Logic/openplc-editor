/**
 * Polls a connected board's RTOS task statistics (FC 0x4e) while `active`, for
 * the Runtime Status screen. The first successful read only starts a new window,
 * so the figures shown cover the time since the screen opened; the services'
 * busy counts, which the board keeps since boot, are shown relative to that read.
 *
 * It stops only when the board answers that it does not know the code (it runs
 * the single loop). Failing reads slow the polling down until one succeeds, and
 * a read starts no sooner than four read times after the last, so the statistics
 * take at most a quarter of a slow link. A disconnect unmounts the screen.
 */

import type { RtosStats } from '@root/middleware/shared/ports/types'
import { useDevice } from '@root/middleware/shared/providers/platform-context'
import { useEffect, useState } from 'react'

export const BOARD_TASK_STATS_POLL_MS = 1000
/** Failed reads in a row after which the board is shown as not answering. */
export const BOARD_TASK_STATS_MAX_FAILURES = 3
/** How often a board that is not answering is asked again. */
export const BOARD_TASK_STATS_RETRY_MS = 5000
/** Reads take at most this share of the time: the next waits this many read times. */
const LINK_SHARE_DIVISOR = 4

/** Whether this platform can read a board's task statistics at all. */
export function useCanReadBoardTaskStats(): boolean {
  return useDevice().readTaskStats !== undefined
}

export interface BoardTaskStats {
  /** The latest reading since the screen opened; null until the second reply. */
  stats: RtosStats | null
  /** Per service, the requests it answered "busy" since the screen opened. */
  busySinceOpen: number[] | null
  /** The board has answered: it runs in RTOS mode. */
  answered: boolean
  /** The board answered that it does not know the code: it runs the single loop. */
  unsupported: boolean
  /** Reads keep failing; still asked, less often. `error` says why. */
  stalled: boolean
  error: string | null
}

const INITIAL: BoardTaskStats = {
  stats: null,
  busySinceOpen: null,
  answered: false,
  unsupported: false,
  stalled: false,
  error: null,
}

/** A counter's growth since `base`, across its wrap at 2^32. */
const since = (now: number, base: number): number => (now - base) >>> 0

export function useBoardTaskStats(active: boolean): BoardTaskStats {
  const device = useDevice()
  const [state, setState] = useState<BoardTaskStats>(INITIAL)

  useEffect(() => {
    const read = device.readTaskStats?.bind(device)
    if (!active || !read) return
    let cancelled = false
    let inFlight = false
    let resetPending = true
    let failures = 0
    let nextAt = 0
    let busyBase: number[] = []

    const stop = (): void => {
      cancelled = true
      clearInterval(timer)
    }
    const fail = (message: string): void => {
      failures += 1
      const stalled = failures >= BOARD_TASK_STATS_MAX_FAILURES
      if (stalled) nextAt = Date.now() + BOARD_TASK_STATS_RETRY_MS
      setState((previous) => ({ ...previous, stalled, error: message }))
    }

    const tick = async (): Promise<void> => {
      if (inFlight || cancelled || Date.now() < nextAt) return
      inFlight = true
      const startedAt = Date.now()
      try {
        const result = await read(resetPending)
        if (cancelled) return
        const took = Date.now() - startedAt
        nextAt = startedAt + Math.max(BOARD_TASK_STATS_POLL_MS, took * LINK_SHARE_DIVISOR)
        if (result.success && result.stats) {
          failures = 0
          const busy = result.stats.services.map((service) => service.busyReplies)
          if (resetPending) {
            // The window before this screen opened: the baseline, not shown.
            resetPending = false
            busyBase = busy
            setState((previous) => ({ ...previous, answered: true, stalled: false, error: null }))
          } else {
            setState({
              stats: result.stats,
              busySinceOpen: busy.map((count, i) => since(count, busyBase[i] ?? 0)),
              answered: true,
              unsupported: false,
              stalled: false,
              error: null,
            })
          }
        } else if (result.unsupported) {
          stop()
          setState({ ...INITIAL, unsupported: true })
        } else {
          fail(result.error ?? 'No task statistics')
        }
      } catch (error) {
        if (cancelled) return
        nextAt = startedAt + BOARD_TASK_STATS_POLL_MS
        fail(error instanceof Error ? error.message : String(error))
      } finally {
        inFlight = false
      }
    }

    const timer = setInterval(() => void tick(), BOARD_TASK_STATS_POLL_MS / 4)
    void tick()
    return stop
  }, [active, device])

  return state
}
