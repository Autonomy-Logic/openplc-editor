/**
 * `stats` through a debug session: the board's answer, and the three ways it
 * can fail told apart by error code, so a harness can branch on them.
 */

import type { RtosStatsResult } from '@root/middleware/shared/ports/types'

import type { DebugVariableIndex } from '../debug/variables'
import type { PlcControl } from '../session/session-core'
import { SessionCore } from '../session/session-core'

const STATS = {
  tasks: [],
  services: [],
  dispatcherStackFreeBytes: 0,
  heapFreeBytes: 0,
  heapMinFreeBytes: 0,
  baseTickUs: 10_000,
  retainLateMaxUs: 0,
}

const index: DebugVariableIndex = { md5: 'abc', warnings: [], all: [], byName: new Map(), byIndex: new Map() }

const plc: PlcControl = {
  start: () => Promise.resolve({ success: true }),
  stop: () => Promise.resolve({ success: true }),
  state: () => Promise.resolve('running' as const),
}

function coreWith(getTaskStats?: (reset?: boolean) => Promise<RtosStatsResult>) {
  return new SessionCore({
    sessionId: 'test',
    projectPath: '/tmp/project',
    target: 'Test Board',
    transport: 'rtu',
    descriptor: '/dev/null',
    channel: {
      connect: () => Promise.resolve(),
      disconnect: () => undefined,
      getVariablesList: () => Promise.resolve({ success: true, tick: 1, lastIndex: 0, data: new Uint8Array() }),
      setVariable: () => Promise.resolve({ success: true }),
      getMd5Hash: () => Promise.resolve({ success: true, md5: 'abc', targetEndian: 'le' as const }),
      ...(getTaskStats ? { getTaskStats } : {}),
    },
    index,
    plc,
    programMd5: 'abc',
    endian: 'le',
    batchSize: 8,
  })
}

describe('SessionCore — stats', () => {
  it('answers with the board’s statistics, passing the reset through', async () => {
    const read = jest.fn((_reset?: boolean) => Promise.resolve({ success: true, stats: STATS }))
    const response = await coreWith(read).handle({ id: 1, kind: 'stats', reset: true })
    expect(read).toHaveBeenCalledWith(true)
    expect(response).toEqual({ id: 1, ok: true, data: { kind: 'stats', stats: STATS } })
  })

  it('tells a board not in RTOS mode from a link that timed out and from any other failure', async () => {
    const unsupported = await coreWith(() =>
      Promise.resolve({ success: false, unsupported: true, error: 'no' }),
    ).handle({
      id: 1,
      kind: 'stats',
    })
    expect(unsupported).toMatchObject({ ok: false, error: { code: 'not_supported' } })

    const timedOut = await coreWith(() => Promise.resolve({ success: false, error: 'Request timeout' })).handle({
      id: 2,
      kind: 'stats',
    })
    expect(timedOut).toMatchObject({ ok: false, error: { code: 'timeout' } })

    const other = await coreWith(() => Promise.resolve({ success: false, error: 'CRC mismatch' })).handle({
      id: 3,
      kind: 'stats',
    })
    expect(other).toMatchObject({ ok: false, error: { code: 'target_error', message: 'CRC mismatch' } })
  })

  it('says a target that cannot report task statistics does not', async () => {
    const response = await coreWith().handle({ id: 1, kind: 'stats' })
    expect(response).toMatchObject({ ok: false, error: { code: 'target_error' } })
  })
})
