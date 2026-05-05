import type { TaskTimingStats, TimingStats } from '@root/middleware/shared/ports/types'

interface ScanCycleStatsProps {
  /** Per-task timing stats from the runtime. Renders one block per task. */
  timingStats: TimingStats
}

const StatCard = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className='flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
    <span className='text-xs text-neutral-500 dark:text-neutral-400'>{label}</span>
    {children}
  </div>
)

const TaskStatsRow = ({ task }: { task: TaskTimingStats }) => (
  <div className='flex flex-col gap-2'>
    <h3 className='select-none font-mono text-sm font-medium text-neutral-700 dark:text-neutral-300'>{task.name}</h3>
    <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4'>
      <StatCard label='Scan Count'>
        <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
          {task.scan_count.toLocaleString()}
        </span>
      </StatCard>
      <StatCard label='Overruns'>
        <span className='text-lg font-semibold text-neutral-900 dark:text-white'>{task.overruns}</span>
      </StatCard>
      {task.scan_time_avg !== null && (
        <StatCard label='Scan Time (avg)'>
          <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
            {task.scan_time_avg} <span className='text-sm font-normal'>us</span>
          </span>
          {task.scan_time_min !== null && task.scan_time_max !== null && (
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              min: {task.scan_time_min} / max: {task.scan_time_max}
            </span>
          )}
        </StatCard>
      )}
      {task.cycle_time_avg !== null && (
        <StatCard label='Cycle Time (avg)'>
          <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
            {task.cycle_time_avg} <span className='text-sm font-normal'>us</span>
          </span>
          {task.cycle_time_min !== null && task.cycle_time_max !== null && (
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              min: {task.cycle_time_min} / max: {task.cycle_time_max}
            </span>
          )}
        </StatCard>
      )}
      {task.cycle_latency_avg !== null && (
        <StatCard label='Cycle Latency (avg)'>
          <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
            {task.cycle_latency_avg} <span className='text-sm font-normal'>us</span>
          </span>
        </StatCard>
      )}
    </div>
  </div>
)

/**
 * Per-task scan-cycle statistics. Renders one block of cards per IEC task
 * the runtime reports — under STruC++ each task runs on its own thread and
 * is timed independently. Hides itself when no task has completed a full
 * cycle yet.
 */
export const ScanCycleStats = ({ timingStats }: ScanCycleStatsProps) => {
  const activeTasks = timingStats.tasks.filter((t) => t.scan_count > 0)
  if (activeTasks.length === 0) return null

  return (
    <div id='scan-cycle-stats-section' className='flex w-full flex-col gap-4'>
      <h2 id='scan-cycle-stats-title' className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
        Scan Cycle Statistics
      </h2>
      <div className='flex flex-col gap-6'>
        {activeTasks.map((task) => (
          <TaskStatsRow key={task.name} task={task} />
        ))}
      </div>
    </div>
  )
}
