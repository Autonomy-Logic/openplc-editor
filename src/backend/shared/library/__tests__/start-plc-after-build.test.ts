import { startPlcAfterBuild } from '../start-plc-after-build'

/** Scripted fetch: returns the i-th canned reply on the i-th call.
 *  Each reply is either a status string (success) or { error }
 *  (network failure). */
function scriptedFetch(replies: ReadonlyArray<string | { error: string }>): {
  fetch: () => Promise<{ success: true; status: string } | { success: false; error: string }>
  calls: () => number
} {
  let i = 0
  return {
    fetch: async () => {
      const r = replies[Math.min(i, replies.length - 1)]
      i += 1
      if (typeof r === 'string') return { success: true as const, status: r }
      return { success: false as const, error: r.error }
    },
    calls: () => i,
  }
}

describe('startPlcAfterBuild', () => {
  it('resolves STARTED on START:OK first try', async () => {
    const { fetch, calls } = scriptedFetch(['STATUS: START:OK'])
    const logs: Array<{ level: string; message: string }> = []
    const outcome = await startPlcAfterBuild({
      fetchStart: fetch,
      onLog: (level, message) => logs.push({ level, message }),
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('STARTED')
    expect(calls()).toBe(1)
    expect(logs[logs.length - 1]).toEqual({ level: 'info', message: 'PLC started.' })
  })

  it('treats ALREADY_RUNNING as a successful start', async () => {
    const { fetch } = scriptedFetch(['ALREADY_RUNNING'])
    const outcome = await startPlcAfterBuild({
      fetchStart: fetch,
      onLog: () => {},
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('STARTED')
  })

  it('retries while runtime answers BUSY, then settles on START:OK', async () => {
    const { fetch, calls } = scriptedFetch(['COMMAND:BUSY', 'COMMAND:BUSY', 'START:OK'])
    const outcome = await startPlcAfterBuild({
      fetchStart: fetch,
      onLog: () => {},
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('STARTED')
    expect(calls()).toBe(3)
  })

  it('bails with FAILED on a non-BUSY error reply', async () => {
    const { fetch, calls } = scriptedFetch(['ERROR:INVALID_PROGRAM'])
    const logs: Array<{ level: string; message: string }> = []
    const outcome = await startPlcAfterBuild({
      fetchStart: fetch,
      onLog: (level, message) => logs.push({ level, message }),
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('FAILED')
    expect(calls()).toBe(1)
    expect(logs[logs.length - 1].level).toBe('error')
    expect(logs[logs.length - 1].message).toContain('ERROR:INVALID_PROGRAM')
  })

  it('bails with FAILED on a network error', async () => {
    const { fetch } = scriptedFetch([{ error: 'ECONNRESET' }])
    const logs: Array<{ level: string; message: string }> = []
    const outcome = await startPlcAfterBuild({
      fetchStart: fetch,
      onLog: (level, message) => logs.push({ level, message }),
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('FAILED')
    expect(logs[logs.length - 1].level).toBe('error')
    expect(logs[logs.length - 1].message).toContain('ECONNRESET')
  })

  it('bails with TIMEOUT after the deadline elapses on continual BUSY', async () => {
    // Always BUSY — loop would never exit on its own.
    const fetch = async (): Promise<{ success: true; status: string }> => ({
      success: true,
      status: 'COMMAND:BUSY',
    })
    const logs: Array<{ level: string; message: string }> = []
    const outcome = await startPlcAfterBuild({
      fetchStart: fetch,
      onLog: (level, message) => logs.push({ level, message }),
      pollIntervalMs: 5,
      timeoutMs: 15,
    })
    expect(outcome).toBe('TIMEOUT')
    expect(logs[logs.length - 1].level).toBe('warning')
    expect(logs[logs.length - 1].message).toContain('runtime remained busy')
  })

  it('treats empty status as a terminal failure (defensive)', async () => {
    const { fetch } = scriptedFetch([''])
    const outcome = await startPlcAfterBuild({
      fetchStart: fetch,
      onLog: () => {},
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('FAILED')
  })
})
