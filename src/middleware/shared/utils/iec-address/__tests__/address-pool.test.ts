import {
  ARDUINO_CLI_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
  type TargetCapabilities,
} from '../../target-capabilities'
import { buildAddressPool, isAddressClaimed, listClaims, nextFreeAddress, type PoolInputs } from '../address-pool'

const arduinoCaps: TargetCapabilities = ARDUINO_CLI_CAPABILITIES
const v4Caps: TargetCapabilities = RUNTIME_V4_CAPABILITIES
const simCaps: TargetCapabilities = SIMULATOR_CAPABILITIES

const vppOnlyCaps: TargetCapabilities = { ...v4Caps, vppIo: true }

describe('buildAddressPool', () => {
  it('returns an empty pool when given no inputs', () => {
    const pool = buildAddressPool({}, v4Caps)
    expect(pool.byAddress.size).toBe(0)
    expect(pool.byPrefix.size).toBe(0)
    expect(pool.conflicts).toEqual([])
  })

  it('only counts producers whose capability is true', () => {
    // Runtime v4 (pinMapping=false) ignores pin entries even when the
    // project data contains them.
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%QX0.0', alias: 'door' }, { address: '%QX0.1' }] },
    }
    const pool = buildAddressPool(inputs, v4Caps)
    expect(pool.byAddress.size).toBe(0)
  })

  it('claims pin-mapping addresses on Arduino-style targets', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%QX0.0', alias: 'door' }, { address: '%IX0.3' }] },
    }
    const pool = buildAddressPool(inputs, arduinoCaps)
    expect(pool.byAddress.size).toBe(2)
    expect(pool.byAddress.get('%QX0.0')?.source.kind).toBe('pin-mapping')
    expect(pool.byAddress.get('%QX0.0')?.alias).toBe('door')
    // Empty name should not become an alias.
    expect(pool.byAddress.get('%IX0.3')?.alias).toBeUndefined()
  })

  it('claims VPP I/O entries when vppIo is on', () => {
    const inputs: PoolInputs = {
      vendorIoMapping: {
        entries: [
          { iecAddress: '%QX1.0', alias: 'valve_open', slot: 1, channelName: 'DO1', moduleName: 'SLM-X' },
          { iecAddress: '%IW3', slot: 4, channelName: 'AI1', moduleName: 'SLM-Y' },
        ],
      },
    }
    const pool = buildAddressPool(inputs, vppOnlyCaps)
    expect(pool.byAddress.size).toBe(2)
    expect(pool.byAddress.get('%QX1.0')?.alias).toBe('valve_open')
    expect(pool.byAddress.get('%QX1.0')?.source).toEqual({ kind: 'vpp-io', ref: 'slot-1:DO1' })
    expect(pool.byAddress.get('%IW3')?.alias).toBeUndefined()
  })

  it('claims Modbus TCP remote-device I/O points', () => {
    const inputs: PoolInputs = {
      remoteDevices: [
        {
          deviceName: 'tank',
          modbusTcpConfig: {
            ioGroups: [
              {
                ioPoints: [
                  { id: 'pt1', iecLocation: '%MW10', alias: 'tank_level' },
                  { id: 'pt2', iecLocation: '%MW11' },
                ],
              },
            ],
          },
        },
      ],
    }
    const pool = buildAddressPool(inputs, v4Caps)
    expect(pool.byAddress.size).toBe(2)
    expect(pool.byAddress.get('%MW10')?.alias).toBe('tank_level')
    expect(pool.byAddress.get('%MW10')?.source.kind).toBe('modbus-tcp-remote')
    expect(pool.byAddress.get('%MW10')?.source.ref).toBe('tank:pt1')
  })

  it('claims EtherCAT channel mappings', () => {
    const inputs: PoolInputs = {
      remoteDevices: [
        {
          deviceName: 'bus0',
          ethercatConfig: {
            devices: [
              {
                name: 'slv1',
                channelMappings: [
                  { channelId: 'c0', iecLocation: '%QX5.0', alias: 'motor' },
                  { channelId: 'c1', iecLocation: '%QX5.1' },
                ],
              },
            ],
          },
        },
      ],
    }
    const pool = buildAddressPool(inputs, v4Caps)
    expect(pool.byAddress.size).toBe(2)
    expect(pool.byAddress.get('%QX5.0')?.source).toEqual({ kind: 'ethercat', ref: 'bus0:slv1:c0' })
    expect(pool.byAddress.get('%QX5.0')?.alias).toBe('motor')
  })

  it('records a conflict when two sources claim the same address (first wins)', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%QX0.0', alias: 'pin' }] },
      vendorIoMapping: {
        entries: [{ iecAddress: '%QX0.0', alias: 'vpp_claim', slot: 1, channelName: 'DO1' }],
      },
    }
    const pool = buildAddressPool(inputs, { ...arduinoCaps, vppIo: true })
    expect(pool.byAddress.get('%QX0.0')?.source.kind).toBe('pin-mapping')
    expect(pool.conflicts).toHaveLength(1)
    expect(pool.conflicts[0].address).toBe('%QX0.0')
    expect(pool.conflicts[0].sources.map((s) => s.kind)).toEqual(['pin-mapping', 'vpp-io'])
  })

  it('captures every source involved in a multi-way conflict', () => {
    const inputs: PoolInputs = {
      vendorIoMapping: {
        entries: [{ iecAddress: '%MW5', slot: 1, channelName: 'AI1' }],
      },
      remoteDevices: [
        {
          deviceName: 'd1',
          modbusTcpConfig: { ioGroups: [{ ioPoints: [{ id: 'p1', iecLocation: '%MW5' }] }] },
          ethercatConfig: {
            devices: [{ name: 's', channelMappings: [{ channelId: 'c', iecLocation: '%MW5' }] }],
          },
        },
      ],
    }
    const pool = buildAddressPool(inputs, vppOnlyCaps)
    expect(pool.conflicts).toHaveLength(1)
    expect(pool.conflicts[0].sources.map((s) => s.kind)).toEqual(['vpp-io', 'modbus-tcp-remote', 'ethercat'])
  })

  it('ignoreSource excludes that source from the pool', () => {
    const inputs: PoolInputs = {
      vendorIoMapping: {
        entries: [{ iecAddress: '%QX1.0', slot: 1, channelName: 'DO1' }],
      },
      remoteDevices: [
        {
          deviceName: 'd',
          modbusTcpConfig: { ioGroups: [{ ioPoints: [{ id: 'p1', iecLocation: '%MW5' }] }] },
        },
      ],
    }
    const pool = buildAddressPool(inputs, vppOnlyCaps, { ignoreSource: 'vpp-io' })
    expect(pool.byAddress.has('%QX1.0')).toBe(false)
    expect(pool.byAddress.has('%MW5')).toBe(true)
  })

  it('indexes by prefix with claims sorted by numeric index', () => {
    const inputs: PoolInputs = {
      vendorIoMapping: {
        entries: [
          { iecAddress: '%IW10', slot: 1, channelName: 'A' },
          { iecAddress: '%IW2', slot: 2, channelName: 'B' },
          { iecAddress: '%IW5', slot: 3, channelName: 'C' },
        ],
      },
    }
    const pool = buildAddressPool(inputs, vppOnlyCaps)
    const iws = pool.byPrefix.get('%IW') ?? []
    expect(iws.map((c) => c.address)).toEqual(['%IW2', '%IW5', '%IW10'])
  })

  it('groups %IX and %QX into separate prefix lists', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%QX0.0' }, { address: '%IX0.0' }, { address: '%QX0.7' }] },
    }
    const pool = buildAddressPool(inputs, arduinoCaps)
    expect(pool.byPrefix.get('%QX')?.length).toBe(2)
    expect(pool.byPrefix.get('%IX')?.length).toBe(1)
  })
})

