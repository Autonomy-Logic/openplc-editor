import { FormatMacAddress } from '../formatters'

describe('FormatMacAddress', () => {
  it('formats a MAC address with uppercase hex prefixed by 0x', () => {
    expect(FormatMacAddress('aa:bb:cc:dd:ee:ff')).toBe('0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF')
  })

  it('handles already-uppercase parts', () => {
    expect(FormatMacAddress('AA:BB:CC:DD:EE:FF')).toBe('0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF')
  })

  it('formats a single-byte address', () => {
    expect(FormatMacAddress('01')).toBe('0x01')
  })
})
