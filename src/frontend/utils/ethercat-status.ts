import type { EtherCATMasterStatus, EtherCATRuntimeStatusResponse } from '@root/types/ethercat'

const EMPTY_METRICS: EtherCATMasterStatus['metrics'] = {
  cycle_count: 0,
  wkc_error_count: 0,
  avg_cycle_us: 0,
  max_cycle_us: 0,
  max_exchange_us: 0,
  consecutive_wkc_errors: 0,
  recovery_attempts: 0,
}

/**
 * Normalise the runtime's two response shapes into a single masters array.
 * Modern runtimes ship `masters[]` (one entry per configured EtherCAT bus);
 * older ones inline the fields for a single master at the response root.
 * Either way callers render one stats section per master.
 */
export function normalizeEthercatStatus(
  status: EtherCATRuntimeStatusResponse | null | undefined,
): EtherCATMasterStatus[] {
  if (!status) return []
  if (status.masters && status.masters.length > 0) return status.masters
  if (status.plugin_state === undefined) return []
  return [
    {
      name: '',
      plugin_state: status.plugin_state,
      slave_count: status.slave_count ?? 0,
      expected_wkc: status.expected_wkc ?? 0,
      slaves: status.slaves ?? [],
      metrics: status.metrics ?? EMPTY_METRICS,
    },
  ]
}
