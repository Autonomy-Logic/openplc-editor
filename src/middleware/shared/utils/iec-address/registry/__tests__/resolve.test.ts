import { channelKey } from '../allocate'
import { addConsumer, createRegistry, setAlias } from '../registry'
import { buildAliasIndex, isLiteralLocation, resolveLocation } from '../resolve'
import type { IecAddressRegistry, RegistryConsumer } from '../types'

const word = { direction: 'Q', size: 'W' } as const

function consumer(id: string, order: number, channels: RegistryConsumer['channels']): RegistryConsumer {
  return { id, kind: 'test', order, channels }
}

describe('buildAliasIndex', () => {
  it('maps each aliased channel to its assigned address', () => {
    let reg = addConsumer(
      createRegistry(),
      consumer('c1', 0, [
        { channelId: 'a', class: word },
        { channelId: 'b', class: word },
      ]),
    )
    reg = (setAlias(reg, 'c1', 'a', 'motor') as { ok: true; registry: typeof reg }).registry
    const index = buildAliasIndex(reg)
    expect(index.get('motor')).toBe('%QW0')
    expect(index.size).toBe(1) // channel b has no alias → absent
  })

  it('ignores an alias whose channel has no assignment', () => {
    // Hand-built registry: alias present but assignments map is empty.
    const reg: IecAddressRegistry = {
      consumers: [consumer('c1', 0, [{ channelId: 'a', class: word, alias: 'ghost' }])],
      assignments: {},
    }
    expect(buildAliasIndex(reg).size).toBe(0)
  })

  it('first-wins on duplicate aliases (defensive against hand-edited files)', () => {
    const reg: IecAddressRegistry = {
      consumers: [
        consumer('c1', 0, [{ channelId: 'a', class: word, alias: 'dup' }]),
        consumer('c2', 1, [{ channelId: 'a', class: word, alias: 'dup' }]),
      ],
      assignments: {
        [channelKey('c1', 'a')]: '%QW0',
        [channelKey('c2', 'a')]: '%QW1',
      },
    }
    expect(buildAliasIndex(reg).get('dup')).toBe('%QW0')
  })
})

describe('isLiteralLocation', () => {
  it('detects % literals vs alias names', () => {
    expect(isLiteralLocation('%QX0.0')).toBe(true)
    expect(isLiteralLocation('push_button')).toBe(false)
  })
})

describe('resolveLocation', () => {
  const index = new Map<string, string>([['motor', '%QW3']])

  it('returns empty for an empty field', () => {
    expect(resolveLocation('', index)).toBe('')
  })

  it('honours literal addresses verbatim', () => {
    expect(resolveLocation('%IX2.4', index)).toBe('%IX2.4')
  })

  it('resolves an alias to its current address', () => {
    expect(resolveLocation('motor', index)).toBe('%QW3')
  })

  it('returns empty when the alias no longer resolves', () => {
    expect(resolveLocation('gone', index)).toBe('')
  })
})
