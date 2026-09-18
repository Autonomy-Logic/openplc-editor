/**
 * The debug channel is ONE request/response link, and this session has two
 * actors on it: client requests, and the watch timer.
 *
 * `SessionServer` queues client requests for exactly that reason, but the timer
 * bypassed that queue and called the channel directly — so a sample could be in
 * flight while a read, a write, a force or an MD5 probe was in flight. Two
 * overlapping exchanges on a one-at-a-time link do not fail cleanly: the frames
 * interleave and BOTH replies decode wrong, which for a debugger means
 * confidently reporting values that were never on the wire. Nothing throws, and
 * no assertion outside these tests would notice.
 *
 * The other half is backpressure. The watch interval floor is 20 ms and a
 * batched RTU read takes far longer, so ticks that merely queue would pile up
 * and then all fire — a burst of samples stamped with the time they finally ran,
 * describing a signal that never looked like that.
 */

import type { DebugVariableIndex, ResolvedVariable } from '../debug/variables'
import type { PlcControl } from '../session/session-core'
import { SessionCore } from '../session/session-core'

/** A channel that records overlap: it fails the test itself if two calls run at once. */
function makeChannel(readDurationMs: number) {
  let inFlight = 0
  const overlaps: string[] = []
  const calls: string[] = []

  const enter = (label: string) => {
    calls.push(label)
    inFlight += 1
    if (inFlight > 1) overlaps.push(label)
  }
  const leave = () => {
    inFlight -= 1
  }
  const after = <T>(label: string, value: T, ms: number): Promise<T> => {
    enter(label)
    return new Promise<T>((resolve) => {
      setTimeout(() => {
        leave()
        resolve(value)
      }, ms)
    })
  }

  return {
    overlaps,
    calls,
    channel: {
      connect: () => Promise.resolve(),
      disconnect: () => undefined,
      // One BOOL, value 1: `data` is the payload the walker decodes.
      getVariablesList: (indexes: number[]) =>
        after(
          'read',
          { success: true, tick: 1, lastIndex: indexes.length - 1, data: new Uint8Array([1]) },
          readDurationMs,
        ),
      setVariable: () => after('set', { success: true }, 5),
      getMd5Hash: () => after('md5', { success: true, md5: 'abc', targetEndian: 'le' as const }, 5),
    },
  }
}

const variable: ResolvedVariable = { name: 'main:flag', index: 0, arr: 0, elem: 0, type: 'BOOL', size: 1 }

function makeIndex(): DebugVariableIndex {
  return {
    md5: 'abc',
    warnings: [],
    all: [variable],
    byName: new Map([['MAIN:FLAG', variable]]),
    byIndex: new Map([[0, variable]]),
  }
}

const plc: PlcControl = {
  start: () => Promise.resolve({ success: true }),
  stop: () => Promise.resolve({ success: true }),
  state: () => Promise.resolve('running' as const),
}

function makeCore(readDurationMs: number) {
  const { channel, overlaps, calls } = makeChannel(readDurationMs)
  const core = new SessionCore({
    sessionId: 'test',
    projectPath: '/tmp/project',
    target: 'Test Board',
    transport: 'rtu',
    descriptor: '/dev/null',
    channel,
    index: makeIndex(),
    plc,
    programMd5: 'abc',
    endian: 'le',
    batchSize: 8,
  })
  return { core, overlaps, calls }
}

const flush = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('SessionCore — one channel, one exchange at a time', () => {
  it('never lets a watch sample overlap a client request', async () => {
    const { core, overlaps } = makeCore(30)

    await core.handle({ id: 1, kind: 'watch', names: ['main:flag'], intervalMs: 20 })

    // Hammer the channel with client requests while the timer samples. Every
    // one of these touches the channel, and the sampler is on a 20 ms tick with
    // a 30 ms read — guaranteed contention if nothing serialises them.
    const requests = [
      core.handle({ id: 2, kind: 'read', names: ['main:flag'] }),
      core.handle({ id: 3, kind: 'status' }),
      core.handle({ id: 4, kind: 'read', names: ['main:flag'] }),
      core.handle({ id: 5, kind: 'status' }),
    ]
    await flush(150)
    await Promise.all(requests)
    await core.handle({ id: 6, kind: 'unwatch' })
    await flush(60)

    expect(overlaps).toEqual([])
  })

  it('drops a tick instead of stacking samples when a read outlasts the interval', async () => {
    const { core, calls } = makeCore(60)

    await core.handle({ id: 1, kind: 'watch', names: ['main:flag'], intervalMs: 20 })
    await flush(260)
    await core.handle({ id: 2, kind: 'unwatch' })

    const reads = calls.filter((call) => call === 'read').length
    // ~260 ms of 60 ms reads is at most ~5. Queued ticks would have produced 13.
    expect(reads).toBeLessThanOrEqual(6)
    expect(reads).toBeGreaterThan(1)
  })

  it('stops sampling once the session is closed, even for a tick already queued', async () => {
    const { core, calls } = makeCore(30)

    await core.handle({ id: 1, kind: 'watch', names: ['main:flag'], intervalMs: 20 })
    await flush(50)
    const before = calls.length
    await core.closeFromOutsideRequest(false)
    await flush(120)

    // The close waits for the in-flight exchange, then nothing further runs.
    expect(calls.length).toBeLessThanOrEqual(before + 1)
  })
})
