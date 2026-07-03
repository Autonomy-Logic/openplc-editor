import { channelKey } from '../allocate'
import {
  addConsumer,
  addressOf,
  createRegistry,
  recalculate,
  removeConsumer,
  restoreAliasesFromMemory,
  setAlias,
  updateConsumer,
} from '../registry'
import type { IecAddressRegistry, RegistryConsumer } from '../types'

const word = { direction: 'Q', size: 'W' } as const

function consumer(id: string, order: number, channels: RegistryConsumer['channels']): RegistryConsumer {
  return { id, kind: 'test', order, channels }
}

describe('createRegistry', () => {
  it('starts empty', () => {
    expect(createRegistry()).toEqual({ consumers: [], assignments: {} })
  })
})

describe('recalculate', () => {
  it('is idempotent', () => {
    const r1 = addConsumer(createRegistry(), consumer('c1', 0, [{ channelId: 'a', class: word }]))
    const r2 = recalculate(r1).registry
    expect(r2.assignments).toEqual(r1.assignments)
  })

  it('scopes allocation to active consumer kinds', () => {
    let reg = createRegistry()
    reg = addConsumer(reg, { id: 'pins', kind: 'pin-mapping', order: 0, channels: [{ channelId: 'a', class: word }] })
    reg = addConsumer(reg, {
      id: 'mb',
      kind: 'modbus-tcp-remote',
      order: 1,
      channels: [{ channelId: 'a', class: word }],
    })
    // Simulate switching to a target without pin mapping.
    const scoped = recalculate(reg, { activeKinds: new Set(['modbus-tcp-remote']) })
    expect(scoped.registry.assignments[channelKey('pins', 'a')]).toBeUndefined()
    expect(scoped.registry.assignments[channelKey('mb', 'a')]).toBe('%QW0')
  })

  it('surfaces pinned conflicts', () => {
    const reg = addConsumer(
      createRegistry(),
      consumer('c1', 0, [
        { channelId: 'a', class: word, pinned: '%QW0' },
        { channelId: 'b', class: word, pinned: '%QW0' },
      ]),
    )
    expect(recalculate(reg).conflicts).toHaveLength(1)
  })
})

describe('addConsumer', () => {
  it('appends and allocates', () => {
    const reg = addConsumer(createRegistry(), consumer('c1', 0, [{ channelId: 'a', class: word }]))
    expect(addressOf(reg, 'c1', 'a')).toBe('%QW0')
  })

  it('replaces a consumer with the same id', () => {
    let reg = addConsumer(createRegistry(), consumer('c1', 0, [{ channelId: 'a', class: word }]))
    reg = addConsumer(reg, consumer('c1', 0, [{ channelId: 'x', class: word }]))
    expect(reg.consumers).toHaveLength(1)
    expect(addressOf(reg, 'c1', 'a')).toBeUndefined()
    expect(addressOf(reg, 'c1', 'x')).toBe('%QW0')
  })
})

describe('removeConsumer', () => {
  it('drops the consumer and recompacts survivors into the freed slots', () => {
    let reg = createRegistry()
    reg = addConsumer(reg, consumer('c1', 0, [{ channelId: 'a', class: word }])) // %QW0
    reg = addConsumer(reg, consumer('c2', 1, [{ channelId: 'a', class: word }])) // %QW1
    expect(addressOf(reg, 'c2', 'a')).toBe('%QW1')
    reg = removeConsumer(reg, 'c1')
    // c2 slides down into the freed %QW0 — this is the gap reclamation.
    expect(addressOf(reg, 'c2', 'a')).toBe('%QW0')
    expect(reg.consumers).toHaveLength(1)
  })
})

describe('updateConsumer', () => {
  it('changes channel count and recomputes', () => {
    let reg = addConsumer(createRegistry(), consumer('c1', 0, [{ channelId: 'a', class: word }]))
    reg = updateConsumer(reg, 'c1', {
      channels: [
        { channelId: 'a', class: word },
        { channelId: 'b', class: word },
      ],
    })
    expect(addressOf(reg, 'c1', 'b')).toBe('%QW1')
  })

  it('is a no-op for an unknown consumer', () => {
    const reg = addConsumer(createRegistry(), consumer('c1', 0, [{ channelId: 'a', class: word }]))
    expect(updateConsumer(reg, 'missing', { label: 'x' })).toBe(reg)
  })
})

