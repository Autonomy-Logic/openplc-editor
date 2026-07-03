import type { PoolInputs } from '../../address-pool'
import { channelKey } from '../allocate'
import { migrateToRegistry, recalculateFromLegacy, unpinAllocatableChannels } from '../migrate'
import { recalculate } from '../registry'
import { buildAliasIndex } from '../resolve'

describe('migrateToRegistry', () => {
  it('reproduces legacy addresses exactly across all producers', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%IX0.0', alias: 'button' }, { address: '%QX0.1' }] },
      vendorIoMapping: {
        entries: [
          { slot: 2, channelName: 'O1', iecAddress: '%QW3', alias: 'valve' },
          { slot: 1, channelName: 'I1', iecAddress: '%IW0' },
        ],
      },
      remoteDevices: [
        {
          name: 'plc1',
          modbusTcpConfig: {
            ioGroups: [{ id: 'g1', ioPoints: [{ id: 'p0', iecLocation: '%IW5', alias: 'temp' }] }],
          },
          ethercatConfig: {
            devices: [{ name: 's1', channelMappings: [{ channelId: 'c0', iecLocation: '%QW9' }] }],
          },
        },
      ],
    }

    const reg = migrateToRegistry(inputs)

    expect(reg.assignments[channelKey('pin-mapping', '%IX0.0')]).toBe('%IX0.0')
    expect(reg.assignments[channelKey('pin-mapping', '%QX0.1')]).toBe('%QX0.1')
    expect(reg.assignments[channelKey('vpp-slot-1', 'I1')]).toBe('%IW0')
    expect(reg.assignments[channelKey('vpp-slot-2', 'O1')]).toBe('%QW3')
    expect(reg.assignments[channelKey('modbus:plc1:g1', 'p0')]).toBe('%IW5')
    expect(reg.assignments[channelKey('ethercat:plc1:s1', 'c0')]).toBe('%QW9')

    // Aliases carried over and resolve to their legacy addresses.
    const aliases = buildAliasIndex(reg)
    expect(aliases.get('button')).toBe('%IX0.0')
    expect(aliases.get('valve')).toBe('%QW3')
    expect(aliases.get('temp')).toBe('%IW5')
  })

  it('skips unparseable / missing addresses and empty groups', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '' }, { address: 'NOPE' }, { address: '%IX0.0' }] },
      remoteDevices: [
        { name: 'd', modbusTcpConfig: { ioGroups: [{ id: 'empty', ioPoints: [] }] } },
        { deviceName: 'd2', ethercatConfig: { devices: [{ channelMappings: [] }] } },
      ],
    }
    const reg = migrateToRegistry(inputs)
    // Only the valid pin survives; empty modbus/ethercat produce no consumer.
    expect(reg.consumers).toHaveLength(1)
    expect(reg.consumers[0].id).toBe('pin-mapping')
  })

  it('handles a fully empty project', () => {
    expect(migrateToRegistry({}).consumers).toEqual([])
  })

  it('skips a bad VPP entry and producers with no channel list', () => {
    const inputs: PoolInputs = {
      vendorIoMapping: { entries: [{ slot: 1, channelName: 'bad', iecAddress: 'NOPE' }] },
      remoteDevices: [
        { name: 'd', modbusTcpConfig: { ioGroups: [{ id: 'g' }] } }, // ioPoints undefined
        { name: 'e', ethercatConfig: { devices: [{ name: 's' }] } }, // channelMappings undefined
      ],
    }
    expect(migrateToRegistry(inputs).consumers).toEqual([])
  })

  it('falls back to a group index when the group has no id', () => {
    const inputs: PoolInputs = {
      remoteDevices: [{ name: 'd', modbusTcpConfig: { ioGroups: [{ ioPoints: [{ id: 'p', iecLocation: '%IW0' }] }] } }],
    }
    const reg = migrateToRegistry(inputs)
    expect(reg.consumers[0].id).toBe('modbus:d:0')
  })

  it('groups multiple VPP channels under one slot consumer', () => {
    const inputs: PoolInputs = {
      vendorIoMapping: {
        entries: [
          { slot: 1, channelName: 'I1', iecAddress: '%IW0' },
          { slot: 1, channelName: 'I2', iecAddress: '%IW1' },
        ],
      },
    }
    const reg = migrateToRegistry(inputs)
    expect(reg.consumers).toHaveLength(1)
    expect(reg.consumers[0].channels.map((c) => c.channelId)).toEqual(['I1', 'I2'])
  })

  it('prefers deviceName, falls back to name then a generic label', () => {
    const inputs: PoolInputs = {
      remoteDevices: [
        {
          deviceName: 'byDeviceName',
          modbusTcpConfig: { ioGroups: [{ id: 'g', ioPoints: [{ id: 'p', iecLocation: '%IW0' }] }] },
        },
        { ethercatConfig: { devices: [{ name: 'sl', channelMappings: [{ channelId: 'c', iecLocation: '%QW0' }] }] } },
      ],
    }
    const reg = migrateToRegistry(inputs)
    expect(reg.consumers.some((c) => c.id === 'modbus:byDeviceName:g')).toBe(true)
    // No name/deviceName on the ethercat device → generic 'device'.
    expect(reg.consumers.some((c) => c.id === 'ethercat:device:sl')).toBe(true)
  })

  it('skips unparseable modbus points and ethercat mappings', () => {
    const inputs: PoolInputs = {
      remoteDevices: [
        {
          name: 'd',
          modbusTcpConfig: {
            ioGroups: [
              {
                id: 'g',
                ioPoints: [
                  { id: 'bad', iecLocation: 'NOPE' },
                  { id: 'ok', iecLocation: '%IW0' },
                ],
              },
            ],
          },
          ethercatConfig: {
            devices: [{ name: 's', channelMappings: [{ channelId: 'bad', iecLocation: 'NOPE' }] }],
          },
        },
      ],
    }
    const reg = migrateToRegistry(inputs)
    const modbus = reg.consumers.find((c) => c.kind === 'modbus-tcp-remote')!
    expect(modbus.channels.map((c) => c.channelId)).toEqual(['ok'])
    // The ethercat slave had only an unparseable mapping → no consumer.
    expect(reg.consumers.some((c) => c.kind === 'ethercat')).toBe(false)
  })
})

