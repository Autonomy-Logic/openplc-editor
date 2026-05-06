import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@root/frontend/components/_atoms/table'
import type { TaskTimingStats, TimingStats } from '@root/middleware/shared/ports/types'

interface ScanCycleStatsProps {
  /** Per-task timing stats from the runtime. Renders one row per task. */
  timingStats: TimingStats
}

const formatRange = (min: number | null, max: number | null) =>
  min !== null && max !== null ? `${min} / ${max}` : '—'

const formatNumber = (value: number | null) => (value !== null ? value.toLocaleString() : '—')

const RangeCell = ({ avg, min, max }: { avg: number | null; min: number | null; max: number | null }) => (
  <div className='flex flex-col items-center justify-center leading-tight'>
    <span className='text-neutral-900 dark:text-white'>{formatNumber(avg)}</span>
    <span className='text-[10px] text-neutral-500 dark:text-neutral-400'>{formatRange(min, max)}</span>
  </div>
)

const TaskRow = ({ task }: { task: TaskTimingStats }) => (
  <TableRow>
    <TableCell className='px-3 text-left font-mono'>{task.name}</TableCell>
    <TableCell className='px-3'>{task.scan_count.toLocaleString()}</TableCell>
    <TableCell className='px-3'>
      <RangeCell avg={task.scan_time_avg} min={task.scan_time_min} max={task.scan_time_max} />
    </TableCell>
    <TableCell className='px-3'>
      <RangeCell avg={task.cycle_time_avg} min={task.cycle_time_min} max={task.cycle_time_max} />
    </TableCell>
    <TableCell className='px-3'>
      <RangeCell avg={task.cycle_latency_avg} min={task.cycle_latency_min} max={task.cycle_latency_max} />
    </TableCell>
    <TableCell className='px-3'>{task.overruns.toLocaleString()}</TableCell>
  </TableRow>
)

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
    <div id='scan-cycle-stats-section' className='flex w-full flex-col gap-3'>
      <h2 id='scan-cycle-stats-title' className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
        Scan Cycle Statistics
      </h2>
      <span className='select-none text-xs text-neutral-500 dark:text-neutral-400'>
        Times in microseconds. Each cell shows a moving average with min / max below.
      </span>
      <Table context='scan-cycle' className='w-full'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-auto px-3 text-left'>Task</TableHead>
            <TableHead className='w-auto px-3'>Scan Count</TableHead>
            <TableHead className='w-auto px-3'>Scan Time</TableHead>
            <TableHead className='w-auto px-3'>Cycle Time</TableHead>
            <TableHead className='w-auto px-3'>Latency</TableHead>
            <TableHead className='w-auto px-3'>Overruns</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeTasks.map((task) => (
            <TaskRow key={task.name} task={task} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