describe('nextFreeAddress', () => {
  const inputs: PoolInputs = {
    pinMapping: { pins: [{ address: '%QX0.0' }, { address: '%QX0.1' }, { address: '%QX0.3' }] },
  }
  const pool = buildAddressPool(inputs, arduinoCaps)

  it('skips claimed bit addresses and returns the first free slot', () => {
    expect(nextFreeAddress(pool, '%QX', true)).toBe('%QX0.2')
  })

  it('starts from the provided offset', () => {
    expect(nextFreeAddress(pool, '%QX', true, 4)).toBe('%QX0.4')
  })

  it('returns the prefix+0 when no claims exist for the prefix', () => {
    expect(nextFreeAddress(pool, '%IW', false)).toBe('%IW0')
  })

  it('respects alsoUsed for caller-tracked in-flight allocations', () => {
    const pending = new Set(['%QX0.2', '%QX0.4'])
    expect(nextFreeAddress(pool, '%QX', true, undefined, pending)).toBe('%QX0.5')
  })

  it('wraps across byte boundaries for bit addressing', () => {
    const allFirstByte = new Set<string>()
    for (let i = 0; i < 8; i++) allFirstByte.add(`%QX0.${i}`)
    // First byte fully covered by `allFirstByte`; pool's claims at
    // %QX0.* are now redundant. Next free is the start of the second byte.
    expect(nextFreeAddress(pool, '%QX', true, undefined, allFirstByte)).toBe('%QX1.0')
  })

  it('reclaims a gap left by a sparse claim set (byPrefix walk)', () => {
    // Claims at %IW0, %IW1, %IW3 (skipping 2) and %IW10 (big gap).
    // The gap-find should return %IW2, not extend past the highest
    // claim.
    const sparse = buildAddressPool(
      {
        vendorIoMapping: {
          entries: [
            { iecAddress: '%IW0', slot: 1, channelName: 'A' },
            { iecAddress: '%IW1', slot: 2, channelName: 'B' },
            { iecAddress: '%IW3', slot: 3, channelName: 'C' },
            { iecAddress: '%IW10', slot: 4, channelName: 'D' },
          ],
        },
      },
      vppOnlyCaps,
    )
    expect(nextFreeAddress(sparse, '%IW', false)).toBe('%IW2')
  })

  it('allocates %ID (double-word) addresses', () => {
    const dword = buildAddressPool(
      {
        vendorIoMapping: {
          entries: [
            { iecAddress: '%ID0', slot: 1, channelName: 'TC1' },
            { iecAddress: '%ID2', slot: 2, channelName: 'TC2' },
          ],
        },
      },
      vppOnlyCaps,
    )
    expect(nextFreeAddress(dword, '%ID', false)).toBe('%ID1')
    expect(nextFreeAddress(dword, '%ID', false, 3)).toBe('%ID3')
  })
})

