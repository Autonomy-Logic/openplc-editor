import type { EtherCATMasterStatus, EtherCATRuntimeStatusResponse } from '@root/types/ethercat'

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

  it('falls through to the legacy single-master shape when masters is empty', () => {
    const status: EtherCATRuntimeStatusResponse = {
      masters: [],
      plugin_state: 'OPERATIONAL',
      slave_count: 3,
      expected_wkc: 6,
      slaves: [],
      metrics: baseMetrics,
    }
    expect(normalizeEthercatStatus(status)).toEqual([
      {
        name: '',
        plugin_state: 'OPERATIONAL',
        slave_count: 3,
        expected_wkc: 6,
        slaves: [],
        metrics: baseMetrics,
      },
    ])
  })

  it('returns an empty array when neither masters nor plugin_state is present', () => {
    expect(normalizeEthercatStatus({})).toEqual([])
  })

  it('synthesises a single master from the flat root fields', () => {
    const status: EtherCATRuntimeStatusResponse = {
      plugin_state: 'OPERATIONAL',
      slave_count: 2,
      expected_wkc: 4,
      slaves: [],
      metrics: baseMetrics,
    }
    const result = normalizeEthercatStatus(status)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: '',
      plugin_state: 'OPERATIONAL',
      slave_count: 2,
      expected_wkc: 4,
      slaves: [],
      metrics: baseMetrics,
    })
  })

  it('defaults missing flat fields when synthesising the legacy master', () => {
    const status: EtherCATRuntimeStatusResponse = { plugin_state: 'INIT' }
    const result = normalizeEthercatStatus(status)
    expect(result).toEqual([
      {
        name: '',
        plugin_state: 'INIT',
        slave_count: 0,
        expected_wkc: 0,
        slaves: [],
        metrics: {
          cycle_count: 0,
          wkc_error_count: 0,
          avg_cycle_us: 0,
          max_cycle_us: 0,
          max_exchange_us: 0,
          consecutive_wkc_errors: 0,
          recovery_attempts: 0,
        },
      },
    ])
  })
})
