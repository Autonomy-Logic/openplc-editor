import {
  ALL_INTERFACES_ADDRESS,
  buildBindAddressSuggestions,
  getBindAddressMode,
  isValidIpv4Address,
  LOCALHOST_ADDRESS,
  SPECIFIC_INTERFACE_MODE,
} from '../bind-address'

describe('isValidIpv4Address', () => {
  it.each(['0.0.0.0', '127.0.0.1', '192.168.1.10', '10.0.0.255', '255.255.255.255', ' 172.16.0.1 '])(
    'accepts %p',
    (value) => {
      expect(isValidIpv4Address(value)).toBe(true)
    },
  )

  it.each(['', 'eth0', 'localhost', '192.168.1', '192.168.1.256', '192.168.01.10', '1.2.3.4.5', '::1', 'a.b.c.d'])(
    'rejects %p',
    (value) => {
      expect(isValidIpv4Address(value)).toBe(false)
    },
  )
})

describe('getBindAddressMode', () => {
  it('maps the well-known addresses to their own option', () => {
    expect(getBindAddressMode(ALL_INTERFACES_ADDRESS)).toBe(ALL_INTERFACES_ADDRESS)
    expect(getBindAddressMode(LOCALHOST_ADDRESS)).toBe(LOCALHOST_ADDRESS)
  })

  it('maps any other address to the specific interface option', () => {
    expect(getBindAddressMode('192.168.1.10')).toBe(SPECIFIC_INTERFACE_MODE)
  })
})

describe('buildBindAddressSuggestions', () => {
  it('returns known addresses in priority order without duplicates', () => {
    expect(
      buildBindAddressSuggestions({
        currentBindAddress: '10.0.0.5',
        deviceIpAddress: '192.168.1.10',
        connectedIpAddress: '192.168.1.10',
      }),
    ).toEqual([
      { address: '10.0.0.5', source: 'Current' },
      { address: '192.168.1.10', source: 'Device configuration' },
    ])
  })

  it('skips empty, invalid and well-known addresses', () => {
    expect(
      buildBindAddressSuggestions({
        currentBindAddress: ALL_INTERFACES_ADDRESS,
        deviceIpAddress: 'my-plc.local',
        connectedIpAddress: null,
      }),
    ).toEqual([])
  })
})
