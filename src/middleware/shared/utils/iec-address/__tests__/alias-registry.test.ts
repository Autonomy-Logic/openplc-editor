import { ARDUINO_CLI_CAPABILITIES, RUNTIME_V4_CAPABILITIES } from '../../target-capabilities'
import { buildAddressPool } from '../address-pool'
import { aliasForAddress, buildAliasRegistry, isAliasNameAvailable, resolveAlias } from '../alias-registry'

const v4 = RUNTIME_V4_CAPABILITIES
const arduino = ARDUINO_CLI_CAPABILITIES
const v4WithVpp = { ...v4, vppIo: true }

describe('buildAliasRegistry', () => {
  it('returns empty maps when the pool has no aliased claims', () => {
    const pool = buildAddressPool(
      {
        remoteDevices: [
          { name: 'd', modbusTcpConfig: { ioGroups: [{ ioPoints: [{ id: 'p', iecLocation: '%MW1' }] }] } },
        ],
      },
      v4,
    )
    const reg = buildAliasRegistry(pool)
    expect(reg.byAlias.size).toBe(0)
    expect(reg.byAddress.size).toBe(0)
    expect(reg.duplicateAliases).toEqual([])
  })

  it('indexes every aliased claim by both alias and address', () => {
    const pool = buildAddressPool(
      {
        vendorIoMapping: {
          entries: [
            { iecAddress: '%QX0.5', alias: 'conveyor_motor', slot: 1, channelName: 'DO1' },
            { iecAddress: '%IW2', alias: 'tank_level', slot: 2, channelName: 'AI1' },
            // No alias — should not appear in the registry.
            { iecAddress: '%QW3', slot: 3, channelName: 'AO1' },
          ],
        },
      },
      v4WithVpp,
    )
    const reg = buildAliasRegistry(pool)
    expect(reg.byAlias.size).toBe(2)
    expect(reg.byAddress.size).toBe(2)
    expect(reg.byAlias.get('conveyor_motor')?.address).toBe('%QX0.5')
    expect(reg.byAddress.get('%IW2')?.alias).toBe('tank_level')
    expect(reg.byAddress.has('%QW3')).toBe(false)
  })

  it('records duplicate alias names; first encounter wins in byAlias', () => {
    // Two different addresses both labelled "valve" — one from pin
    // mapping, one from a Modbus remote device.
    const pool = buildAddressPool(
      {
        pinMapping: { pins: [{ address: '%QX0.0', alias: 'valve' }] },
        remoteDevices: [
          {
            name: 'd',
            modbusTcpConfig: {
              ioGroups: [{ ioPoints: [{ id: 'p', iecLocation: '%MW1', alias: 'valve' }] }],
            },
          },
        ],
      },
      { ...arduino, modbusTcpRemote: true },
    )
    const reg = buildAliasRegistry(pool)
    // Pool's reservation pass runs pin-mapping first; that's who wins.
    expect(reg.byAlias.get('valve')?.address).toBe('%QX0.0')
    // Both addresses are still indexed under byAddress (both have aliases attached).
    expect(reg.byAddress.get('%QX0.0')?.alias).toBe('valve')
    expect(reg.byAddress.get('%MW1')?.alias).toBe('valve')
    expect(reg.duplicateAliases).toEqual(['valve'])
  })

  it('records each duplicate alias once even when three producers collide', () => {
    const pool = buildAddressPool(
      {
        vendorIoMapping: {
          entries: [{ iecAddress: '%IW0', alias: 'shared', slot: 1, channelName: 'AI1' }],
        },
        remoteDevices: [
          {
            name: 'd1',
            modbusTcpConfig: {
              ioGroups: [{ ioPoints: [{ id: 'p', iecLocation: '%MW2', alias: 'shared' }] }],
            },
            ethercatConfig: {
              devices: [
                {
                  name: 's',
                  channelMappings: [{ channelId: 'c', iecLocation: '%MW3', alias: 'shared' }],
                },
              ],
            },
          },
        ],
      },
      v4WithVpp,
    )
    const reg = buildAliasRegistry(pool)
    expect(reg.duplicateAliases).toEqual(['shared'])
    expect(reg.byAlias.get('shared')?.source.kind).toBe('vpp-io')
  })

  it('respects target scoping: aliases on inactive producers do not appear', () => {
    // Same project data — Arduino-target view skips VPP and Modbus
    // remote aliases.
    const inputs = {
      vendorIoMapping: {
        entries: [{ iecAddress: '%IW0', alias: 'vpp_alias', slot: 1, channelName: 'AI1' }],
      },
      pinMapping: { pins: [{ address: '%QX0.0', alias: 'pin_alias' }] },
    }
    const arduinoPool = buildAddressPool(inputs, arduino)
    const v4Pool = buildAddressPool(inputs, v4WithVpp)
    expect(buildAliasRegistry(arduinoPool).byAlias.size).toBe(1)
    expect(buildAliasRegistry(arduinoPool).byAlias.has('pin_alias')).toBe(true)
    expect(buildAliasRegistry(v4Pool).byAlias.size).toBe(1)
    expect(buildAliasRegistry(v4Pool).byAlias.has('vpp_alias')).toBe(true)
  })
})

