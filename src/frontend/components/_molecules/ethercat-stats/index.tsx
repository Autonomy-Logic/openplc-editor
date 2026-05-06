import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@root/frontend/components/_atoms/table'
import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import type { EtherCATMasterStatus, EtherCATRuntimeStatusResponse } from '@root/types/ethercat'
import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 2000

interface EtherCATStatsProps {
  ipAddress: string | null
  jwtToken: string | null
  isConnected: boolean
}

const formatRange = (min: number | null | undefined, max: number | null | undefined) =>
  min != null && max != null ? `${min} / ${max}` : '—'

const formatNumber = (value: number | null | undefined) => (value != null ? value.toLocaleString() : '—')

const RangeCell = ({
  avg,
  min,
  max,
}: {
  avg: number | null | undefined
  min: number | null | undefined
  max: number | null | undefined
}) => (
  <div className='flex flex-col items-center justify-center leading-tight'>
    <span className='text-neutral-900 dark:text-white'>{formatNumber(avg)}</span>
    <span className='text-[10px] text-neutral-500 dark:text-neutral-400'>{formatRange(min, max)}</span>
  </div>
)

const MasterRow = ({ master }: { master: EtherCATMasterStatus }) => {
  const m = master.metrics
  return (
    <TableRow>
      <TableCell className='px-3 text-left font-mono'>{master.name}</TableCell>
      <TableCell className='px-3'>{m.cycle_count.toLocaleString()}</TableCell>
      <TableCell className='px-3'>
        <RangeCell avg={m.avg_cycle_us} min={m.min_cycle_us} max={m.max_cycle_us} />
      </TableCell>
      <TableCell className='px-3'>
        <RangeCell avg={m.avg_period_us} min={m.min_period_us} max={m.max_period_us} />
      </TableCell>
      <TableCell className='px-3'>
        <RangeCell avg={m.avg_latency_us} min={m.min_latency_us} max={m.max_latency_us} />
      </TableCell>
      <TableCell className='px-3'>{m.wkc_error_count.toLocaleString()}</TableCell>
    </TableRow>
  )
}

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
    <div id='ethercat-stats-section' className='flex w-full flex-col gap-3'>
      <h2 id='ethercat-stats-title' className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
        EtherCAT Bus Statistics
      </h2>
      <span className='select-none text-xs text-neutral-500 dark:text-neutral-400'>
        Times in microseconds. Each cell shows a moving average with min / max below.
      </span>
      <Table context='ethercat-stats' className='w-full'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-auto px-3 text-left'>Master</TableHead>
            <TableHead className='w-auto px-3'>Cycle Count</TableHead>
            <TableHead className='w-auto px-3'>Bus Cycle</TableHead>
            <TableHead className='w-auto px-3'>Period</TableHead>
            <TableHead className='w-auto px-3'>Wake Latency</TableHead>
            <TableHead className='w-auto px-3'>WKC Errors</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeMasters.map((master) => (
            <MasterRow key={master.name} master={master} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
