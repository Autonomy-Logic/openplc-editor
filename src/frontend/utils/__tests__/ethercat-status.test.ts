import type { EtherCATMasterStatus, EtherCATRuntimeStatusResponse } from '@root/middleware/shared/ports/ethercat-types'

import { normalizeEthercatStatus } from '../ethercat-status'

const baseMetrics: EtherCATMasterStatus['metrics'] = {
  cycle_count: 100,
  wkc_error_count: 0,
  avg_cycle_us: 250,
  max_cycle_us: 400,
  max_exchange_us: 120,
  consecutive_wkc_errors: 0,
  recovery_attempts: 0,
}

describe('normalizeEthercatStatus', () => {
  it('returns an empty array for null', () => {
    expect(normalizeEthercatStatus(null)).toEqual([])
  })

  it('returns an empty array for undefined', () => {
    expect(normalizeEthercatStatus(undefined)).toEqual([])
  })

  it('returns the masters array verbatim when populated', () => {
    const masters: EtherCATMasterStatus[] = [
      { name: 'BusA', plugin_state: 'OPERATIONAL', slave_count: 2, expected_wkc: 4, slaves: [], metrics: baseMetrics },
      { name: 'BusB', plugin_state: 'PRE-OP', slave_count: 1, expected_wkc: 2, slaves: [], metrics: baseMetrics },
    ]
    const status: EtherCATRuntimeStatusResponse = { masters }
    expect(normalizeEthercatStatus(status)).toBe(masters)
  })

  it('returns an empty array when masters is empty', () => {
    expect(normalizeEthercatStatus({ masters: [] })).toEqual([])
  })
})
