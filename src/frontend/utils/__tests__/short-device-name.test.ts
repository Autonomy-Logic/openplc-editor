import { getShortDeviceName } from '../short-device-name'

const make = (
  overrides: Partial<{ typeName: string; name: string; productCode: string; revisionNo: string }> = {},
) => ({
  type: {
    name: overrides.typeName ?? '',
    productCode: overrides.productCode ?? '0x07212C52',
    revisionNo: overrides.revisionNo ?? '0x00110000',
  },
  name: overrides.name ?? '',
})

describe('getShortDeviceName', () => {
  describe('P1: <Type> text as short code', () => {
    it('returns <Type> text when it looks like an SKU', () => {
      expect(getShortDeviceName(make({ typeName: 'EL1809' }))).toBe('EL1809')
    })

    it('accepts SKUs with hyphens up to 24 chars', () => {
      expect(getShortDeviceName(make({ typeName: 'EL2521-0124-0010' }))).toBe('EL2521-0124-0010')
    })

    it('trims surrounding whitespace before evaluating', () => {
      expect(getShortDeviceName(make({ typeName: '  EL1809  ' }))).toBe('EL1809')
    })

    it('falls through to P2 when <Type> text contains internal whitespace', () => {
      // P1 rejects (whitespace), P2 takes first token "EK1100" — SKU-shaped, returned
      expect(getShortDeviceName(make({ typeName: 'Generic Coupler', name: 'EK1100 EtherCAT Coupler' }))).toBe('EK1100')
    })

    it('falls through to P3 when both P1 and P2 reject but <Type> text exists', () => {
      // P1 rejects (whitespace), P2 rejects ("Generic" has no digit), P3 returns <Type> text
      expect(getShortDeviceName(make({ typeName: 'Generic Coupler', name: 'Generic Coupler description' }))).toBe(
        'Generic Coupler',
      )
    })

    it('falls through when <Type> text is longer than 24 chars', () => {
      expect(
        getShortDeviceName(make({ typeName: 'ExtraLongDescriptiveTypeName123', name: 'EL1809 2Ch. Digital Input' })),
      ).toBe('EL1809')
    })
  })

  describe('P2: first token of <Name> as SKU', () => {
    it('extracts SKU when it leads the long name', () => {
      expect(getShortDeviceName(make({ name: 'EL1809 2Ch. Digital Input 24V, 3ms' }))).toBe('EL1809')
    })

    it('handles comma and semicolon separators', () => {
      expect(getShortDeviceName(make({ name: 'EK1100,EtherCAT Coupler' }))).toBe('EK1100')
    })

    it('rejects digit-leading tokens like "2-Channel"', () => {
      // P2 rejects, P3 unavailable, P4 returns the long name as-is
      expect(getShortDeviceName(make({ name: '2-Channel Digital Input' }))).toBe('2-Channel Digital Input')
    })

    it('rejects pure-letter tokens like "EtherCAT"', () => {
      expect(getShortDeviceName(make({ name: 'EtherCAT Generic Slave' }))).toBe('EtherCAT Generic Slave')
    })

    it('rejects tokens shorter than 3 chars even if SKU-shaped', () => {
      expect(getShortDeviceName(make({ name: 'A1 short token here' }))).toBe('A1 short token here')
    })

    it('rejects tokens longer than 24 chars', () => {
      const longToken = 'X' + '1'.repeat(24)
      expect(getShortDeviceName(make({ name: `${longToken} description` }))).toBe(`${longToken} description`)
    })

    it('accepts SKUs with mixed digits and hyphens (e.g. Omron R88D-1SN02H-ECT)', () => {
      expect(getShortDeviceName(make({ name: 'R88D-1SN02H-ECT Servo Drive' }))).toBe('R88D-1SN02H-ECT')
    })
  })

  describe('P3: <Type> text as last readable fallback', () => {
    it('returns <Type> text when it has whitespace and P2 finds nothing usable', () => {
      expect(getShortDeviceName(make({ typeName: 'Generic Coupler' }))).toBe('Generic Coupler')
    })
  })

  describe('P4: long name as-is', () => {
    it('returns the long name when both P1 and P2 reject', () => {
      expect(getShortDeviceName(make({ name: 'Generic EtherCAT Slave' }))).toBe('Generic EtherCAT Slave')
    })
  })

  describe('P5: canonical identity fallback', () => {
    it('returns Device_{productCode}_{revisionNo} when no name is available', () => {
      expect(getShortDeviceName(make({ productCode: '0x07212C52', revisionNo: '0x00110000' }))).toBe(
        'Device_0x07212C52_0x00110000',
      )
    })

    it('treats whitespace-only names as empty', () => {
      expect(getShortDeviceName(make({ typeName: '   ', name: '   ' }))).toBe('Device_0x07212C52_0x00110000')
    })
  })
})
