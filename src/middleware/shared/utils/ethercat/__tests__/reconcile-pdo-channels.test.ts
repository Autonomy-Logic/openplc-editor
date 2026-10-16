import type {
  EtherCATChannelMapping,
  PersistedChannelInfo,
  PersistedPdo,
  PersistedPdoEntry,
} from '@root/middleware/shared/ports/esi-types'
import { reconcilePdoChannels } from '@root/middleware/shared/utils/ethercat'

const entry = (
  patch: Partial<PersistedPdoEntry> & Pick<PersistedPdoEntry, 'index' | 'subIndex'>,
): PersistedPdoEntry => ({
  bitLen: 16,
  name: 'StatusWord',
  dataType: 'UINT',
  ...patch,
})

const pdo = (index: string, entries: PersistedPdoEntry[], extra: Partial<PersistedPdo> = {}): PersistedPdo => ({
  index,
  name: 'PDO',
  assigned: true,
  entries,
  ...extra,
})

const info = (
  patch: Partial<PersistedChannelInfo> & Pick<PersistedChannelInfo, 'channelId'>,
): PersistedChannelInfo => ({
  name: 'StatusWord',
  direction: 'input',
  pdoIndex: '0x1A00',
  entryIndex: '0x6041',
  entrySubIndex: '0x00',
  dataType: 'UINT',
  bitLen: 16,
  iecType: 'UINT',
  ...patch,
})

const mapping = (channelId: string, iecLocation: string, alias = ''): EtherCATChannelMapping => ({
  channelId,
  iecLocation,
  alias,
})

