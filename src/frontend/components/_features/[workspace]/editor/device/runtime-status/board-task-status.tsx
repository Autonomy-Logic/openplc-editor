/**
 * Runtime Status for a baremetal board in RTOS mode: each task's timing, read
 * over the held device link (FC 0x4e) and shown in the scan-cycle table a
 * runtime's statistics use, plus the board's services and memory. Whether it
 * runs RTOS mode is the board's answer, not the project's setting.
 */

import { useBoardTaskStats } from '@root/frontend/hooks/use-board-task-stats'
import { rtosStatsToTimingStats, rtosTasksWithoutScans } from '@root/middleware/shared/utils/rtos'

import { useOpenPLCStore } from '../../../../../../store'
import { ScanCycleStats } from '../../../../../_molecules/scan-cycle-stats'
import { InfoField } from './info-field'

const formatMs = (us: number): string => `${(us / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} ms`
const formatS = (us: number): string => `${(us / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`
const formatKb = (bytes: number): string => `${Math.round(bytes / 1024).toLocaleString()} KB`

const BoardTaskStatus = () => {
  const deviceBoard = useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard)
  const port = useOpenPLCStore((state) => state.deviceConnection.port)
  const { stats, busySinceOpen, answered, unsupported, stalled, error } = useBoardTaskStats(true)
  const service = stats?.services[0]
  const withoutScans = stats ? rtosTasksWithoutScans(stats) : []
  const ran = stats !== null && (stats.tasks.some((task) => task.releases > 0) || withoutScans.length > 0)
  const busyReplies = busySinceOpen?.reduce((sum, count) => sum + count, 0)
  const mode = unsupported ? 'Single loop' : answered ? 'RTOS' : undefined

  const bodyMessage = unsupported
    ? 'This board reports no task statistics: its firmware runs the single scan loop (RTOS mode switched off, ' +
      'a build that did not fit RTOS mode, or firmware older than this project). Upload the project in RTOS ' +
      'mode (Board Settings) to see them.'
    : stalled
      ? `The board is not answering for its task statistics (${error ?? 'no reply'}). Still asking, every few seconds.`
      : !stats
        ? answered
          ? 'Measuring: the first figures appear a moment after the screen opens.'
          : (error ?? 'Reading the task statistics…')
        : !ran
          ? 'No task has run since the screen opened: the PLC is stopped.'
          : 'Measured since this screen opened. Times in microseconds.'

  return (
    <div
      aria-label='Runtime status container'
      className='flex h-full w-full flex-col gap-6 overflow-auto p-6'
      id='runtime-status-container'
    >
      <header className='flex flex-col gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800'>
        <div className='flex flex-col gap-1'>
          <h2 className='select-none text-lg font-medium text-neutral-950 dark:text-white'>Runtime Status</h2>
          <p className='text-sm text-neutral-500 dark:text-neutral-400'>
            {port ? `${deviceBoard} · ${port}` : deviceBoard}
          </p>
        </div>
        <dl className='grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-3'>
          <InfoField label='Mode' value={mode} />
          <InfoField label='Base tick' value={stats ? formatMs(stats.baseTickUs) : undefined} />
          <InfoField
            label='Free memory'
            value={
              stats && stats.heapFreeBytes > 0
                ? `${formatKb(stats.heapFreeBytes)} (lowest ${formatKb(stats.heapMinFreeBytes)})`
                : undefined
            }
          />
          <InfoField
            label='Debugger task, longest pass'
            value={service ? formatMs(service.iterationMaxUs) : undefined}
          />
          <InfoField
            label='Busy replies since opened'
            value={busyReplies !== undefined ? busyReplies.toLocaleString() : undefined}
          />
          <InfoField
            label='Retain, longest delay'
            value={stats && stats.retainLateMaxUs > 0 ? formatMs(stats.retainLateMaxUs) : undefined}
          />
        </dl>
      </header>

      <div className='flex w-full flex-col gap-6'>
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>{bodyMessage}</p>
        {withoutScans.length > 0 && (
          <ul aria-label='Tasks without a completed scan' className='flex flex-col gap-1 text-sm'>
            {withoutScans.map((task) => (
              <li className='text-amber-700 dark:text-amber-400' key={task.name}>
                <span className='font-mono'>{task.name}</span>
                {task.stuckForUs !== undefined
                  ? `: stuck in one scan for ${formatS(task.stuckForUs)} (a block waiting, on the network perhaps)`
                  : ': has not finished a scan since the screen opened'}
                {task.skipped > 0 ? `; ${task.skipped.toLocaleString()} releases skipped` : ''}
              </li>
            ))}
          </ul>
        )}
        {stats && ran && <ScanCycleStats timingStats={rtosStatsToTimingStats(stats)} />}
      </div>
    </div>
  )
}

export { BoardTaskStatus }
