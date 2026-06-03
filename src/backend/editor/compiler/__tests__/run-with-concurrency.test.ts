import { runWithConcurrencyLimit } from '../run-with-concurrency'

describe('runWithConcurrencyLimit', () => {
  it('returns an empty array for empty input without invoking fn', async () => {
    const fn = jest.fn()
    const result = await runWithConcurrencyLimit([], 4, fn)
    expect(result).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns results in input order regardless of completion order', async () => {
    // Items finish in reverse order — fastest at the end of the input,
    // slowest at the start. Result array must still be in input order.
    const items = [50, 30, 10] // ms delays
    const result = await runWithConcurrencyLimit(items, 3, async (delay, idx) => {
      await new Promise((r) => setTimeout(r, delay))
      return idx
    })
    expect(result).toEqual([0, 1, 2])
  })

  it('passes the original index to fn so callers can correlate input ↔ output', async () => {
    const seen: Array<[string, number]> = []
    await runWithConcurrencyLimit(['a', 'b', 'c'], 2, async (item, idx) => {
      seen.push([item, idx])
      return null
    })
    expect(seen.sort()).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('never exceeds the configured concurrency limit', async () => {
    // 20 items, limit of 3 — instrument with an in-flight counter and
    // assert the peak never crosses 3.
    let inFlight = 0
    let peak = 0
    const limit = 3
    const items = Array.from({ length: 20 }, (_, i) => i)

    await runWithConcurrencyLimit(items, limit, async (i) => {
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      // Yield a tick so workers actually overlap rather than each
      // synchronously enqueueing the next.
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return i
    })

    expect(peak).toBeLessThanOrEqual(limit)
    expect(peak).toBeGreaterThan(1) // sanity: we actually used the slots
  })

  it('spawns fewer workers than the limit when items.length is smaller', async () => {
    // Limit 10, items 3 — there should never be more than 3 in flight
    // because there are only 3 to process.
    let inFlight = 0
    let peak = 0
    await runWithConcurrencyLimit([1, 2, 3], 10, async (n) => {
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      await new Promise((r) => setTimeout(r, 2))
      inFlight -= 1
      return n
    })
    expect(peak).toBe(3)
  })

  it('rejects on the first fn error (Promise.all semantics)', async () => {
    const fn = jest.fn(async (n: number) => {
      if (n === 1) throw new Error('boom on 1')
      await new Promise((r) => setTimeout(r, 10))
      return n
    })
    await expect(runWithConcurrencyLimit([0, 1, 2, 3], 2, fn)).rejects.toThrow('boom on 1')
  })

  it('treats limit <= 0 as 1 (defensive against os.cpus() returning 0)', async () => {
    let inFlight = 0
    let peak = 0
    await runWithConcurrencyLimit([0, 1, 2], 0, async (n) => {
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      await new Promise((r) => setTimeout(r, 2))
      inFlight -= 1
      return n
    })
    expect(peak).toBe(1)
  })

  it('floors non-integer limits (e.g. 3.7 → 3)', async () => {
    let inFlight = 0
    let peak = 0
    await runWithConcurrencyLimit(
      Array.from({ length: 10 }, (_, i) => i),
      3.7,
      async (n) => {
        inFlight += 1
        if (inFlight > peak) peak = inFlight
        await new Promise((r) => setTimeout(r, 2))
        inFlight -= 1
        return n
      },
    )
    expect(peak).toBe(3)
  })
})
