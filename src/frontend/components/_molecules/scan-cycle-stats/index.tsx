import { RangeCell, StatsTable, type StatsTableColumn } from '@root/frontend/components/_molecules/stats-table'
import type { TaskTimingStats, TimingStats } from '@root/middleware/shared/ports/types'

interface ScanCycleStatsProps {
  /** Per-task timing stats from the runtime. Renders one row per task. */
  timingStats: TimingStats
}

const columns: StatsTableColumn<TaskTimingStats>[] = [
  {
    key: 'task',
    header: 'Task',
    align: 'left',
    className: 'font-mono',
    render: (task) => task.name,
  },
  {
    key: 'scan-count',
    header: 'Scan Count',
    render: (task) => task.scan_count.toLocaleString(),
  },
  {
    key: 'scan-time',
    header: 'Scan Time',
    render: (task) => <RangeCell avg={task.scan_time_avg} min={task.scan_time_min} max={task.scan_time_max} />,
  },
  {
    key: 'cycle-time',
    header: 'Cycle Time',
    render: (task) => <RangeCell avg={task.cycle_time_avg} min={task.cycle_time_min} max={task.cycle_time_max} />,
  },
  {
    key: 'latency',
    header: 'Latency',
    render: (task) => (
      <RangeCell avg={task.cycle_latency_avg} min={task.cycle_latency_min} max={task.cycle_latency_max} />
    ),
  },
  {
    key: 'overruns',
    header: 'Overruns',
    render: (task) => task.overruns.toLocaleString(),
  },
]

/**
 * Per-task scan-cycle statistics. Renders one row per IEC task the runtime
 * reports — under STruC++ each task runs on its own thread and is timed
 * independently. Hides itself when no task has completed a full cycle yet.
 *
 * Defensive against pre-strucpp runtimes that emit the old flat shape
 * (no `tasks` array): connecting to one of those is functionally degraded
 * but must not crash the editor.
 */
export const ScanCycleStats = ({ timingStats }: ScanCycleStatsProps) => {
  const tasks = timingStats.tasks ?? []
  const activeTasks = tasks.filter((t) => t.scan_count > 0)
  if (activeTasks.length === 0) return null

  return (
    <StatsTable
      context='scan-cycle-stats'
      title='Scan Cycle Statistics'
      description='Times in microseconds. Each cell shows a moving average with min / max below.'
      columns={columns}
      rows={activeTasks}
      rowKey={(task) => task.name}
    />
  )
}