describe('addressOf', () => {
  it('returns undefined for an unknown channel', () => {
    const reg = addConsumer(createRegistry(), consumer('c1', 0, [{ channelId: 'a', class: word }]))
    expect(addressOf(reg, 'c1', 'nope')).toBeUndefined()
  })
})

describe('restoreAliasesFromMemory', () => {
  const reg = (): IecAddressRegistry => ({
    consumers: [
      {
        id: 'vpp-slot-1',
        kind: 'vpp-io',
        order: 0,
        channels: [
          { channelId: 'DO1', class: word, memoryKey: 'mod-a:1:DO1' }, // no alias
          { channelId: 'DO2', class: word, alias: 'kept', memoryKey: 'mod-a:1:DO2' }, // has alias
          { channelId: 'DO3', class: word }, // no memoryKey
        ],
      },
    ],
    assignments: {},
  })

  it('restores an alias for a channel whose memoryKey is remembered', () => {
    const out = restoreAliasesFromMemory(reg(), { 'mod-a:1:DO1': 'push_button' })
    expect(out.consumers[0].channels[0].alias).toBe('push_button')
  })

  it('does not overwrite a channel that already has an alias', () => {
    const out = restoreAliasesFromMemory(reg(), { 'mod-a:1:DO2': 'other' })
    expect(out.consumers[0].channels[1].alias).toBe('kept')
  })

  it('leaves channels without a memoryKey untouched', () => {
    const out = restoreAliasesFromMemory(reg(), { 'mod-a:1:DO1': 'x' })
    expect(out.consumers[0].channels[2].alias).toBeUndefined()
  })

  it('leaves a channel untouched when its memoryKey is not remembered', () => {
    const out = restoreAliasesFromMemory(reg(), {})
    expect(out.consumers[0].channels[0].alias).toBeUndefined()
  })
})

describe('setAlias', () => {
  const base = () =>
    addConsumer(
      createRegistry(),
      consumer('c1', 0, [
        { channelId: 'a', class: word },
        { channelId: 'b', class: word },
      ]),
    )

  it('sets an alias (trimmed)', () => {
    const res = setAlias(base(), 'c1', 'a', '  push_button  ')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.registry.consumers[0].channels[0].alias).toBe('push_button')
  })

  it('clears the alias when empty / whitespace', () => {
    let reg = base()
    reg = (setAlias(reg, 'c1', 'a', 'x') as { ok: true; registry: typeof reg }).registry
    const res = setAlias(reg, 'c1', 'a', '   ')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.registry.consumers[0].channels[0].alias).toBeUndefined()
  })

  it('rejects a duplicate alias on a different channel', () => {
    let reg = base()
    reg = (setAlias(reg, 'c1', 'a', 'motor') as { ok: true; registry: typeof reg }).registry
    const res = setAlias(reg, 'c1', 'b', 'motor')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.conflict).toEqual({ alias: 'motor', consumerId: 'c1', channelId: 'a' })
  })

  it('allows re-setting the same alias on the same channel (no-op write)', () => {
    let reg = base()
    reg = (setAlias(reg, 'c1', 'a', 'motor') as { ok: true; registry: typeof reg }).registry
    const res = setAlias(reg, 'c1', 'a', 'motor')
    expect(res.ok).toBe(true)
  })

  it('is a benign no-op when the consumer is unknown', () => {
    const reg = base()
    const res = setAlias(reg, 'missing', 'a', 'x')
    expect(res).toEqual({ ok: true, registry: reg })
  })

  it('is a benign no-op when the channel is unknown', () => {
    const reg = base()
    const res = setAlias(reg, 'c1', 'missing', 'x')
    expect(res).toEqual({ ok: true, registry: reg })
  })

  it('leaves other consumers untouched when setting an alias', () => {
    let reg = addConsumer(base(), consumer('c2', 1, [{ channelId: 'a', class: word }]))
    reg = (setAlias(reg, 'c1', 'a', 'motor') as { ok: true; registry: typeof reg }).registry
    expect(reg.consumers.find((c) => c.id === 'c2')?.channels[0].alias).toBeUndefined()
  })
})
