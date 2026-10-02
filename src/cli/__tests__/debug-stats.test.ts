/**
 * `debug stats`: each task's timing from a board in RTOS mode (FC 0x4e).
 */

import { parseArgs } from '../args'
import { buildRequest, parseReplLine, renderOk } from '../commands/debug'

const STATS = {
  tasks: [
    {
      name: 'MAINTASK',
      releases: 647,
      overruns: 0,
      scanMinUs: 2073,
      scanAvgUs: 2098,
      scanMaxUs: 2148,
      latencyAvgUs: 16,
      latencyMaxUs: 18,
      cycleMinUs: 9995,
      cycleMaxUs: 10005,
      stackFreeBytes: 14744,
      busyUs: 0,
      periodUs: 10000,
    },
    {
      name: 'NET_TASK',
      releases: 0,
      overruns: 150,
      scanMinUs: 0,
      scanAvgUs: 0,
      scanMaxUs: 0,
      latencyAvgUs: 0,
      latencyMaxUs: 0,
      cycleMinUs: 0,
      cycleMaxUs: 0,
      stackFreeBytes: 9000,
      busyUs: 3_000_000,
      periodUs: 20000,
    },
  ],
  services: [{ iterationMaxUs: 3655, busyReplies: 1, stackFreeBytes: 7040 }],
  dispatcherStackFreeBytes: 6188,
  heapFreeBytes: 250944,
  heapMinFreeBytes: 250660,
  baseTickUs: 10000,
  retainLateMaxUs: 1200,
}

describe('debug stats', () => {
  it('asks for a new window only with --reset', () => {
    expect(buildRequest('stats', parseArgs(['debug', 'stats']))).toEqual({
      request: { id: 1, kind: 'stats', reset: false },
    })
    expect(buildRequest('stats', parseArgs(['debug', 'stats', '--reset']))).toEqual({
      request: { id: 1, kind: 'stats', reset: true },
    })
  })

  it('shows a row per task and the board totals', () => {
    const text = renderOk({ id: 1, ok: true, data: { kind: 'stats', stats: STATS } })
    expect(text).toMatch(
      /MAINTASK\s+10,000\s+647\s+0\s+2,073 \/ 2,098 \/ 2,148\s+9,995 \/ 10,005\s+16 \/ 18\s+14,744 B\s+idle/,
    )
    expect(text).toMatch(/NET_TASK\s+20,000\s+0\s+150\s.*STUCK 3,000,000 us/)
    expect(text).toContain('base tick 10,000 us')
    expect(text).toContain('retain    saved late by up to 1,200 us')
    expect(text).toContain('debugger  longest pass 3,655 us, 1 busy replies since boot')
  })

  it('says a board that does not report its heap does not', () => {
    const text = renderOk({ id: 1, ok: true, data: { kind: 'stats', stats: { ...STATS, heapFreeBytes: 0 } } })
    expect(text).toContain('heap      not reported by this board')
  })

  it('is a command in the REPL and in exec scripts, with an optional reset', () => {
    expect(parseReplLine('stats', 4)).toEqual({ request: { id: 4, kind: 'stats', reset: false } })
    expect(parseReplLine('stats reset', 5)).toEqual({ request: { id: 5, kind: 'stats', reset: true } })
    expect(parseReplLine('stats now', 6)).toEqual({ error: 'stats takes one optional word: reset' })
  })
})
