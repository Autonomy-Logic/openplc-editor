import { RangeCell, StatsTable, type StatsTableColumn } from '@root/frontend/components/_molecules/stats-table'
import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import type { EtherCATMasterStatus, EtherCATRuntimeStatusResponse } from '@root/types/ethercat'
import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 2000

interface EtherCATStatsProps {
  ipAddress: string | null
  jwtToken: string | null
  isConnected: boolean
}

const columns: StatsTableColumn<EtherCATMasterStatus>[] = [
  {
    key: 'master',
    header: 'Master',
    align: 'left',
    className: 'font-mono',
    render: (m) => m.name,
  },
  {
    key: 'cycle-count',
    header: 'Cycle Count',
    render: (m) => m.metrics.cycle_count.toLocaleString(),
  },
  {
    key: 'bus-cycle',
    header: 'Bus Cycle',
    render: (m) => (
      <RangeCell avg={m.metrics.avg_cycle_us} min={m.metrics.min_cycle_us} max={m.metrics.max_cycle_us} />
    ),
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
    key: 'wkc-errors',
    header: 'WKC Errors',
    render: (m) => m.metrics.wkc_error_count.toLocaleString(),
  },
]

/**
 * Normalises the runtime-status payload into a list of masters.
 * Handles both the multi-master `masters[]` shape and the legacy flat
 * single-master shape.
 */
function resolveMasters(response: EtherCATRuntimeStatusResponse): EtherCATMasterStatus[] {
  if (response.masters && response.masters.length > 0) return response.masters
  if (response.plugin_state && response.metrics && response.slaves) {
    return [
      {
        name: 'default',
        plugin_state: response.plugin_state,
        slave_count: response.slave_count ?? 0,
        expected_wkc: response.expected_wkc ?? 0,
        slaves: response.slaves,
        metrics: response.metrics,
      },
    ]
  }
  return []
}

/**
 * Recognises errors that mean the EtherCAT plugin isn't loaded on the
 * runtime — distinct from real connectivity failures. Plugin-not-active
 * cases hide the panel silently; everything else stays out of view too
 * (this component is a quiet drop-in next to the IEC stats table).
 */
function isPluginNotActiveError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('not loaded') ||
    lower.includes('not available') ||
    lower.includes('plugin not active') ||
    lower.includes('plugin not found') ||
    lower.includes('<!doctype') ||
    lower.includes('<html') ||
    lower.includes('404')
  )
}

/**
 * EtherCAT bus-cycle statistics — one row per configured master.
 *
 * Polls the runtime's EtherCAT plugin status endpoint on the same 2 s
 * cadence as the IEC stats table. Renders nothing when the plugin isn't
 * active, hasn't reported any cycles yet, or the device isn't connected,
 * so it's safe to drop in unconditionally next to the IEC stats.
 */
export const EtherCATStats = ({ ipAddress, jwtToken, isConnected }: EtherCATStatsProps) => {
  const runtime = useRuntime()
  const [masters, setMasters] = useState<EtherCATMasterStatus[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  // Hand-rolled "set if changed" guard so a no-op clear (already empty)
  // doesn't cause a re-render. Otherwise every poll on a disconnected
  // component would create a fresh `[]` and bump React's render count
  // for nothing.
  const setMastersIfChanged = useCallback((next: EtherCATMasterStatus[]) => {
    if (!isMountedRef.current) return
    setMasters((prev) => {
      if (prev === next) return prev
      if (prev.length === 0 && next.length === 0) return prev
      return next
    })
  }, [])

  const fetchStats = useCallback(async () => {
    if (!isConnected || !ipAddress || !jwtToken || !runtime.getEthercatRuntimeStatus) {
      setMastersIfChanged([])
      return
    }
    try {
      const result = await runtime.getEthercatRuntimeStatus()
      // Bail if the component unmounted while the fetch was in flight —
      // setState on an unmounted component is a leak (and a dev warning
      // under React strict mode).
      if (!isMountedRef.current) return
      if (result.success && result.data) {
        setMastersIfChanged(resolveMasters(result.data))
      } else {
        const message = result.error ?? ''
        if (isPluginNotActiveError(message)) {
          setMastersIfChanged([])
        }
      }
    } catch {
      // Quiet drop-in — leave previous state alone on transient errors.
    }
  }, [isConnected, ipAddress, jwtToken, runtime, setMastersIfChanged])

  useEffect(() => {
    isMountedRef.current = true
    if (!isConnected) {
      setMastersIfChanged([])
      return () => {
        isMountedRef.current = false
      }
    }
    void fetchStats()
    intervalRef.current = setInterval(() => void fetchStats(), POLL_INTERVAL_MS)
    return () => {
      isMountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isConnected, fetchStats, setMastersIfChanged])

  const activeMasters = masters.filter((m) => m.metrics?.cycle_count > 0)
  if (activeMasters.length === 0) return null

  return (
    <StatsTable
      context='ethercat-stats'
      title='EtherCAT Bus Statistics'
      description='Times in microseconds. Each cell shows a moving average with min / max below.'
      columns={columns}
      rows={activeMasters}
      rowKey={(m) => m.name}
    />
  )
}