describe('resolveAlias', () => {
  const pool = buildAddressPool(
    {
      vendorIoMapping: {
        entries: [{ iecAddress: '%QX1.0', alias: 'conveyor_motor', slot: 1, channelName: 'DO1' }],
      },
    },
    v4WithVpp,
  )
  const reg = buildAliasRegistry(pool)

  it('returns the current address for a known alias', () => {
    expect(resolveAlias(reg, 'conveyor_motor')).toBe('%QX1.0')
  })

  it('returns undefined for an unknown alias (variable would be orphaned)', () => {
    expect(resolveAlias(reg, 'missing_alias')).toBeUndefined()
  })
})

describe('aliasForAddress', () => {
  const pool = buildAddressPool(
    {
      vendorIoMapping: {
        entries: [
          { iecAddress: '%IW0', alias: 'pressure', slot: 1, channelName: 'AI1' },
          { iecAddress: '%IW1', slot: 1, channelName: 'AI2' },
        ],
      },
    },
    v4WithVpp,
  )
  const reg = buildAliasRegistry(pool)

  it('returns the alias for an address that has one (auto-adopt path)', () => {
    expect(aliasForAddress(reg, '%IW0')).toBe('pressure')
  })

  it('returns undefined for an address with no alias attached', () => {
    expect(aliasForAddress(reg, '%IW1')).toBeUndefined()
  })

  it('returns undefined for an address no producer has claimed', () => {
    expect(aliasForAddress(reg, '%IW9')).toBeUndefined()
  })
})

describe('isAliasNameAvailable', () => {
  const pool = buildAddressPool(
    {
      vendorIoMapping: {
        entries: [{ iecAddress: '%IW0', alias: 'tank', slot: 1, channelName: 'AI1' }],
      },
    },
    v4WithVpp,
  )
  const reg = buildAliasRegistry(pool)

  it('returns true for an unused alias name', () => {
    expect(isAliasNameAvailable(reg, 'brand_new')).toBe(true)
  })

  it('returns false for an alias already declared by some producer', () => {
    expect(isAliasNameAvailable(reg, 'tank')).toBe(false)
  })

  it('returns true when the existing entry belongs to the source we are ignoring (rename within self)', () => {
    expect(isAliasNameAvailable(reg, 'tank', { kind: 'vpp-io', ref: 'slot-1:AI1' })).toBe(true)
  })

  it('returns false when ignoring a different source', () => {
    expect(isAliasNameAvailable(reg, 'tank', { kind: 'modbus-tcp-remote', ref: 'd:p' })).toBe(false)
  })
})