describe('reconcilePdoChannels', () => {
  test('keeps mapping + alias when an untouched PDO has the same entries', () => {
    const txPdos = [pdo('0x1A00', [entry({ index: '0x6041', subIndex: '0x00' })])]
    const previousChannelInfo = [info({ channelId: '0x1A00-0x6041-0x00' })]
    const previousMappings = [mapping('0x1A00-0x6041-0x00', '%IW0', 'StatusWord_1')]

    const result = reconcilePdoChannels({
      txPdos,
      previousChannelInfo,
      previousMappings,
    })

    expect(result.channelInfo).toHaveLength(1)
    expect(result.channelMappings).toEqual([mapping('0x1A00-0x6041-0x00', '%IW0', 'StatusWord_1')])
  })

  test('allocates a fresh non-colliding IEC location for a newly added entry', () => {
    const txPdos = [
      pdo('0x1A00', [
        entry({ index: '0x6041', subIndex: '0x00' }),
        entry({ index: '0x606C', subIndex: '0x00', bitLen: 32, dataType: 'DINT', name: 'ActualVelocity' }),
      ]),
    ]
    const previousChannelInfo = [info({ channelId: '0x1A00-0x6041-0x00' })]
    const previousMappings = [mapping('0x1A00-0x6041-0x00', '%IW0', 'StatusWord_1')]

    const result = reconcilePdoChannels({
      txPdos,
      previousChannelInfo,
      previousMappings,
    })

    expect(result.channelInfo).toHaveLength(2)
    const velocity = result.channelMappings.find((m) => m.channelId === '0x1A00-0x606C-0x00')
    expect(velocity).toBeDefined()
    expect(velocity?.iecLocation).toBe('%ID4')
    expect(velocity?.alias).toBe('')
    const status = result.channelMappings.find((m) => m.channelId === '0x1A00-0x6041-0x00')
    expect(status?.iecLocation).toBe('%IW0')
    expect(status?.alias).toBe('StatusWord_1')
  })

  test('drops channelInfo + mapping of a removed entry', () => {
    const txPdos = [pdo('0x1A00', [entry({ index: '0x6041', subIndex: '0x00' })])]
    const previousChannelInfo = [
      info({ channelId: '0x1A00-0x6041-0x00' }),
      info({ channelId: '0x1A00-0x606C-0x00', entryIndex: '0x606C', dataType: 'DINT', iecType: 'DINT', bitLen: 32 }),
    ]
    const previousMappings = [
      mapping('0x1A00-0x6041-0x00', '%IW0', 'StatusWord_1'),
      mapping('0x1A00-0x606C-0x00', '%ID4', 'Velocity_1'),
    ]

    const result = reconcilePdoChannels({ txPdos, previousChannelInfo, previousMappings })

    expect(result.channelInfo.map((c) => c.channelId)).toEqual(['0x1A00-0x6041-0x00'])
    expect(result.channelMappings).toEqual([mapping('0x1A00-0x6041-0x00', '%IW0', 'StatusWord_1')])
  })

  test('reallocates the mapping of a retyped entry (BOOL → DWORD)', () => {
    const txPdos = [
      pdo('0x1A00', [entry({ index: '0x6041', subIndex: '0x00', bitLen: 32, dataType: 'UDINT', name: 'Big' })]),
    ]
    const previousChannelInfo = [
      info({ channelId: '0x1A00-0x6041-0x00', bitLen: 1, dataType: 'BOOL', iecType: 'BOOL' }),
    ]
    const previousMappings = [mapping('0x1A00-0x6041-0x00', '%IX0.0', 'Flag_1')]

    const result = reconcilePdoChannels({ txPdos, previousChannelInfo, previousMappings })

    const row = result.channelMappings.find((m) => m.channelId === '0x1A00-0x6041-0x00')
    expect(row?.iecLocation).toBe('%ID0')
    expect(row?.alias).toBe('')
  })

  test('skips padding entries', () => {
    const txPdos = [
      pdo('0x1A00', [
        entry({ index: '0x6041', subIndex: '0x00' }),
        { index: '0x0000', subIndex: '0x00', bitLen: 16, name: 'Padding', dataType: 'BIT16' },
        entry({ index: '0x6064', subIndex: '0x00', bitLen: 32, dataType: 'DINT', name: 'Pos' }),
      ]),
    ]
    const result = reconcilePdoChannels({ txPdos, previousMappings: [] })

    expect(result.channelInfo.map((c) => c.channelId)).toEqual(['0x1A00-0x6041-0x00', '0x1A00-0x6064-0x00'])
  })

  test('avoids addresses claimed outside the slave (externalUsedAddresses)', () => {
    const txPdos = [pdo('0x1A00', [entry({ index: '0x6041', subIndex: '0x00' })])]
    const result = reconcilePdoChannels({
      txPdos,
      previousMappings: [],
      externalUsedAddresses: ['%IW0'],
    })
    const row = result.channelMappings[0]
    expect(row?.iecLocation).toBe('%IW2')
  })

  test('rebuilds mapping order to follow channelInfo order', () => {
    const txPdos = [
      pdo('0x1A00', [
        entry({ index: '0x6041', subIndex: '0x00' }),
        entry({ index: '0x6064', subIndex: '0x00', bitLen: 32, dataType: 'DINT', name: 'Pos' }),
      ]),
    ]
    const previousChannelInfo = [
      info({ channelId: '0x1A00-0x6064-0x00', entryIndex: '0x6064', dataType: 'DINT', iecType: 'DINT', bitLen: 32 }),
      info({ channelId: '0x1A00-0x6041-0x00' }),
    ]
    const previousMappings = [
      mapping('0x1A00-0x6064-0x00', '%ID4', 'Pos_1'),
      mapping('0x1A00-0x6041-0x00', '%IW0', 'Status_1'),
    ]

    const result = reconcilePdoChannels({ txPdos, previousChannelInfo, previousMappings })

    expect(result.channelInfo.map((c) => c.channelId)).toEqual(['0x1A00-0x6041-0x00', '0x1A00-0x6064-0x00'])
    expect(result.channelMappings.map((m) => m.channelId)).toEqual(['0x1A00-0x6041-0x00', '0x1A00-0x6064-0x00'])
  })

  test('rxPdos are treated as outputs and txPdos as inputs', () => {
    const rxPdos = [pdo('0x1600', [entry({ index: '0x6040', subIndex: '0x00', name: 'ControlWord' })])]
    const txPdos = [pdo('0x1A00', [entry({ index: '0x6041', subIndex: '0x00', name: 'StatusWord' })])]
    const result = reconcilePdoChannels({ rxPdos, txPdos, previousMappings: [] })

    const rxRow = result.channelInfo.find((c) => c.channelId === '0x1600-0x6040-0x00')
    const txRow = result.channelInfo.find((c) => c.channelId === '0x1A00-0x6041-0x00')
    expect(rxRow?.direction).toBe('output')
    expect(txRow?.direction).toBe('input')

    const rxMap = result.channelMappings.find((m) => m.channelId === '0x1600-0x6040-0x00')
    const txMap = result.channelMappings.find((m) => m.channelId === '0x1A00-0x6041-0x00')
    expect(rxMap?.iecLocation.startsWith('%Q')).toBe(true)
    expect(txMap?.iecLocation.startsWith('%I')).toBe(true)
  })

  test('empty PDOs produce empty channelInfo and mappings', () => {
    const result = reconcilePdoChannels({ previousMappings: [mapping('ghost', '%IW0')] })
    expect(result.channelInfo).toEqual([])
    expect(result.channelMappings).toEqual([])
  })
})
