import { walkDebugResponse } from '../debug-response-walker'

type Decoded = { index: number; position: number; type: string; value: string }

function walk(options: {
  requested: number[]
  payload: number[]
  lastIndex?: number
  types: Record<number, string | undefined>
  endian?: 'le' | 'be'
}) {
  const decoded: Decoded[] = []
  const failed: Array<{ index: number; type: string }> = []
  const result = walkDebugResponse({
    requested: options.requested,
    payload: new Uint8Array(options.payload),
    lastIndex: options.lastIndex,
    endian: options.endian ?? 'le',
    typeOf: (index) => options.types[index],
    emit: (entry) => decoded.push(entry),
    onError: (entry) => failed.push({ index: entry.index, type: entry.type }),
  })
  return { ...result, decoded, failed }
}

describe('walkDebugResponse', () => {
  it('decodes positions in request order, sized by each type', () => {
    // BOOL(1) then INT(2, LE) then BOOL(1)
    const out = walk({
      requested: [10, 11, 12],
      payload: [1, 0x2a, 0x00, 0],
      types: { 10: 'BOOL', 11: 'INT', 12: 'BOOL' },
    })

    expect(out.decoded.map((d) => [d.index, d.value])).toEqual([
      [10, 'TRUE'],
      [11, '42'],
      [12, 'FALSE'],
    ])
    expect(out.positionsConsumed).toBe(3)
    expect(out.reachedEnd).toBe(true)
  })

  it('stops at lastIndex, because later positions were never read by the runtime', () => {
    // Decoding position 2 from trailing bytes would produce a plausible wrong
    // value rather than an error — the reason lastIndex is honoured.
    const out = walk({
      requested: [1, 2, 3],
      payload: [1, 1, 1],
      lastIndex: 1,
      types: { 1: 'BOOL', 2: 'BOOL', 3: 'BOOL' },
    })

    expect(out.decoded).toHaveLength(2)
    expect(out.positionsConsumed).toBe(2)
    expect(out.reachedEnd).toBe(false)
  })

  it('counts an unknown-type position as consumed without decoding it', () => {
    // The runtime consumed the slot; it does not know our index->type map.
    const out = walk({
      requested: [1, 2],
      payload: [7],
      types: { 1: undefined, 2: 'USINT' },
    })

    expect(out.decoded.map((d) => d.index)).toEqual([2])
    expect(out.positionsConsumed).toBe(2)
  })

  it('does NOT count a position it could not fit in the buffer', () => {
    // A round-robin caller advances by positionsConsumed, so counting a
    // truncated position here would strand it for the life of the session.
    const out = walk({
      requested: [1, 2],
      payload: [1],
      types: { 1: 'BOOL', 2: 'DINT' },
    })

    expect(out.decoded.map((d) => d.index)).toEqual([1])
    expect(out.positionsConsumed).toBe(1)
    expect(out.reachedEnd).toBe(false)
  })

  it('reports a codec failure and still advances past its bytes', () => {
    // Misaligning every later position is worse than one unreadable value.
    const out = walk({
      requested: [1, 2],
      payload: [0, 0, 0, 0, 5],
      types: { 1: 'NOT_A_TYPE', 2: 'USINT' },
    })

    expect(out.positionsConsumed).toBe(2)
    expect(out.decoded.some((d) => d.index === 2)).toBe(true)
  })

  it('swaps bytes for a big-endian target so the LE-only codec reads correctly', () => {
    const le = walk({ requested: [1], payload: [0x2a, 0x00], types: { 1: 'INT' } })
    const be = walk({ requested: [1], payload: [0x00, 0x2a], types: { 1: 'INT' }, endian: 'be' })

    expect(le.decoded[0].value).toBe('42')
    expect(be.decoded[0].value).toBe('42')
  })

  it('treats an undefined lastIndex as "the runtime processed everything"', () => {
    const out = walk({ requested: [1, 2], payload: [1, 0], types: { 1: 'BOOL', 2: 'BOOL' } })
    expect(out.positionsConsumed).toBe(2)
    expect(out.reachedEnd).toBe(true)
  })

  it('handles an empty request without touching the payload', () => {
    const out = walk({ requested: [], payload: [1, 2, 3], types: {} })
    expect(out).toMatchObject({ positionsConsumed: 0, reachedEnd: true })
    expect(out.decoded).toEqual([])
  })
})
