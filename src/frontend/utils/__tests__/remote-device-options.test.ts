import type { IoMappingEntry } from '../../../middleware/shared/ports/types'
import type { RemoteDeviceIOPoint } from '../remote-device-options'
import { buildRemoteDeviceOptionGroups, buildVendorIoOptionGroups } from '../remote-device-options'

function makeIOPoint(overrides: Partial<RemoteDeviceIOPoint> = {}): RemoteDeviceIOPoint {
  return {
    deviceName: 'Device1',
    ioGroupName: 'Group1',
    ioPointId: 'pt-1',
    ioPointName: 'Point1',
    ioPointType: 'BOOL',
    iecLocation: '%IX0.0',
    alias: 'Alias1',
    ...overrides,
  }
}

describe('buildRemoteDeviceOptionGroups', () => {
  it('returns empty array when no IO points given', () => {
    expect(buildRemoteDeviceOptionGroups('cell-1', [])).toEqual([])
  })

  it('skips points without an alias', () => {
    const points = [makeIOPoint({ alias: undefined })]
    expect(buildRemoteDeviceOptionGroups('cell-1', points)).toEqual([])
  })

  it('builds a single group for one device', () => {
    const points = [
      makeIOPoint({ ioPointId: 'pt-1', iecLocation: '%IX0.0', alias: 'Sensor1' }),
      makeIOPoint({ ioPointId: 'pt-2', iecLocation: '%IX0.1', alias: 'Sensor2' }),
    ]
    const result = buildRemoteDeviceOptionGroups('cell-1', points)
    expect(result).toEqual([
      {
        label: 'Remote: Device1',
        options: [
          { id: 'cell-1-remote-pt-1', value: 'Sensor1', label: 'Sensor1 (%IX0.0)' },
          { id: 'cell-1-remote-pt-2', value: 'Sensor2', label: 'Sensor2 (%IX0.1)' },
        ],
      },
    ])
  })

  it('groups points by device name', () => {
    // Each address must be distinct — the production address pool
    // enforces one-claim-per-address, and the builder dedupes
    // defensively against legacy projects that drifted before that
    // enforcement landed.
    const points = [
      makeIOPoint({ deviceName: 'DevA', ioPointId: 'a1', iecLocation: '%IX0.0', alias: 'A1' }),
      makeIOPoint({ deviceName: 'DevB', ioPointId: 'b1', iecLocation: '%IX0.1', alias: 'B1' }),
      makeIOPoint({ deviceName: 'DevA', ioPointId: 'a2', iecLocation: '%IX0.2', alias: 'A2' }),
    ]
    const result = buildRemoteDeviceOptionGroups('c', points)
    expect(result).toHaveLength(2)
    expect(result[0].label).toBe('Remote: DevA')
    expect(result[0].options).toHaveLength(2)
    expect(result[1].label).toBe('Remote: DevB')
    expect(result[1].options).toHaveLength(1)
  })

  it('mixes aliased and non-aliased points, keeping only aliased', () => {
    const points = [
      makeIOPoint({ ioPointId: 'p1', iecLocation: '%IX0.0', alias: 'Yes' }),
      makeIOPoint({ ioPointId: 'p2', iecLocation: '%IX0.1', alias: undefined }),
      makeIOPoint({ ioPointId: 'p3', iecLocation: '%IX0.2', alias: 'Also' }),
    ]
    const result = buildRemoteDeviceOptionGroups('x', points)
    expect(result).toHaveLength(1)
    expect(result[0].options).toHaveLength(2)
  })

  it('dedupes by IEC address (defensive against legacy projects with duplicate-address entries)', () => {
    // Production never produces this state (the address pool enforces
    // uniqueness at write time), but legacy projects may have drifted
    // into it before the gate existed.  First-iterated wins, matching
    // the pool's reservation order.
    const points = [
      makeIOPoint({ ioPointId: 'first', iecLocation: '%IX0.0', alias: 'A_first' }),
      makeIOPoint({ ioPointId: 'second', iecLocation: '%IX0.0', alias: 'A_second' }),
      makeIOPoint({ ioPointId: 'third', iecLocation: '%IX0.1', alias: 'B_unique' }),
    ]
    const result = buildRemoteDeviceOptionGroups('x', points)
    expect(result).toHaveLength(1)
    expect(result[0].options).toHaveLength(2)
    expect(result[0].options[0].label).toBe('A_first (%IX0.0)')
    expect(result[0].options[1].label).toBe('B_unique (%IX0.1)')
  })

  it('uses cellId in option IDs', () => {
    const points = [makeIOPoint({ ioPointId: 'pt-7' })]
    const result = buildRemoteDeviceOptionGroups('my-cell', points)
    expect(result[0].options[0].id).toBe('my-cell-remote-pt-7')
  })
})

function makeVendorEntry(overrides: Partial<IoMappingEntry> = {}): IoMappingEntry {
  return {
    slot: 1,
    moduleId: 'mod-a',
    moduleName: 'Relay Module',
    channelName: 'DO1',
    channelType: 'coil',
    dataType: 'BOOL',
    iecAddress: '%QX0.0',
    alias: 'relay_1',
    ...overrides,
  }
}

describe('buildVendorIoOptionGroups', () => {
  it('binds each option by alias name and labels it with the address for context', () => {
    const result = buildVendorIoOptionGroups('cell-1', [makeVendorEntry()])
    expect(result).toEqual([
      {
        label: 'Slot 1: Relay Module',
        options: [{ id: 'cell-1-vendor-1-DO1', value: 'relay_1', label: 'relay_1 (%QX0.0)' }],
      },
    ])
  })

  it('skips entries without an alias (only aliased vendor channels are bindable)', () => {
    const entries = [
      makeVendorEntry({ channelName: 'DO1', alias: '' }),
      makeVendorEntry({ channelName: 'DO2', alias: 'relay_2', iecAddress: '%QX0.1' }),
    ]
    const result = buildVendorIoOptionGroups('cell-1', entries)
    expect(result).toHaveLength(1)
    expect(result[0].options).toEqual([{ id: 'cell-1-vendor-1-DO2', value: 'relay_2', label: 'relay_2 (%QX0.1)' }])
  })

  it('dedupes by IEC address (defensive against drifted projects with duplicate addresses)', () => {
    const entries = [
      makeVendorEntry({ channelName: 'DO1', alias: 'first', iecAddress: '%QX0.0' }),
      makeVendorEntry({ channelName: 'DO2', alias: 'second', iecAddress: '%QX0.0' }), // same address — dropped
    ]
    const result = buildVendorIoOptionGroups('cell-1', entries)
    expect(result[0].options).toHaveLength(1)
    expect(result[0].options[0].value).toBe('first') // first-iterated wins
  })
})
