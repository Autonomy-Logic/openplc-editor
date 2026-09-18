import type { NetworkInterfaceInfo } from 'node:os'

import {
  broadcastTargets,
  clampDiscoveryDuration,
  computeBroadcastAddress,
  DISCOVERY_DEFAULT_DURATION_MS,
  parseAdvertisement,
} from '../discover-runtimes'

describe('computeBroadcastAddress', () => {
  it('sets the host bits for common masks', () => {
    expect(computeBroadcastAddress('192.168.1.5', '255.255.255.0')).toBe('192.168.1.255')
    expect(computeBroadcastAddress('10.0.5.7', '255.255.0.0')).toBe('10.0.255.255')
    expect(computeBroadcastAddress('172.16.3.9', '255.240.0.0')).toBe('172.31.255.255')
  })

  it('falls back to the global broadcast for a degenerate mask', () => {
    // A /32 has no directed broadcast; sending somewhere beats dropping the
    // interface silently.
    expect(computeBroadcastAddress('192.168.1.5', '255.255.255.255')).toBe('192.168.1.5')
    expect(computeBroadcastAddress('nonsense', '255.255.255.0')).toBe('255.255.255.255')
    expect(computeBroadcastAddress('192.168.1.5', '999.0.0.0')).toBe('255.255.255.255')
  })
})

describe('broadcastTargets', () => {
  const iface = (address: string, netmask: string, internal: boolean): NetworkInterfaceInfo => ({
    address,
    netmask,
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: null,
  })

  it('includes the global broadcast plus one per external IPv4 interface', () => {
    // Per-interface broadcast matters: a host with docker bridges or a VPN does
    // not reliably deliver 255.255.255.255 to the subnet the PLC is on.
    const targets = broadcastTargets({
      en0: [iface('192.168.1.10', '255.255.255.0', false)],
      docker0: [iface('172.17.0.1', '255.255.0.0', false)],
    })

    expect(targets).toEqual(expect.arrayContaining(['255.255.255.255', '192.168.1.255', '172.17.255.255']))
  })

  it('skips loopback and IPv6 addresses', () => {
    const targets = broadcastTargets({
      lo0: [iface('127.0.0.1', '255.0.0.0', true)],
      en1: [
        {
          address: '::1',
          netmask: 'ffff::',
          family: 'IPv6',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: null,
          scopeid: 0,
        },
      ],
    })

    expect(targets).toEqual(['255.255.255.255'])
  })

  it('tolerates an interface entry with no addresses', () => {
    expect(broadcastTargets({ empty: undefined })).toEqual(['255.255.255.255'])
  })
})

describe('parseAdvertisement', () => {
  it('reads a runtime advertisement, taking the address from the packet source', () => {
    const payload = JSON.stringify({
      service: 'openplc-runtime',
      hostname: 'plc-lab',
      runtime_version: 'v4.1.10',
      api_port: 8443,
    })

    expect(parseAdvertisement(payload, '192.168.1.50')).toEqual({
      ipAddress: '192.168.1.50',
      hostname: 'plc-lab',
      runtimeVersion: 'v4.1.10',
      apiPort: 8443,
    })
  })

  it('defaults the api port and tolerates missing string fields', () => {
    const payload = JSON.stringify({ service: 'openplc-runtime' })

    expect(parseAdvertisement(payload, '10.0.0.2')).toEqual({
      ipAddress: '10.0.0.2',
      hostname: '',
      runtimeVersion: '',
      apiPort: 8443,
    })
  })

  it('ignores traffic that is not an OpenPLC runtime', () => {
    // It is a broadcast port; other things on the network do send to it.
    expect(parseAdvertisement('not json', '10.0.0.3')).toBeUndefined()
    expect(parseAdvertisement('null', '10.0.0.3')).toBeUndefined()
    expect(parseAdvertisement('"a string"', '10.0.0.3')).toBeUndefined()
    expect(parseAdvertisement(JSON.stringify({ service: 'something-else' }), '10.0.0.3')).toBeUndefined()
  })

  it('ignores wrongly-typed fields rather than trusting them', () => {
    const payload = JSON.stringify({ service: 'openplc-runtime', hostname: 42, api_port: '8443' })

    expect(parseAdvertisement(payload, '10.0.0.4')).toEqual({
      ipAddress: '10.0.0.4',
      hostname: '',
      runtimeVersion: '',
      apiPort: 8443,
    })
  })

  it('carries the stored project name and timestamp when the device has one', () => {
    // This is what lets the retrieve picker show something useful without
    // logging in to every device on the network first.
    const device = parseAdvertisement(
      JSON.stringify({
        service: 'openplc-runtime',
        hostname: 'plc-1',
        runtime_version: 'v4.2.0',
        api_port: 8443,
        project_name: 'Traffic Light',
        project_timestamp: '2026-08-31T12:00:00Z',
      }),
      '10.0.0.5',
    )
    expect(device?.projectName).toBe('Traffic Light')
    expect(device?.projectTimestamp).toBe('2026-08-31T12:00:00Z')
  })

  it('leaves the project fields undefined when the device stores nothing', () => {
    // Absent keys are how a device says "nothing to retrieve"; turning them
    // into empty strings would make that indistinguishable from a project
    // whose name is blank.
    const device = parseAdvertisement(
      JSON.stringify({
        service: 'openplc-runtime',
        hostname: 'plc-1',
        runtime_version: 'v4.2.0',
        api_port: 8443,
      }),
      '10.0.0.5',
    )
    expect(device?.projectName).toBeUndefined()
    expect(device?.projectTimestamp).toBeUndefined()
  })

  it('ignores an empty project name rather than showing a blank row', () => {
    const device = parseAdvertisement(
      JSON.stringify({
        service: 'openplc-runtime',
        hostname: 'plc-1',
        runtime_version: 'v4.2.0',
        api_port: 8443,
        project_name: '',
      }),
      '10.0.0.5',
    )
    expect(device?.projectName).toBeUndefined()
  })
})

describe('clampDiscoveryDuration', () => {
  it('defaults when unset and clamps to a sane window', () => {
    expect(clampDiscoveryDuration(undefined)).toBe(DISCOVERY_DEFAULT_DURATION_MS)
    expect(clampDiscoveryDuration(1)).toBe(500)
    expect(clampDiscoveryDuration(999_999)).toBe(10_000)
    expect(clampDiscoveryDuration(4000)).toBe(4000)
  })
})
