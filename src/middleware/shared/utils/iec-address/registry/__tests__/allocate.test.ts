import { allocateAddresses, channelKey } from '../allocate'
import type { RegistryConsumer } from '../types'

const bit = { direction: 'I', size: 'X' } as const
const word = { direction: 'Q', size: 'W' } as const

function consumer(id: string, order: number, channels: RegistryConsumer['channels']): RegistryConsumer {
  return { id, kind: 'test', order, channels }
}

describe('channelKey', () => {
  it('is unambiguous even when ids contain the separator characters', () => {
    expect(channelKey('a', 'b')).not.toBe(channelKey('a"', 'b'))
    expect(channelKey('a', 'b')).toBe(channelKey('a', 'b'))
  })
})

describe('allocateAddresses', () => {
  it('allocates lowest-free per prefix, independent spaces', () => {
    const { assignments, conflicts } = allocateAddresses([
      consumer('c1', 0, [
        { channelId: 'a', class: bit },
        { channelId: 'b', class: bit },
        { channelId: 'w', class: word },
      ]),
    ])
    expect(conflicts).toEqual([])
    expect(assignments[channelKey('c1', 'a')]).toBe('%IX0.0')
    expect(assignments[channelKey('c1', 'b')]).toBe('%IX0.1')
    // Word space is independent of the bit space.
    expect(assignments[channelKey('c1', 'w')]).toBe('%QW0')
  })

  it('allocates across consumers in (order, id) order', () => {
    const { assignments } = allocateAddresses([
      consumer('z', 1, [{ channelId: 'a', class: word }]),
      consumer('a', 0, [{ channelId: 'a', class: word }]),
      consumer('m', 0, [{ channelId: 'a', class: word }]),
    ])
    // order 0 first (a before m by id tiebreak), then order 1 (z)
    expect(assignments[channelKey('a', 'a')]).toBe('%QW0')
    expect(assignments[channelKey('m', 'a')]).toBe('%QW1')
    expect(assignments[channelKey('z', 'a')]).toBe('%QW2')
  })

  it('reserves pinned channels and allocates around them', () => {
    const { assignments } = allocateAddresses([
      consumer('c1', 0, [
        { channelId: 'p', class: word, pinned: '%QW2' },
        { channelId: 'a', class: word },
        { channelId: 'b', class: word },
        { channelId: 'c', class: word },
      ]),
    ])
    expect(assignments[channelKey('c1', 'p')]).toBe('%QW2')
    // allocated channels skip the reserved %QW2
    expect(assignments[channelKey('c1', 'a')]).toBe('%QW0')
    expect(assignments[channelKey('c1', 'b')]).toBe('%QW1')
    expect(assignments[channelKey('c1', 'c')]).toBe('%QW3')
  })

  it('honours an unparseable pinned address verbatim without reserving', () => {
    const { assignments, conflicts } = allocateAddresses([
      consumer('c1', 0, [
        { channelId: 'weird', class: word, pinned: 'NOT_AN_ADDRESS' },
        { channelId: 'a', class: word },
      ]),
    ])
    expect(conflicts).toEqual([])
    expect(assignments[channelKey('c1', 'weird')]).toBe('NOT_AN_ADDRESS')
    expect(assignments[channelKey('c1', 'a')]).toBe('%QW0')
  })

  it('reports pinned-vs-pinned collisions first-wins, including 3-way', () => {
    const { assignments, conflicts } = allocateAddresses([
      consumer('c1', 0, [
        { channelId: 'first', class: word, pinned: '%QW5' },
        { channelId: 'second', class: word, pinned: '%QW5' },
        { channelId: 'third', class: word, pinned: '%QW5' },
      ]),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].address).toBe('%QW5')
    expect(conflicts[0].keys).toEqual([
      channelKey('c1', 'first'),
      channelKey('c1', 'second'),
      channelKey('c1', 'third'),
    ])
    // Every channel still records the address it asked for.
    expect(assignments[channelKey('c1', 'first')]).toBe('%QW5')
    expect(assignments[channelKey('c1', 'third')]).toBe('%QW5')
  })

  it('finds the conflict winner past earlier non-matching reservations', () => {
    // A pinned channel at a DIFFERENT address is reserved before the
    // colliding pair, so locating the winner must skip it.
    const { conflicts } = allocateAddresses([
      consumer('c1', 0, [
        { channelId: 'lead', class: word, pinned: '%QW1' },
        { channelId: 'first', class: word, pinned: '%QW5' },
        { channelId: 'second', class: word, pinned: '%QW5' },
      ]),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].keys).toEqual([channelKey('c1', 'first'), channelKey('c1', 'second')])
  })

  it('excludes consumers whose kind is inactive and recompacts survivors', () => {
    const consumers: RegistryConsumer[] = [
      { id: 'pins', kind: 'pin-mapping', order: 0, channels: [{ channelId: 'a', class: word }] },
      { id: 'mb', kind: 'modbus-tcp-remote', order: 1, channels: [{ channelId: 'a', class: word }] },
    ]
    // With pin-mapping inactive (e.g. a Runtime v4 target), only the Modbus
    // consumer allocates — and it takes %QW0, not %QW1.
    const active = allocateAddresses(consumers, { activeKinds: new Set(['modbus-tcp-remote']) })
    expect(active.assignments[channelKey('pins', 'a')]).toBeUndefined()
    expect(active.assignments[channelKey('mb', 'a')]).toBe('%QW0')

    // With both active, pin-mapping (order 0) takes %QW0 and Modbus %QW1.
    const both = allocateAddresses(consumers)
    expect(both.assignments[channelKey('pins', 'a')]).toBe('%QW0')
    expect(both.assignments[channelKey('mb', 'a')]).toBe('%QW1')
  })

  it('handles an empty consumer list', () => {
    expect(allocateAddresses([])).toEqual({ assignments: {}, conflicts: [] })
  })
})
