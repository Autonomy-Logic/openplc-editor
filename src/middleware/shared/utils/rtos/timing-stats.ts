import type { RtosStats, RtosTaskStats, TimingStats } from '../../ports/types'

/**
 * A board's RTOS task statistics in the shape the scan-cycle table shows for a
 * runtime, so both render through the one component. Anything the board does
 * not report (the average cycle, the least latency) is null, which the table
 * shows as absent rather than as zero.
 */
export function rtosStatsToTimingStats(stats: RtosStats): TimingStats {
  return {
    tasks: stats.tasks.map((task) => {
      const ran = task.releases > 0
      const cycled = task.cycleMaxUs > 0
      return {
        name: task.name,
        scan_count: task.releases,
        scan_time_min: ran ? task.scanMinUs : null,
        scan_time_max: ran ? task.scanMaxUs : null,
        scan_time_avg: ran ? task.scanAvgUs : null,
        cycle_time_min: cycled ? task.cycleMinUs : null,
        cycle_time_max: cycled ? task.cycleMaxUs : null,
        cycle_time_avg: null,
        cycle_latency_min: null,
        cycle_latency_max: ran ? task.latencyMaxUs : null,
        cycle_latency_avg: ran ? task.latencyAvgUs : null,
        overruns: task.overruns,
      }
    }),
  }
}

/**
 * A task inside one scan for more than twice its period (and at least 20 ms):
 * stuck in a block, as the board itself judges a stalled task.
 */
export function isRtosTaskStuck(task: Pick<RtosTaskStats, 'busyUs' | 'periodUs'>): boolean {
  return task.busyUs > Math.max(2 * task.periodUs, 20000)
}

/**
 * The tasks the scan-cycle table leaves out, because they finished no scan in
 * the window, with what they are doing instead: stuck in one scan, or skipped
 * (released while still busy) without one completing.
 */
export function rtosTasksWithoutScans(stats: RtosStats): Array<{ name: string; stuckForUs?: number; skipped: number }> {
  return stats.tasks
    .filter((task) => task.releases === 0 && (task.overruns > 0 || isRtosTaskStuck(task)))
    .map((task) => ({
      name: task.name,
      ...(isRtosTaskStuck(task) ? { stuckForUs: task.busyUs } : {}),
      skipped: task.overruns,
    }))
}
