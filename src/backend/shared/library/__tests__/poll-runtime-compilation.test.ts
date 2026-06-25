import type { RuntimeCompilationStatus } from '../poll-runtime-compilation'
import { pollRuntimeCompilation } from '../poll-runtime-compilation'

/** Scripted fetchStatus — returns the i-th canned response on the
 *  i-th call.  Use `null` to simulate a comm failure. */
function scriptedFetch(responses: ReadonlyArray<RuntimeCompilationStatus | { error: string }>): {
  fetch: () => Promise<{ success: true; data: RuntimeCompilationStatus } | { success: false; error: string }>
  calls: () => number
} {
  let i = 0
  return {
    fetch: async () => {
      const r = responses[Math.min(i, responses.length - 1)]
      i += 1
      if ('error' in r) return { success: false as const, error: r.error }
      return { success: true as const, data: r }
    },
    calls: () => i,
  }
}

describe('pollRuntimeCompilation', () => {
  it('resolves SUCCESS the first time the runtime reports it', async () => {
    const { fetch } = scriptedFetch([{ status: 'SUCCESS', logs: ['ok'], exit_code: 0 }])
    const logs: Array<{ level: string; message: string }> = []
    const outcome = await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (level, message) => logs.push({ level, message }),
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('SUCCESS')
    expect(logs.some((l) => l.message === 'ok')).toBe(true)
    expect(logs[logs.length - 1].message).toContain('exit code: 0')
  })

  it('resolves FAILED when the runtime reports it', async () => {
    const { fetch } = scriptedFetch([{ status: 'FAILED', logs: ['err: stuff'], exit_code: 1 }])
    const logs: Array<{ level: string; message: string }> = []
    const outcome = await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (level, message) => logs.push({ level, message }),
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('FAILED')
    expect(logs[logs.length - 1].level).toBe('error')
    expect(logs[logs.length - 1].message).toContain('exit code: 1')
  })

  it('polls while status is COMPILING, then settles', async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 'COMPILING', logs: [], exit_code: null },
      { status: 'COMPILING', logs: ['line 1'], exit_code: null },
      { status: 'SUCCESS', logs: ['line 1', 'line 2'], exit_code: 0 },
    ])
    const messages: string[] = []
    const outcome = await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (_level, message) => messages.push(message),
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('SUCCESS')
    expect(calls()).toBe(3)
    expect(messages.slice(0, 2)).toEqual(['line 1', 'line 2'])
  })

  it('emits each log line only once (dedup by index)', async () => {
    const { fetch } = scriptedFetch([
      { status: 'COMPILING', logs: ['a'], exit_code: null },
      { status: 'COMPILING', logs: ['a', 'b'], exit_code: null },
      { status: 'SUCCESS', logs: ['a', 'b', 'c'], exit_code: 0 },
    ])
    const emitted: string[] = []
    await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (_level, message) => emitted.push(message),
      pollIntervalMs: 1,
    })
    // The three lines plus the trailing "completed successfully" summary.
    expect(emitted.filter((m) => m === 'a').length).toBe(1)
    expect(emitted.filter((m) => m === 'b').length).toBe(1)
    expect(emitted.filter((m) => m === 'c').length).toBe(1)
  })

  it('parses [ERROR] / [WARN] / [INFO] / [DEBUG] prefixes into the right level', async () => {
    const { fetch } = scriptedFetch([
      {
        status: 'SUCCESS',
        logs: ['[ERROR] something broke', '[WARN] heads up', '[DEBUG] noise', 'no prefix'],
        exit_code: 0,
      },
    ])
    const entries: Array<{ level: string; message: string }> = []
    await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (level, message) => entries.push({ level, message }),
      pollIntervalMs: 1,
    })
    expect(entries.find((e) => e.message === 'something broke')?.level).toBe('error')
    expect(entries.find((e) => e.message === 'heads up')?.level).toBe('warning')
    expect(entries.find((e) => e.message === 'noise')?.level).toBe('debug')
    expect(entries.find((e) => e.message === 'no prefix')?.level).toBe('info')
  })

  it('classifies and strips the prefix even when the runtime appends a trailing newline', async () => {
    // openplc-runtime appends "\n" to every entry it pushes into
    // build_state.logs (see webserver/plcapp_management.py — every
    // build_state.log(...) call passes a "\\n"-terminated f-string).
    // Earlier we anchored the body match with `$`, which JS without
    // the `m` flag refuses to match across a trailing newline; the
    // classifier then bailed and routed everything as level='info'
    // with the prefix preserved.  Console rendered errors blue.
    const { fetch } = scriptedFetch([
      {
        status: 'SUCCESS',
        logs: [
          "[ERROR] core/generated/c_blocks_code.cpp:97:1: error: 'asd' does not name a type\n",
          '[WARNING] PLC program has not been updated because the build failed\n',
          '[INFO] Compiling core/generated/pou_MAIN.cpp...\n',
          '[DEBUG] update_plugin_configurations called\n',
        ],
        exit_code: 0,
      },
    ])
    const entries: Array<{ level: string; message: string }> = []
    await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (level, message) => entries.push({ level, message }),
      pollIntervalMs: 1,
    })
    const err = entries.find((e) => e.message.startsWith('core/generated/'))
    expect(err?.level).toBe('error')
    expect(err?.message).toBe("core/generated/c_blocks_code.cpp:97:1: error: 'asd' does not name a type")
    expect(entries.find((e) => e.message.startsWith('PLC program'))?.level).toBe('warning')
    expect(entries.find((e) => e.message.startsWith('Compiling'))?.level).toBe('info')
    expect(entries.find((e) => e.message.startsWith('update_plugin'))?.level).toBe('debug')
    // No stray "\n" at the end of any classified message.
    expect(entries.every((e) => !/\n$/.test(e.message))).toBe(true)
  })

  it('bails with ERROR after maxConsecutiveErrors failures', async () => {
    const { fetch, calls } = scriptedFetch([
      { error: 'first' },
      { error: 'second' },
      { error: 'third' },
      { error: 'fourth' },
    ])
    const entries: Array<{ level: string; message: string }> = []
    const outcome = await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (level, message) => entries.push({ level, message }),
      pollIntervalMs: 1,
      maxConsecutiveErrors: 3,
    })
    expect(outcome).toBe('ERROR')
    expect(calls()).toBe(3)
    expect(entries[entries.length - 1].level).toBe('error')
    expect(entries[entries.length - 1].message).toContain('3 consecutive failures')
  })

  it('resets the consecutive-error counter on a successful poll', async () => {
    const { fetch } = scriptedFetch([
      { error: 'flake 1' },
      { error: 'flake 2' },
      { status: 'COMPILING', logs: [], exit_code: null },
      { error: 'flake 3' },
      { status: 'SUCCESS', logs: [], exit_code: 0 },
    ])
    const outcome = await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: () => {},
      pollIntervalMs: 1,
      maxConsecutiveErrors: 3,
    })
    expect(outcome).toBe('SUCCESS')
  })

  it('bails with TIMEOUT when the deadline elapses', async () => {
    // Always returns COMPILING — polling would never exit on its own.
    const fetch = async (): Promise<{ success: true; data: RuntimeCompilationStatus }> => ({
      success: true,
      data: { status: 'COMPILING', logs: [], exit_code: null },
    })
    const entries: Array<{ level: string; message: string }> = []
    const outcome = await pollRuntimeCompilation({
      fetchStatus: fetch,
      onLog: (level, message) => entries.push({ level, message }),
      pollIntervalMs: 5,
      timeoutMs: 15, // ~3 polls before deadline trips
    })
    expect(outcome).toBe('TIMEOUT')
    expect(entries[entries.length - 1].level).toBe('error')
    expect(entries[entries.length - 1].message).toContain('timed out')
  })
})
