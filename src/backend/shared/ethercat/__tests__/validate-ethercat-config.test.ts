import { validateEthercatConfig } from '../validate-ethercat-config'

const makeMaster = (name: string, networkInterface: string) => ({
  name,
  protocol: 'ETHERCAT',
  config: {
    master: {
      interface: networkInterface,
      cycle_time_us: 1000,
      watchdog_timeout_cycles: 3,
    },
    slaves: [],
    diagnostics: {
      log_connections: true,
      log_data_access: false,
      log_errors: true,
      max_log_entries: 10000,
      status_update_interval_ms: 500,
    },
  },
})

const toJson = (entries: unknown[]) => JSON.stringify(entries, null, 2)

describe('validateEthercatConfig', () => {
  describe('no-op cases', () => {
    it('returns no errors when configJson is null (no EtherCAT masters generated)', () => {
      expect(validateEthercatConfig(null)).toEqual([])
    })

    it('returns no errors when configJson is an empty string', () => {
      expect(validateEthercatConfig('')).toEqual([])
    })

    it('returns no errors for an empty entries array', () => {
      expect(validateEthercatConfig(toJson([]))).toEqual([])
    })
  })

  describe('happy path', () => {
    it('returns no errors for a single master', () => {
      expect(validateEthercatConfig(toJson([makeMaster('master_a', 'eth0')]))).toEqual([])
    })

    it('returns no errors for multiple masters with distinct interfaces', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth1'),
        makeMaster('master_c', 'enp3s0'),
      ])
      expect(validateEthercatConfig(json)).toEqual([])
    })
  })

  describe('unique-interface validation', () => {
    it('returns an error when two masters share the same interface', () => {
      const json = toJson([makeMaster('master_a', 'eth0'), makeMaster('master_b', 'eth0')])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain("'eth0'")
      expect(errors[0]).toContain('master_a')
      expect(errors[0]).toContain('master_b')
    })

    it('reports each duplicate group once when three masters share an interface', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth0'),
        makeMaster('master_c', 'eth0'),
      ])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('master_a')
      expect(errors[0]).toContain('master_b')
      expect(errors[0]).toContain('master_c')
    })

    it('reports multiple duplicate groups separately', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth0'),
        makeMaster('master_c', 'eth1'),
        makeMaster('master_d', 'eth1'),
        makeMaster('master_e', 'eth2'),
      ])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(2)
      const joined = errors.join(' | ')
      expect(joined).toContain("'eth0'")
      expect(joined).toContain("'eth1'")
      expect(joined).not.toContain("'eth2'")
    })

    it('does not flag a unique interface that appears alongside duplicates', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth0'),
        makeMaster('master_c', 'eth1'),
      ])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(1)
      expect(errors[0]).not.toContain("'eth1'")
    })

    it('uses a placeholder name for unnamed masters', () => {
      const json = toJson([makeMaster('', 'eth0'), makeMaster('', 'eth0')])
      const errors = validateEthercatConfig(json)
      expect(errors[0]).toContain('<unnamed master>')
    })
  })

  describe('malformed input', () => {
    it('returns an error when the JSON is unparseable', () => {
      const errors = validateEthercatConfig('{not json')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('Failed to parse')
    })

    it('returns an error when the parsed value is not an array', () => {
      const errors = validateEthercatConfig('{"foo": "bar"}')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('not an array')
    })
  })
})
