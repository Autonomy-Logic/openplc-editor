import { HMI_ADDRESS_PLACEHOLDER, hmiAddress } from '../address'

describe('hmiAddress', () => {
  it.each([
    ['192.168.1.20', 'https://192.168.1.20:8443/hmi/'],
    [' plc-line-3.local ', 'https://plc-line-3.local:8443/hmi/'],
    ['fe80::1', 'https://[fe80::1]:8443/hmi/'],
  ])('%j -> %s', (host, address) => {
    expect(hmiAddress(host)).toBe(address)
  })

  it.each([null, undefined, '', '   ', 'http://x', 'a b', 'host/path', 'zz::g'])('has no address for %j', (host) => {
    expect(hmiAddress(host)).toBeNull()
  })

  it('names the placeholder with the runtime port', () => {
    expect(HMI_ADDRESS_PLACEHOLDER).toBe('https://<device IP>:8443/hmi/')
  })
})
