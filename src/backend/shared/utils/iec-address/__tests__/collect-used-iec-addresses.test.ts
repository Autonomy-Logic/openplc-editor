import { collectUsedIecAddresses } from '../collect-used-iec-addresses'

describe('collectUsedIecAddresses', () => {
  it('returns an empty set when given undefined remote devices and no vendor data', () => {
    expect(collectUsedIecAddresses(undefined)).toEqual(new Set())
  })

  it('returns an empty set when given an empty remote-devices array', () => {
    expect(collectUsedIecAddresses([])).toEqual(new Set())
  })

  it('collects addresses from modbus TCP ioPoints', () => {
    const result = collectUsedIecAddresses([
      {
        modbusTcpConfig: {
          ioGroups: [
            { ioPoints: [{ iecLocation: '%IX0.0' }, { iecLocation: '%IX0.1' }] },
            { ioPoints: [{ iecLocation: '%IW10' }] },
          ],
        },
      },
    ])
    expect(result).toEqual(new Set(['%IX0.0', '%IX0.1', '%IW10']))
  })

  it('collects addresses from EtherCAT channel mappings', () => {
    const result = collectUsedIecAddresses([
      {
        ethercatConfig: {
          devices: [
            { channelMappings: [{ iecLocation: '%QX0.0' }, { iecLocation: '%QX0.1' }] },
            { channelMappings: [{ iecLocation: '%QW5' }] },
          ],
        },
      },
    ])
    expect(result).toEqual(new Set(['%QX0.0', '%QX0.1', '%QW5']))
  })

  it('collects from modbus and EtherCAT on the same remote device', () => {
    const result = collectUsedIecAddresses([
      {
        modbusTcpConfig: { ioGroups: [{ ioPoints: [{ iecLocation: '%IX0.0' }] }] },
        ethercatConfig: { devices: [{ channelMappings: [{ iecLocation: '%QX1.0' }] }] },
      },
    ])
    expect(result).toEqual(new Set(['%IX0.0', '%QX1.0']))
  })

  it('collects from VPP vendor io-mapping entries', () => {
    const result = collectUsedIecAddresses(undefined, {
      'io-mapping': {
        entries: [{ iecAddress: '%IX2.0' }, { iecAddress: '%QW3' }],
      },
    })
    expect(result).toEqual(new Set(['%IX2.0', '%QW3']))
  })

  it('unifies the namespace across modbus, EtherCAT, and VPP — overlapping addresses dedupe', () => {
    const result = collectUsedIecAddresses(
      [
        { modbusTcpConfig: { ioGroups: [{ ioPoints: [{ iecLocation: '%IX0.0' }] }] } },
        { ethercatConfig: { devices: [{ channelMappings: [{ iecLocation: '%IX0.0' }] }] } },
      ],
      { 'io-mapping': { entries: [{ iecAddress: '%IX0.0' }] } },
    )
    expect(result.size).toBe(1)
    expect(result.has('%IX0.0')).toBe(true)
  })

  it('skips io-mapping entries with missing iecAddress', () => {
    const result = collectUsedIecAddresses(undefined, {
      'io-mapping': {
        entries: [{ iecAddress: '%IX0.0' }, {} as { iecAddress?: string }, { iecAddress: '' }],
      },
    })
    // Empty string is falsy → skipped. Only %IX0.0 lands.
    expect(result).toEqual(new Set(['%IX0.0']))
  })

  it('tolerates a vendorScreenData object without an io-mapping key', () => {
    const result = collectUsedIecAddresses(undefined, { 'hal-config': { interface: 'eth0' } })
    expect(result).toEqual(new Set())
  })

  it('tolerates io-mapping with no entries array', () => {
    const result = collectUsedIecAddresses(undefined, { 'io-mapping': {} })
    expect(result).toEqual(new Set())
  })

  it('tolerates remote devices missing both modbusTcpConfig and ethercatConfig', () => {
    const result = collectUsedIecAddresses([{}, { modbusTcpConfig: { ioGroups: [] } }])
    expect(result).toEqual(new Set())
  })

  it('tolerates ioGroups with no ioPoints array', () => {
    const result = collectUsedIecAddresses([
      {
        modbusTcpConfig: { ioGroups: [{}, { ioPoints: [{ iecLocation: '%IX0.0' }] }] },
      },
    ])
    expect(result).toEqual(new Set(['%IX0.0']))
  })

  it('tolerates ethercat devices with no channelMappings array', () => {
    const result = collectUsedIecAddresses([
      {
        ethercatConfig: { devices: [{}, { channelMappings: [{ iecLocation: '%QX0.0' }] }] },
      },
    ])
    expect(result).toEqual(new Set(['%QX0.0']))
  })
})
