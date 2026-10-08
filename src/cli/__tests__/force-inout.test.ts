/**
 * Forcing a function block's VAR_IN_OUT.
 *
 * STruC++ binds an in-out to the caller's variable (IEC 61131-3 §3.48: the
 * in-out IS that variable), so its debug leaf is a live, read-only view of it
 * (`indirect` + `readOnly` in debug-map.json). The runtime refuses a force at
 * the in-out itself; the force belongs on the variable it is bound to, at that
 * variable's own name, which the map gives as `target` when every call binds
 * the same plain variable.
 *
 *  - `debug force fb.inout` with a target forces the target, and says so.
 *  - Without a target it is refused with a message naming what to force.
 *  - A CONSTANT is refused too.
 *  - `debug list-vars` carries the in-out / read-only marks and the target.
 */

import type { DebugVariableIndex, ResolvedVariable } from '../debug/variables'
import { ErrorCode } from '../exit-codes'
import type { PlcControl } from '../session/session-core'
import { SessionCore } from '../session/session-core'

const counter: ResolvedVariable = { name: 'main:counter', index: 1, arr: 0, elem: 1, type: 'INT', size: 2 }
const boundInOut: ResolvedVariable = {
  name: 'main:acc0.total',
  index: 2,
  arr: 0,
  elem: 2,
  type: 'INT',
  size: 2,
  readOnly: true,
  inOut: true,
  target: 'main:counter',
}
const unboundInOut: ResolvedVariable = {
  name: 'main:acc1.total',
  index: 3,
  arr: 0,
  elem: 3,
  type: 'INT',
  size: 2,
  readOnly: true,
  inOut: true,
}
const constant: ResolvedVariable = {
  name: 'main:limit',
  index: 4,
  arr: 0,
  elem: 4,
  type: 'INT',
  size: 2,
  readOnly: true,
}

const plc: PlcControl = {
  start: () => Promise.resolve({ success: true }),
  stop: () => Promise.resolve({ success: true }),
  state: () => Promise.resolve('running' as const),
}

function makeCore() {
  const writes: Array<{ index: number; force: boolean }> = []
  // Every INT reads back 7 — the value the tests force, so read-back settles.
  const channel = {
    connect: () => Promise.resolve(),
    disconnect: () => undefined,
    getVariablesList: (indexes: number[]) =>
      Promise.resolve({
        success: true as const,
        tick: 1,
        lastIndex: indexes.length - 1,
        data: new Uint8Array(indexes.flatMap(() => [7, 0])),
      }),
    setVariable: (index: number, force: boolean) => {
      writes.push({ index, force })
      return Promise.resolve({ success: true as const })
    },
    getMd5Hash: () => Promise.resolve({ success: true as const, md5: 'abc', targetEndian: 'le' as const }),
  }
  const all = [counter, boundInOut, unboundInOut, constant]
  const index: DebugVariableIndex = {
    md5: 'abc',
    warnings: [],
    all,
    byName: new Map(all.map((variable) => [variable.name.toUpperCase(), variable])),
    byIndex: new Map(all.map((variable) => [variable.index, variable])),
  }
  const core = new SessionCore({
    sessionId: 'test',
    projectPath: '/tmp/project',
    target: 'Test Board',
    transport: 'rtu',
    descriptor: '/dev/null',
    channel,
    index,
    plc,
    programMd5: 'abc',
    endian: 'le',
    batchSize: 8,
  })
  return { core, writes }
}

describe('forcing a VAR_IN_OUT (IEC 61131-3 §3.48)', () => {
  it('forces the variable the in-out is bound to, at its own name', async () => {
    const { core, writes } = makeCore()
    const response = await core.handle({ id: 1, kind: 'force', name: 'main:acc0.total', value: '7' })

    if (!response.ok) throw new Error(`expected the force to succeed: ${response.error.message}`)
    expect(writes).toEqual([{ index: counter.index, force: true }])
    if (response.data?.kind !== 'force') throw new Error('expected a force payload')
    expect(response.data.value.name).toBe('main:counter')
  })

  it('releases the bound variable when the in-out is unforced', async () => {
    const { core, writes } = makeCore()
    await core.handle({ id: 1, kind: 'force', name: 'main:acc0.total', value: '7' })
    const response = await core.handle({ id: 2, kind: 'unforce', name: 'main:acc0.total' })

    expect(response.ok).toBe(true)
    expect(writes).toEqual([
      { index: counter.index, force: true },
      { index: counter.index, force: false },
    ])
  })

  it('refuses an in-out whose variable cannot be named, and says what to force', async () => {
    const { core, writes } = makeCore()
    const response = await core.handle({ id: 1, kind: 'force', name: 'main:acc1.total', value: '7' })

    if (response.ok) throw new Error('expected a refusal')
    expect(response.error.code).toBe(ErrorCode.ValueInvalid)
    expect(response.error.message).toContain('main:acc1.total')
    expect(response.error.message).toContain('in-out')
    expect(response.error.message).toContain('Force that variable')
    expect(writes).toEqual([])
  })

  it('refuses a CONSTANT', async () => {
    const { core, writes } = makeCore()
    const response = await core.handle({ id: 1, kind: 'force', name: 'main:limit', value: '7' })

    if (response.ok) throw new Error('expected a refusal')
    expect(response.error.code).toBe(ErrorCode.ValueInvalid)
    expect(response.error.message).toContain('CONSTANT')
    expect(writes).toEqual([])
  })

  it('still forces an ordinary variable at its own address', async () => {
    const { core, writes } = makeCore()
    const response = await core.handle({ id: 1, kind: 'force', name: 'main:counter', value: '7' })

    expect(response.ok).toBe(true)
    expect(writes).toEqual([{ index: counter.index, force: true }])
  })

  it('lists the in-out and read-only marks, and the target', async () => {
    const { core } = makeCore()
    const response = await core.handle({ id: 1, kind: 'list-vars' })

    if (!response.ok || response.data?.kind !== 'list-vars') throw new Error('expected a list-vars payload')
    expect(response.data.variables).toEqual([
      { name: 'main:counter', type: 'INT', size: 2 },
      { name: 'main:acc0.total', type: 'INT', size: 2, readOnly: true, inOut: true, target: 'main:counter' },
      { name: 'main:acc1.total', type: 'INT', size: 2, readOnly: true, inOut: true },
      { name: 'main:limit', type: 'INT', size: 2, readOnly: true },
    ])
  })
})
