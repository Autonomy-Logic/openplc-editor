import type { RtosStats, RtosTaskStats } from '../../../ports/types'
import { isRtosTaskStuck, rtosStatsToTimingStats, rtosTasksWithoutScans } from '../timing-stats'

const task = (overrides: Partial<RtosTaskStats>): RtosTaskStats => ({
  name: 'MAINTASK',
  releases: 100,
  overruns: 2,
  scanMinUs: 2000,
  scanAvgUs: 2100,
  scanMaxUs: 2300,
  latencyAvgUs: 15,
  latencyMaxUs: 19,
  cycleMinUs: 9990,
  cycleMaxUs: 10010,
  stackFreeBytes: 14000,
  busyUs: 0,
  periodUs: 10000,
  ...overrides,
})

const stats = (tasks: RtosTaskStats[]): RtosStats => ({
  tasks,
  services: [],
  dispatcherStackFreeBytes: 6000,
  heapFreeBytes: 250000,
  heapMinFreeBytes: 240000,
  baseTickUs: 10000,
  retainLateMaxUs: 0,
})

describe('rtosStatsToTimingStats', () => {
  it('carries each task into the scan-cycle table’s shape', () => {
    expect(rtosStatsToTimingStats(stats([task({})])).tasks).toEqual([
      {
        name: 'MAINTASK',
        scan_count: 100,
        scan_time_min: 2000,
        scan_time_max: 2300,
        scan_time_avg: 2100,
        cycle_time_min: 9990,
        cycle_time_max: 10010,
        cycle_time_avg: null,
        cycle_latency_min: null,
        cycle_latency_max: 19,
        cycle_latency_avg: 15,
        overruns: 2,
      },
    ])
  })

  it('leaves out what a task has not measured yet, rather than showing zero', () => {
    const [idle] = rtosStatsToTimingStats(stats([task({ releases: 0, cycleMinUs: 0, cycleMaxUs: 0 })])).tasks
    expect(idle.scan_time_avg).toBeNull()
    expect(idle.cycle_time_min).toBeNull()
    expect(idle.cycle_latency_max).toBeNull()
  })
})

describe('a stuck task', () => {
  it('is one inside a scan for more than twice its period, and 20 ms at least', () => {
    expect(isRtosTaskStuck({ busyUs: 0, periodUs: 10000 })).toBe(false)
    expect(isRtosTaskStuck({ busyUs: 20000, periodUs: 10000 })).toBe(false)
    expect(isRtosTaskStuck({ busyUs: 20001, periodUs: 10000 })).toBe(true)
    // A fast task is not stuck for being briefly past two periods.
    expect(isRtosTaskStuck({ busyUs: 5000, periodUs: 1000 })).toBe(false)
    expect(isRtosTaskStuck({ busyUs: 250000, periodUs: 100000 })).toBe(true)
  })

  it('is listed with the tasks that finished no scan in the window, which the table leaves out', () => {
    const listed = rtosTasksWithoutScans(
      stats([
        task({ name: 'RUNNING' }),
        task({ name: 'STUCK', releases: 0, overruns: 40, busyUs: 3_000_000 }),
        task({ name: 'SKIPPED', releases: 0, overruns: 3, busyUs: 15000 }),
        task({ name: 'IDLE', releases: 0, overruns: 0 }),
      ]),
    )
    expect(listed).toEqual([
      { name: 'STUCK', stuckForUs: 3_000_000, skipped: 40 },
      { name: 'SKIPPED', skipped: 3 },
    ])
  })
})
