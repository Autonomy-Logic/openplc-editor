import type { DebugBoardIdResult } from '@root/backend/shared/debug/types'

import { classifyDeviceLink, FALLBACK_BAUD_RATES, planBaudAttempts, readBoardIdWithRetries } from '../device-probe'

/**
 * A channel that answers the board-id read (FC 0x48) according to a script, so
 * the classification can be tested without a board.
 */
function fakeChannel(script: DebugBoardIdResult[]) {
  const calls: number[] = []
  let index = 0
  return {
    calls,
    getBoardId: (): Promise<DebugBoardIdResult> => {
      calls.push(index)
      const answer = script[Math.min(index, script.length - 1)]
      index += 1
      return Promise.resolve(answer)
    },
  }
}

const ANSWERED: DebugBoardIdResult = { success: true, boardId: Uint8Array.from([1, 2, 3, 4]) }
/** Opened, but nothing spoke the debug protocol — a blank board, or a wrong baud. */
const SILENT: DebugBoardIdResult = { success: false }
/** Answered the frame but reported no unique id (a core without ArduinoUniqueID). */
const EMPTY_ID: DebugBoardIdResult = { success: true, boardId: Uint8Array.from([]) }

describe('planBaudAttempts', () => {
  it('leads with the configured rate, then sweeps the rest', () => {
    const plan = planBaudAttempts(9600)

    expect(plan[0]).toEqual({ baudRate: 9600, speculative: false })
    expect(plan.slice(1).every((attempt) => attempt.speculative)).toBe(true)
    // The configured rate is never repeated as a guess.
    expect(plan.filter((attempt) => attempt.baudRate === 9600)).toHaveLength(1)
    expect(plan).toHaveLength(FALLBACK_BAUD_RATES.length)
  })

  it('covers every fallback rate exactly once', () => {
    const rates = planBaudAttempts(115200).map((attempt) => attempt.baudRate)

    expect(new Set(rates).size).toBe(rates.length)
    for (const rate of FALLBACK_BAUD_RATES) expect(rates).toContain(rate)
  })

  it('does not sweep an endpoint with no baud rate (TCP / WebSocket)', () => {
    expect(planBaudAttempts(undefined)).toEqual([{ baudRate: undefined, speculative: false }])
  })

  it('does not sweep when the caller opts out', () => {
    // The debug channel of an established session: the rate is already settled,
    // so re-opening the port at other rates would be wrong, not merely wasteful.
    expect(planBaudAttempts(9600, { sweep: false })).toEqual([{ baudRate: 9600, speculative: false }])
  })

  it('keeps a rate that is not in the fallback list as the leading attempt', () => {
    const plan = planBaudAttempts(4800)

    expect(plan[0]).toEqual({ baudRate: 4800, speculative: false })
    expect(plan).toHaveLength(FALLBACK_BAUD_RATES.length + 1)
  })
})

describe('readBoardIdWithRetries', () => {
  it('stops at the first answer', async () => {
    const channel = fakeChannel([ANSWERED])
    const result = await readBoardIdWithRetries(channel, { attempts: 6, backoffMs: 0 })

    expect(result.success).toBe(true)
    expect(channel.calls).toHaveLength(1)
  })

  it('retries a silent port up to the budget — a board can still be booting', async () => {
    const channel = fakeChannel([SILENT, SILENT, ANSWERED])
    const result = await readBoardIdWithRetries(channel, { attempts: 3, backoffMs: 0 })

    expect(result.success).toBe(true)
    expect(channel.calls).toHaveLength(3)
  })

  it('spends no more than the budget allows', async () => {
    const channel = fakeChannel([SILENT])
    const result = await readBoardIdWithRetries(channel, { attempts: 2, backoffMs: 0 })

    expect(result.success).toBe(false)
    expect(channel.calls).toHaveLength(2)
  })
})

describe('classifyDeviceLink', () => {
  it('keeps a channel a firmware answered on', async () => {
    const result = await classifyDeviceLink(fakeChannel([ANSWERED]), { boardIdProbe: { attempts: 1, backoffMs: 0 } })

    expect(result).toEqual({ status: 'connected-with-firmware' })
  })

  // This is what a WRONG BAUD looks like from here: the port opened, so the
  // transport is fine, and nothing decoded. Reporting it as `no-firmware` is what
  // lets the caller fall through to the next rate instead of keeping a dead link.
  it('reports no-firmware when the channel opens but nothing answers', async () => {
    const result = await classifyDeviceLink(fakeChannel([SILENT]), { boardIdProbe: { attempts: 1, backoffMs: 0 } })

    expect(result).toEqual({ status: 'no-firmware' })
  })

  it('reports no-firmware when the frame came back with an empty id', async () => {
    const result = await classifyDeviceLink(fakeChannel([EMPTY_ID]), { boardIdProbe: { attempts: 1, backoffMs: 0 } })

    expect(result).toEqual({ status: 'no-firmware' })
  })

  it('never throws — a transport that blows up resolves to an error status', async () => {
    const result = await classifyDeviceLink(
      { getBoardId: () => Promise.reject(new Error('port disappeared')) },
      { boardIdProbe: { attempts: 1, backoffMs: 0 } },
    )

    expect(result).toEqual({ status: 'error', error: 'port disappeared' })
  })
})
