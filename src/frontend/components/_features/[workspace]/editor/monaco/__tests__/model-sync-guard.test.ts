import { runWithoutDirtying } from '../model-sync-guard'

describe('runWithoutDirtying', () => {
  it('holds the flag up for the duration of the write', () => {
    const flag = { current: false }
    let seenInside: boolean | null = null

    runWithoutDirtying(flag, () => {
      seenInside = flag.current
    })

    expect(seenInside).toBe(true)
    expect(flag.current).toBe(false)
  })

  it('lowers the flag when the write throws, and lets the error through', () => {
    const flag = { current: false }
    const boom = new Error('store write failed')

    expect(() =>
      runWithoutDirtying(flag, () => {
        throw boom
      }),
    ).toThrow(boom)

    // Without the `finally` the flag would stay raised and every later user edit
    // would stop marking the file unsaved, for the rest of the session.
    expect(flag.current).toBe(false)
  })

  it('leaves the flag down after consecutive writes', () => {
    const flag = { current: false }

    runWithoutDirtying(flag, () => undefined)
    runWithoutDirtying(flag, () => undefined)

    expect(flag.current).toBe(false)
  })
})
