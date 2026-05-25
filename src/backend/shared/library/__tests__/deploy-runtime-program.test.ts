import { deployRuntimeProgram } from '../deploy-runtime-program'
import type { RuntimeCompilationStatus } from '../poll-runtime-compilation'

function makeStatusFetcher(...responses: Array<RuntimeCompilationStatus | { error: string }>) {
  let i = 0
  return async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    if ('error' in r) return { success: false as const, error: r.error }
    return { success: true as const, data: r }
  }
}

function makeStartFetcher(...responses: Array<string | { error: string }>) {
  let i = 0
  return async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    if (typeof r === 'string') return { success: true as const, status: r }
    return { success: false as const, error: r.error }
  }
}

describe('deployRuntimeProgram', () => {
  it('uploads, polls to SUCCESS, then starts and resolves STARTED', async () => {
    const upload = jest.fn().mockResolvedValue({ success: true })
    const logs: Array<{ level: string; message: string }> = []

    const outcome = await deployRuntimeProgram({
      uploadProgram: upload,
      fetchCompilationStatus: makeStatusFetcher({
        status: 'SUCCESS',
        logs: ['runtime line 1'],
        exit_code: 0,
      }),
      fetchStartResponse: makeStartFetcher('START:OK'),
      onLog: (level, message) => logs.push({ level, message }),
      pollIntervalMs: 1,
      startIntervalMs: 1,
    })

    expect(outcome).toBe('STARTED')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(logs.find((l) => l.message === 'Program uploaded successfully to runtime.')).toBeTruthy()
    expect(logs.find((l) => l.message === 'PLC started.')).toBeTruthy()
  })

  it('returns UPLOAD_FAILED and never polls/starts when upload fails', async () => {
    const status = jest.fn()
    const start = jest.fn()
    const outcome = await deployRuntimeProgram({
      uploadProgram: async () => ({ success: false, error: 'ECONNRESET' }),
      fetchCompilationStatus: status,
      fetchStartResponse: start,
      onLog: () => {},
      pollIntervalMs: 1,
      startIntervalMs: 1,
    })
    expect(outcome).toBe('UPLOAD_FAILED')
    expect(status).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('returns BUILD_FAILED and never starts when the runtime build fails', async () => {
    const start = jest.fn()
    const outcome = await deployRuntimeProgram({
      uploadProgram: async () => ({ success: true }),
      fetchCompilationStatus: makeStatusFetcher({
        status: 'FAILED',
        logs: ['compile.sh exited 1'],
        exit_code: 1,
      }),
      fetchStartResponse: start,
      onLog: () => {},
      pollIntervalMs: 1,
    })
    expect(outcome).toBe('BUILD_FAILED')
    expect(start).not.toHaveBeenCalled()
  })

  it('returns BUILD_TIMEOUT when the poller never sees a terminal status', async () => {
    const start = jest.fn()
    const outcome = await deployRuntimeProgram({
      uploadProgram: async () => ({ success: true }),
      fetchCompilationStatus: async () => ({
        success: true,
        data: { status: 'COMPILING', logs: [], exit_code: null },
      }),
      fetchStartResponse: start,
      onLog: () => {},
      pollIntervalMs: 5,
      pollTimeoutMs: 15,
    })
    expect(outcome).toBe('BUILD_TIMEOUT')
    expect(start).not.toHaveBeenCalled()
  })

  it('returns BUILD_ERROR when status fetching exhausts the consecutive-error budget', async () => {
    const start = jest.fn()
    const outcome = await deployRuntimeProgram({
      uploadProgram: async () => ({ success: true }),
      fetchCompilationStatus: makeStatusFetcher({ error: 'a' }, { error: 'b' }, { error: 'c' }),
      fetchStartResponse: start,
      onLog: () => {},
      pollIntervalMs: 1,
      pollMaxConsecutiveErrors: 3,
    })
    expect(outcome).toBe('BUILD_ERROR')
    expect(start).not.toHaveBeenCalled()
  })

  it('returns START_FAILED when the runtime rejects the start command', async () => {
    const outcome = await deployRuntimeProgram({
      uploadProgram: async () => ({ success: true }),
      fetchCompilationStatus: makeStatusFetcher({ status: 'SUCCESS', logs: [], exit_code: 0 }),
      fetchStartResponse: makeStartFetcher('ERROR:INVALID_PROGRAM'),
      onLog: () => {},
      pollIntervalMs: 1,
      startIntervalMs: 1,
    })
    expect(outcome).toBe('START_FAILED')
  })

  it('returns START_TIMEOUT when the runtime answers BUSY past the deadline', async () => {
    const outcome = await deployRuntimeProgram({
      uploadProgram: async () => ({ success: true }),
      fetchCompilationStatus: makeStatusFetcher({ status: 'SUCCESS', logs: [], exit_code: 0 }),
      fetchStartResponse: async () => ({ success: true, status: 'COMMAND:BUSY' }),
      onLog: () => {},
      pollIntervalMs: 1,
      startIntervalMs: 5,
      startTimeoutMs: 15,
    })
    expect(outcome).toBe('START_TIMEOUT')
  })
})
