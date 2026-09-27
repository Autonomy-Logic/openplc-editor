/**
 * Per-task facts the firmware needs in RTOS mode: which task owns each run of
 * the debug table, and how many priority levels the project's tasks take.
 */

import { buildDebugOwnerRanges, countDistinctPriorities } from '../tasks'

const map = (leaves: { arrayIdx: number; elemIdx: number; path: string }[]) => JSON.stringify({ leaves })

describe('buildDebugOwnerRanges', () => {
  const instances = [
    { name: 'MainInst', task: 'MainTask' },
    { name: 'NetInst', task: 'NET_TASK' },
  ]

  it('gives each run of one task’s leaves one range, matching instances case-insensitively', () => {
    const ranges = buildDebugOwnerRanges(
      map([
        { arrayIdx: 0, elemIdx: 0, path: 'MAININST.A' },
        { arrayIdx: 0, elemIdx: 1, path: 'MAININST.T.Q' },
        { arrayIdx: 0, elemIdx: 2, path: 'NETINST.B' },
        { arrayIdx: 0, elemIdx: 3, path: 'NETINST.C' },
      ]),
      instances,
    )
    expect(ranges).toEqual([
      { arr: 0, first: 0, last: 1, task: 'MainTask' },
      { arr: 0, first: 2, last: 3, task: 'NET_TASK' },
    ])
  })

  it('leaves globals out, and splits a run a global interrupts', () => {
    const ranges = buildDebugOwnerRanges(
      map([
        { arrayIdx: 0, elemIdx: 0, path: 'MAININST.A' },
        { arrayIdx: 0, elemIdx: 1, path: 'SHARED_COUNTER' },
        { arrayIdx: 0, elemIdx: 2, path: 'MAININST.B' },
        { arrayIdx: 1, elemIdx: 0, path: 'MAININST.C' },
      ]),
      instances,
    )
    expect(ranges).toEqual([
      { arr: 0, first: 0, last: 0, task: 'MainTask' },
      { arr: 0, first: 2, last: 2, task: 'MainTask' },
      { arr: 1, first: 0, last: 0, task: 'MainTask' },
    ])
  })

  it('sorts leaves listed out of order before grouping them', () => {
    const ranges = buildDebugOwnerRanges(
      map([
        { arrayIdx: 0, elemIdx: 1, path: 'MAININST.B' },
        { arrayIdx: 0, elemIdx: 0, path: 'MAININST.A' },
      ]),
      instances,
    )
    expect(ranges).toEqual([{ arr: 0, first: 0, last: 1, task: 'MainTask' }])
  })

  it('never takes a global for an instance, whatever the names', () => {
    // A global structure LINE and an instance named LINE: the global's fields
    // are shared, not the instance's task's.
    const ranges = buildDebugOwnerRanges(
      map([
        { arrayIdx: 0, elemIdx: 0, path: 'LINE.SPEED' },
        { arrayIdx: 0, elemIdx: 1, path: 'MAININST' },
        { arrayIdx: 0, elemIdx: 2, path: 'MAININST.A' },
      ]),
      [...instances, { name: 'Line', task: 'NET_TASK' }],
      ['line'],
    )
    expect(ranges).toEqual([{ arr: 0, first: 2, last: 2, task: 'MainTask' }])
  })

  it('returns nothing for a map it cannot read, and skips malformed leaves', () => {
    expect(buildDebugOwnerRanges('not json', instances)).toEqual([])
    expect(buildDebugOwnerRanges('{}', instances)).toEqual([])
    expect(buildDebugOwnerRanges(JSON.stringify({ leaves: [null, { arrayIdx: 0 }, 'x'] }), instances)).toEqual([])
  })
})

describe('countDistinctPriorities', () => {
  it('counts each IEC priority once', () => {
    expect(countDistinctPriorities([{ priority: 0 }, { priority: 1 }, { priority: 1 }, { priority: 5 }])).toBe(3)
    expect(countDistinctPriorities([])).toBe(0)
  })
})