describe('recalculateFromLegacy', () => {
  it('recompacts a gap left by a removed group and keeps aliases following', () => {
    // Two modbus groups; the first (%IW0/%IW1) has been removed, leaving the
    // survivor at %IW2/%IW3 in the legacy data — a gap.
    const inputs: PoolInputs = {
      remoteDevices: [
        {
          name: 'd',
          modbusTcpConfig: {
            ioGroups: [
              {
                id: 'g2',
                ioPoints: [
                  { id: 'p0', iecLocation: '%IW2', alias: 'temp' },
                  { id: 'p1', iecLocation: '%IW3' },
                ],
              },
            ],
          },
        },
      ],
    }
    const { registry } = recalculateFromLegacy(inputs)
    // The survivor slides down to %IW0/%IW1 — gap reclaimed.
    expect(registry.assignments[channelKey('modbus:d:g2', 'p0')]).toBe('%IW0')
    expect(registry.assignments[channelKey('modbus:d:g2', 'p1')]).toBe('%IW1')
    // The alias follows its channel to the new address.
    expect(buildAliasIndex(registry).get('temp')).toBe('%IW0')
  })

  it('keeps hardware pins fixed while allocatable producers compact', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%IX0.2', alias: 'btn' }] },
      remoteDevices: [
        { name: 'd', modbusTcpConfig: { ioGroups: [{ id: 'g', ioPoints: [{ id: 'p', iecLocation: '%IX0.5' }] }] } },
      ],
    }
    const { registry } = recalculateFromLegacy(inputs)
    expect(registry.assignments[channelKey('pin-mapping', '%IX0.2')]).toBe('%IX0.2') // pinned stays
    expect(registry.assignments[channelKey('modbus:d:g', 'p')]).toBe('%IX0.0') // compacts to lowest free
  })

  it('excludes inactive-kind producers under capability scoping', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%QW0' }] },
      remoteDevices: [
        { name: 'd', modbusTcpConfig: { ioGroups: [{ id: 'g', ioPoints: [{ id: 'p', iecLocation: '%QW5' }] }] } },
      ],
    }
    // Target without pin mapping: pins drop out, modbus compacts to %QW0.
    const { registry } = recalculateFromLegacy(inputs, { activeKinds: new Set(['modbus-tcp-remote']) })
    expect(registry.assignments[channelKey('pin-mapping', '%QW0')]).toBeUndefined()
    expect(registry.assignments[channelKey('modbus:d:g', 'p')]).toBe('%QW0')
  })
})

describe('unpinAllocatableChannels', () => {
  it('clears pinned on everything except hardware pins', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%IX0.0' }] },
      remoteDevices: [
        { name: 'd', modbusTcpConfig: { ioGroups: [{ id: 'g', ioPoints: [{ id: 'p', iecLocation: '%IW0' }] }] } },
      ],
    }
    const unpinned = unpinAllocatableChannels(migrateToRegistry(inputs))

    const pins = unpinned.consumers.find((c) => c.kind === 'pin-mapping')!
    const modbus = unpinned.consumers.find((c) => c.kind === 'modbus-tcp-remote')!
    expect(pins.channels[0].pinned).toBe('%IX0.0') // hardware pin stays pinned
    expect(modbus.channels[0].pinned).toBeUndefined() // freed for compaction
  })

  it('unpins only the requested kinds, keeping others as fixed constraints', () => {
    const inputs: PoolInputs = {
      pinMapping: { pins: [{ address: '%QW0' }] },
      vendorIoMapping: { entries: [{ slot: 1, channelName: 'a', iecAddress: '%QW1' }] },
      remoteDevices: [
        { name: 'd', modbusTcpConfig: { ioGroups: [{ id: 'g', ioPoints: [{ id: 'p', iecLocation: '%QW5' }] }] } },
      ],
    }
    // Reallocate ONLY modbus; pins (%QW0) and VPP (%QW1) stay pinned, so the
    // modbus point compacts to the next free slot after them: %QW2.
    const reg = recalculate(
      unpinAllocatableChannels(migrateToRegistry(inputs), new Set(['modbus-tcp-remote'])),
    ).registry
    expect(reg.assignments[channelKey('pin-mapping', '%QW0')]).toBe('%QW0')
    expect(reg.assignments[channelKey('vpp-slot-1', 'a')]).toBe('%QW1')
    expect(reg.assignments[channelKey('modbus:d:g', 'p')]).toBe('%QW2')
  })

  it('leaves already-unpinned channels untouched', () => {
    const reg = {
      consumers: [
        {
          id: 'x',
          kind: 'vpp-io',
          order: 0,
          channels: [{ channelId: 'a', class: { direction: 'Q', size: 'W' } as const }],
        },
      ],
      assignments: {},
    }
    expect(unpinAllocatableChannels(reg)).toEqual(reg)
  })
})