describe('isAddressClaimed / listClaims', () => {
  it('isAddressClaimed returns true for claimed and false otherwise', () => {
    const pool = buildAddressPool({ pinMapping: { pins: [{ address: '%QX0.0' }] } }, arduinoCaps)
    expect(isAddressClaimed(pool, '%QX0.0')).toBe(true)
    expect(isAddressClaimed(pool, '%QX0.1')).toBe(false)
  })

  it('listClaims returns all claims in stable order', () => {
    const pool = buildAddressPool(
      {
        vendorIoMapping: {
          entries: [
            { iecAddress: '%IW5', slot: 1, channelName: 'A' },
            { iecAddress: '%IW1', slot: 2, channelName: 'B' },
            { iecAddress: '%QW3', slot: 3, channelName: 'C' },
          ],
        },
      },
      vppOnlyCaps,
    )
    const claims = listClaims(pool)
    // Within each prefix the order is by index. Order across prefixes
    // is insertion order (first time a claim with that prefix was
    // seen). The inputs introduce %IW first, then %QW.
    expect(claims.map((c) => c.address)).toEqual(['%IW1', '%IW5', '%QW3'])
  })
})

describe('target scoping releases claims when capabilities change', () => {
  // Same project data — different active targets produce different pools.
  const inputs: PoolInputs = {
    pinMapping: { pins: [{ address: '%QX0.0', alias: 'pin' }] },
    vendorIoMapping: {
      entries: [{ iecAddress: '%QX1.0', alias: 'vpp_thing', slot: 1, channelName: 'DO1' }],
    },
    remoteDevices: [
      {
        deviceName: 'd',
        modbusTcpConfig: { ioGroups: [{ ioPoints: [{ id: 'p1', iecLocation: '%MW5' }] }] },
      },
    ],
  }

  it('Arduino target: only pin-mapping claims', () => {
    const pool = buildAddressPool(inputs, arduinoCaps)
    expect(Array.from(pool.byAddress.keys()).sort()).toEqual(['%QX0.0'])
  })

  it('Runtime v4 plain: VPP off, modbus-remote on', () => {
    const pool = buildAddressPool(inputs, v4Caps)
    expect(Array.from(pool.byAddress.keys()).sort()).toEqual(['%MW5'])
  })

  it('VPP-enabled v4 target: VPP + modbus-remote', () => {
    const pool = buildAddressPool(inputs, vppOnlyCaps)
    expect(Array.from(pool.byAddress.keys()).sort()).toEqual(['%MW5', '%QX1.0'])
  })

  it('Simulator: modbus-remote + ethercat enabled (no-ops), no pins', () => {
    const pool = buildAddressPool(inputs, simCaps)
    // pinMapping is false on Simulator — pin claim is dropped.
    expect(Array.from(pool.byAddress.keys()).sort()).toEqual(['%MW5'])
  })
})
