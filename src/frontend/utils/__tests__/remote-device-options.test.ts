import type { RemoteDeviceIOPoint } from '../remote-device-options'
import { buildRemoteDeviceOptionGroups } from '../remote-device-options'

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
          { id: 'cell-1-remote-pt-1', value: '%IX0.0', label: '%IX0.0 (Sensor1)' },
          { id: 'cell-1-remote-pt-2', value: '%IX0.1', label: '%IX0.1 (Sensor2)' },
        ],
      },
    ])
  })

  it('groups points by device name', () => {
    const points = [
      makeIOPoint({ deviceName: 'DevA', ioPointId: 'a1', alias: 'A1' }),
      makeIOPoint({ deviceName: 'DevB', ioPointId: 'b1', alias: 'B1' }),
      makeIOPoint({ deviceName: 'DevA', ioPointId: 'a2', alias: 'A2' }),
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
      makeIOPoint({ ioPointId: 'p1', alias: 'Yes' }),
      makeIOPoint({ ioPointId: 'p2', alias: undefined }),
      makeIOPoint({ ioPointId: 'p3', alias: 'Also' }),
    ]
    const result = buildRemoteDeviceOptionGroups('x', points)
    expect(result).toHaveLength(1)
    expect(result[0].options).toHaveLength(2)
  })

  it('uses cellId in option IDs', () => {
    const points = [makeIOPoint({ ioPointId: 'pt-7' })]
    const result = buildRemoteDeviceOptionGroups('my-cell', points)
    expect(result[0].options[0].id).toBe('my-cell-remote-pt-7')
  })
})
