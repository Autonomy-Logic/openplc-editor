/**
 * DOPE-704 E4 address-pool tests.
 *
 * The modular coupler data model carries channel mappings per module. The address pool
 * must claim module channels under a four-segment ethercat ref so a module channel and a
 * plain slave channel on the same bus never collide, and the orphaned-alias rules work
 * on module aliases exactly as they do on plain-slave aliases.
 */

import { buildAddressPool, type AddressPool, type PoolInputs } from '../address-pool'

type Caps = Parameters<typeof buildAddressPool>[1]
type DeviceInput = NonNullable<NonNullable<PoolInputs['remoteDevices']>[number]['ethercatConfig']>['devices']
type ModuleInput = NonNullable<NonNullable<DeviceInput>[number]['modules']>[number]

const caps: Caps = {
  pinMapping: true,
  vppIo: true,
  modbusTcpRemote: true,
  ethercat: true,
}

const makeModule = (
  id: string,
  slot: number,
  mappings: Array<{ channelId: string; iecLocation: string; alias?: string }>,
): ModuleInput => ({ id, slot, channelMappings: mappings })

const bus = (slaves: DeviceInput) => [
  { name: 'bus_a', protocol: 'ethercat' as const, ethercatConfig: { devices: slaves } },
]

const sourceRef = (pool: AddressPool, address: string): string | undefined => pool.byAddress.get(address)?.source.ref

describe('DOPE-704 E4: address pool walks module channel mappings', () => {
  test('a plain slave channel claims the three-segment ref', () => {
    const pool = buildAddressPool(
      { remoteDevices: bus([{ name: 'coupler', channelMappings: [{ channelId: 'ch1', iecLocation: '%IX0.0' }] }]) },
      caps,
    )
    expect(sourceRef(pool, '%IX0.0')).toBe('bus_a:coupler:ch1')
    expect(pool.byAddress.get('%IX0.0')?.source.kind).toBe('ethercat')
  })

  test('a module channel claims the four-segment ref under the same bus and slave', () => {
    const pool = buildAddressPool(
      {
        remoteDevices: bus([
          {
            name: 'coupler',
            channelMappings: [{ channelId: 'ch1', iecLocation: '%IX0.0' }],
            modules: [makeModule('slot-1', 1, [{ channelId: 'ch1', iecLocation: '%IX1.0' }])],
          },
        ]),
      },
      caps,
    )
    expect(sourceRef(pool, '%IX0.0')).toBe('bus_a:coupler:ch1')
    expect(sourceRef(pool, '%IX1.0')).toBe('bus_a:coupler:slot-1:ch1')
    expect(pool.byAddress.get('%IX1.0')?.source.kind).toBe('ethercat')
  })

  test('module aliases land on the claim', () => {
    const pool = buildAddressPool(
      {
        remoteDevices: bus([
          {
            name: 'coupler',
            modules: [makeModule('slot-2', 2, [{ channelId: 'ch1', iecLocation: '%IW4', alias: 'TemperatureC' }])],
          },
        ]),
      },
      caps,
    )
    const claim = pool.byAddress.get('%IW4')
    expect(claim?.alias).toBe('TemperatureC')
    expect(claim?.source.ref).toBe('bus_a:coupler:slot-2:ch1')
  })

  test('a module channel colliding with a plain slave channel is reported as a conflict', () => {
    const pool = buildAddressPool(
      {
        remoteDevices: bus([
          {
            name: 'coupler',
            channelMappings: [{ channelId: 'ch1', iecLocation: '%IX0.0' }],
            modules: [makeModule('slot-1', 1, [{ channelId: 'ch1', iecLocation: '%IX0.0' }])],
          },
        ]),
      },
      caps,
    )
    const conflict = pool.conflicts.find((c) => c.address === '%IX0.0')
    expect(conflict).toBeDefined()
    expect(conflict?.sources.length).toBe(2)
    // The second claimer loses; the first wins. The ref format tells them apart.
    expect(conflict?.sources.map((s) => s.ref).sort()).toEqual(['bus_a:coupler:ch1', 'bus_a:coupler:slot-1:ch1'])
  })

  test('ignoreSource=ethercat drops both coupler and module ethercat claims', () => {
    const pool = buildAddressPool(
      {
        remoteDevices: bus([
          {
            name: 'coupler',
            channelMappings: [{ channelId: 'ch1', iecLocation: '%IX0.0' }],
            modules: [makeModule('slot-1', 1, [{ channelId: 'ch1', iecLocation: '%IX1.0' }])],
          },
        ]),
      },
      caps,
      { ignoreSource: 'ethercat' },
    )
    expect(pool.byAddress.has('%IX0.0')).toBe(false)
    expect(pool.byAddress.has('%IX1.0')).toBe(false)
  })

  test('a module with no id falls back to a slot-based ref', () => {
    const pool = buildAddressPool(
      {
        remoteDevices: bus([
          {
            name: 'coupler',
            modules: [{ slot: 3, channelMappings: [{ channelId: 'ch1', iecLocation: '%QX0.0' }] }],
          },
        ]),
      },
      caps,
    )
    expect(sourceRef(pool, '%QX0.0')).toBe('bus_a:coupler:slot-3:ch1')
  })
})
