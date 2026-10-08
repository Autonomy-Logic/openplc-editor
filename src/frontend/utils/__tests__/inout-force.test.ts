/**
 * The debugger's access rules for read-only and in-out leaves.
 *
 * A function block's VAR_IN_OUT is the caller's variable (IEC 61131-3 §3.48).
 * STruC++ shows it as an `indirect`, `readOnly` leaf: a live view of whatever
 * the last call bound, with `target` naming that variable when every call binds
 * the same plain one. The runtime refuses a force at the view itself, so the
 * editor forces the target, at its own name, or offers no force at all.
 */

import type { DebugMap } from '../debug-parser'
import { packDebugAddr, parseDebugMap } from '../debug-parser'
import {
  canForceDebugLeaf,
  clearDebugLeafAccess,
  describeInOutLeaf,
  forcedKeyFor,
  getDebugLeafAccess,
  registerDebugLeafAccess,
  resolveForceIndex,
} from '../inout-force'

const at = (elemIdx: number) => packDebugAddr({ arrayIdx: 0, elemIdx })

// The shape STruC++ writes for `acc0(total := counter)` and `acc1(total := arr[i])`.
const MAP_JSON = JSON.stringify({
  version: 2,
  md5: 'abc',
  typeTags: {},
  arrays: [{ index: 0, count: 5 }],
  leaves: [
    { arrayIdx: 0, elemIdx: 0, path: 'INSTANCE0.COUNTER', type: 'INT', size: 2 },
    {
      arrayIdx: 0,
      elemIdx: 1,
      path: 'INSTANCE0.ACC0.TOTAL',
      type: 'INT',
      size: 2,
      readOnly: true,
      indirect: true,
      target: 'INSTANCE0.COUNTER',
    },
    { arrayIdx: 0, elemIdx: 2, path: 'INSTANCE0.ACC1.TOTAL', type: 'INT', size: 2, readOnly: true, indirect: true },
    { arrayIdx: 0, elemIdx: 3, path: 'INSTANCE0.LIMIT', type: 'INT', size: 2, readOnly: true },
    { arrayIdx: 0, elemIdx: 4, path: 'INSTANCE0.ACC0.SUM', type: 'INT', size: 2 },
  ],
})

const keys = new Map([
  ['main:counter', at(0)],
  ['main:acc0.total', at(1)],
  ['main:acc1.total', at(2)],
  ['main:limit', at(3)],
  ['main:acc0.sum', at(4)],
])

function register(withKeys = true): DebugMap {
  const map = parseDebugMap(MAP_JSON)
  if (!map) throw new Error('fixture did not parse')
  registerDebugLeafAccess(map, withKeys ? keys : undefined)
  return map
}

afterEach(() => clearDebugLeafAccess())

describe('debug leaf access (IEC 61131-3 §3.48)', () => {
  it('keeps the in-out marks through parseDebugMap', () => {
    const map = register()
    expect(map.leaves[1]).toMatchObject({ readOnly: true, indirect: true, target: 'INSTANCE0.COUNTER' })
  })

  it('forces an ordinary leaf at its own index', () => {
    register()
    expect(resolveForceIndex(at(0))).toBe(at(0))
    expect(resolveForceIndex(at(4))).toBe(at(4))
    expect(canForceDebugLeaf(at(4))).toBe(true)
    expect(getDebugLeafAccess(at(4))).toBeUndefined()
  })

  it('forces an in-out with a target at the target', () => {
    register()
    expect(resolveForceIndex(at(1))).toBe(at(0))
    expect(canForceDebugLeaf(at(1))).toBe(true)
    expect(getDebugLeafAccess(at(1))).toMatchObject({ readOnly: true, indirect: true, targetIndex: at(0) })
  })

  it('records the force under the target key, where [FORCED] shows', () => {
    register()
    expect(forcedKeyFor('main:acc0.total', at(1))).toBe('main:counter')
    expect(forcedKeyFor('main:acc0.sum', at(4))).toBe('main:acc0.sum')
  })

  it('falls back to the key it was given when the session has no key map', () => {
    register(false)
    expect(forcedKeyFor('main:acc0.total', at(1))).toBe('main:acc0.total')
    expect(resolveForceIndex(at(1))).toBe(at(0))
  })

  it('offers no force for an in-out without a target, or for a CONSTANT', () => {
    register()
    expect(resolveForceIndex(at(2))).toBeUndefined()
    expect(canForceDebugLeaf(at(2))).toBe(false)
    expect(resolveForceIndex(at(3))).toBeUndefined()
    expect(canForceDebugLeaf(at(3))).toBe(false)
  })

  it('explains an in-out leaf, naming the target when known', () => {
    register()
    expect(describeInOutLeaf(at(1))).toBe('In-out: shows main:counter. Forcing it forces main:counter.')
    expect(describeInOutLeaf(at(2))).toContain('read-only')
    expect(describeInOutLeaf(at(3))).toBeUndefined()
    expect(describeInOutLeaf(at(0))).toBeUndefined()
  })

  it('forgets the previous session', () => {
    register()
    clearDebugLeafAccess()
    expect(resolveForceIndex(at(3))).toBe(at(3))
    expect(canForceDebugLeaf(at(2))).toBe(true)
  })
})
