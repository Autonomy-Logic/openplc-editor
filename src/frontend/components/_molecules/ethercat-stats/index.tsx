import { RangeCell, StatsTable, type StatsTableColumn } from '@root/frontend/components/_molecules/stats-table'
import { useOpenPLCStore } from '@root/frontend/store'
import { normalizeEthercatStatus } from '@root/frontend/utils/ethercat-status'
import type { EtherCATMasterStatus } from '@root/middleware/shared/ports/ethercat-types'

const columns: StatsTableColumn<EtherCATMasterStatus>[] = [
  {
    key: 'master',
    header: 'Master',
    align: 'left',
    className: 'font-mono',
    render: (m) => m.name || 'default',
  },
  {
    key: 'state',
    header: 'State',
    render: (m) => m.plugin_state,
  },
  {
    key: 'slaves',
    header: 'Slaves',
    render: (m) => m.slave_count.toLocaleString(),
  },
  {
    key: 'cycle-count',
    header: 'Cycle Count',
    render: (m) => m.metrics.cycle_count.toLocaleString(),
  },
  {
    key: 'bus-cycle',
    header: 'Bus Cycle',
    render: (m) => <RangeCell avg={m.metrics.avg_cycle_us} min={m.metrics.min_cycle_us} max={m.metrics.max_cycle_us} />,
  },
  {
    key: 'period',
    header: 'Period',
    render: (m) => (
      <RangeCell avg={m.metrics.avg_period_us} min={m.metrics.min_period_us} max={m.metrics.max_period_us} />
    ),
  },
  {
    key: 'wake-latency',
    header: 'Wake Latency',
    render: (m) => (
      <RangeCell avg={m.metrics.avg_latency_us} min={m.metrics.min_latency_us} max={m.metrics.max_latency_us} />
    ),
  },
  {
    key: 'max-exchange',
    header: 'Max Exchange',
    render: (m) => m.metrics.max_exchange_us.toLocaleString(),
  },
  {
    key: 'wkc-errors',
    header: 'WKC Errors',
    render: (m) => (
      <div className='flex flex-col items-end'>
        <span>{m.metrics.wkc_error_count.toLocaleString()}</span>
        {m.metrics.consecutive_wkc_errors > 0 && (
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>
            consecutive: {m.metrics.consecutive_wkc_errors}
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'recovery',
    header: 'Recovery',
    render: (m) => m.metrics.recovery_attempts.toLocaleString(),
  },
]

/**
 * EtherCAT bus statistics — one row per configured master.
 *
 * Reads `runtimeConnection.ethercatStatus` straight from the device
 * slice; the poll that populates it is owned by `useRuntimePolling`
 * and gated by `includeEthercatStatsInPolling`. Call sites flip that
 * gate on mount and off on unmount so the global hook only does the
 * extra fetch when a stats screen is actually showing.
 *
 * Renders nothing when disconnected or when no masters have been
 * reported (plugin not loaded). When masters exist but haven't
 * started cycling yet, the row still renders with zeroed metrics —
 * matches the rest of the screen's "show the panel immediately,
 * fill in the numbers as they arrive" behaviour.
 */
export const EtherCATStats = () => {
  const ethercatStatus = useOpenPLCStore((state) => state.runtimeConnection.ethercatStatus)
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)

  if (connectionStatus !== 'connected') return null

  const masters = normalizeEthercatStatus(ethercatStatus)
  if (masters.length === 0) return null

  return (
    <StatsTable
      context='ethercat-stats'
      title='EtherCAT Bus Statistics'
      description='Times in microseconds. Each cell shows a moving average with min / max below.'
      columns={columns}
      rows={masters}
      rowKey={(m) => m.name || 'default'}
    />
  )
}
