/**
 * A force that never lands must not report success.
 *
 * `readBackAfterWrite` used to give up quietly on a value that never took,
 * justified by the soft-`write` verb ("a mismatch is legitimate for a write the
 * program overwrites next scan"). That verb has been removed — it had no wire
 * representation — so `force` is the only caller, and forcing PINS a value: the
 * program cannot overwrite it. A forced variable that has not taken the value
 * by the deadline means the target acked the PDU and the force did not land.
 *
 * Before this, `openplc-cli debug force main:flag FALSE` printed
 * `main:flag : BOOL = TRUE` and exited 0, so a harness asserting on the exit
 * code passed on a force that never applied.
 */

import type { DebugVariableIndex, ResolvedVariable } from '../debug/variables'
import { ErrorCode } from '../exit-codes'
import type { PlcControl } from '../session/session-core'
import { SessionCore } from '../session/session-core'

const variable: ResolvedVariable = { name: 'main:flag', index: 0, arr: 0, elem: 0, type: 'BOOL', size: 1 }

const plc: PlcControl = {
  start: () => Promise.resolve({ success: true }),
  stop: () => Promise.resolve({ success: true }),
  state: () => Promise.resolve('running' as const),
}

/**
 * A channel whose BOOL always reads TRUE, whatever is forced onto it — which is
 * what a force that does not land looks like from the outside.
 *
 * The clock is driven by the number of reads rather than by wall time, so the
 * 1500 ms settle window costs no real time and the test cannot flake on a slow
 * machine.
 */
/**
 * `getVariablesList` is injectable so a test can make the read FAIL without
 * reaching into the core's private `options.channel` through a cast. The
 * default is the always-TRUE read described above.
 */
type ReadOverride = () => Promise<{ success: false; error: string }>

function makeCore(readOverride?: ReadOverride) {
  let reads = 0
  const channel = {
    connect: () => Promise.resolve(),
    disconnect: () => undefined,
    getVariablesList: (indexes: number[]) => {
      if (readOverride) return readOverride()
      reads += 1
      return Promise.resolve({
        success: true as const,
        tick: 1,
        lastIndex: indexes.length - 1,
        data: new Uint8Array([1]),
      })
    },
    setVariable: () => Promise.resolve({ success: true as const }),
    getMd5Hash: () => Promise.resolve({ success: true as const, md5: 'abc', targetEndian: 'le' as const }),
  }

  const index: DebugVariableIndex = {
    md5: 'abc',
    warnings: [],
    all: [variable],
    byName: new Map([['MAIN:FLAG', variable]]),
    byIndex: new Map([[0, variable]]),
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
    // 400 ms of "elapsed" per read: the 1500 ms window closes after four.
    now: () => reads * 400,
  })
  return core
}

describe('force read-back', () => {
  it('reports a target error when the forced value never takes', async () => {
    const response = await makeCore().handle({ id: 1, kind: 'force', name: 'main:flag', value: 'FALSE' })

    expect(response.ok).toBe(false)
    if (response.ok) throw new Error('expected a failure')
    expect(response.error.code).toBe(ErrorCode.TargetError)
    // Names the variable and what it still reads, so the message is actionable.
    expect(response.error.message).toContain('main:flag')
    expect(response.error.message).toContain('did not take the value')
  })

  it('succeeds when the value does take', async () => {
    // Same channel, but forcing TRUE — which is what it already reads.
    const response = await makeCore().handle({ id: 1, kind: 'force', name: 'main:flag', value: 'TRUE' })

    expect(response.ok).toBe(true)
  })

  it('does not mark a refused force as [FORCED] in later reads', async () => {
    // `setVariable` succeeding only means the request was QUEUED on runtime v4;
    // the .so's refusal of a CONSTANT leaf lands later at the dispatcher's drain
    // and never travels back. Recording the force before the read-back had
    // confirmed it labelled a refused force `[FORCED]` for the rest of the
    // session — observed on an SLM-RP4 against a real `VAR CONSTANT`.
    const core = makeCore()
    await core.handle({ id: 1, kind: 'force', name: 'main:flag', value: 'FALSE' })

    const read = await core.handle({ id: 2, kind: 'read', names: ['main:flag'] })
    if (!read.ok) throw new Error('expected the read to succeed')
    // A guard, not an assertion: if the response shape ever changes, this fails
    // instead of silently reading `undefined` off the wrong branch and passing.
    if (read.data?.kind !== 'read') throw new Error(`expected a read payload, got ${String(read.data?.kind)}`)
    expect(read.data.values[0]?.forced).not.toBe(true)
  })

  it('still reports a read failure as a connection problem, not a target error', async () => {
    // The two failures are different: one means the channel died, the other
    // means the device answered and ignored us.
    const core = makeCore(() => Promise.resolve({ success: false as const, error: 'link down' }))

    const response = await core.handle({ id: 1, kind: 'force', name: 'main:flag', value: 'TRUE' })

    expect(response.ok).toBe(false)
    if (response.ok) throw new Error('expected a failure')
    expect(response.error.code).toBe(ErrorCode.NotConnected)
  })
})
