import { ErrorCode, ExitCode } from '../exit-codes'
import { Reporter, resolveOutputMode, type WriterStreams } from '../output'

function capture(): { streams: WriterStreams; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { streams: { out: (t) => out.push(t), err: (t) => err.push(t) }, out, err }
}

describe('resolveOutputMode', () => {
  it('defaults to human at a TTY and json when piped', () => {
    // The whole point: a harness that forgot to pass --json still gets JSON.
    expect(resolveOutputMode({ isTTY: true })).toBe('human')
    expect(resolveOutputMode({ isTTY: false })).toBe('json')
  })

  it('lets an explicit flag override the guess in both directions', () => {
    expect(resolveOutputMode({ isTTY: true, json: true })).toBe('json')
    expect(resolveOutputMode({ isTTY: false, noJson: true })).toBe('human')
  })

  it('prefers --json when both flags are somehow present', () => {
    expect(resolveOutputMode({ isTTY: false, json: true, noJson: true })).toBe('json')
  })
})

describe('Reporter in json mode', () => {
  it('puts exactly one parseable document on stdout and nothing else', () => {
    const { streams, out, err } = capture()
    const reporter = new Reporter({ mode: 'json', streams })

    reporter.progress('compiling…')
    reporter.progress('linking…')
    const result = reporter.success({ artifacts: ['a.bin'] }, () => 'should not be used')

    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0])).toEqual({ ok: true, artifacts: ['a.bin'] })
    // Progress must not contaminate the result channel.
    expect(err).toEqual(['compiling…\n', 'linking…\n'])
    expect(result.exitCode).toBe(ExitCode.Ok)
  })

  it('reports a failure as a coded object on stdout with the caller exit code', () => {
    const { streams, out } = capture()
    const reporter = new Reporter({ mode: 'json', streams })

    const result = reporter.failure(
      { code: ErrorCode.CompileFailed, message: 'two errors', details: { errors: 2 } },
      ExitCode.CompileFailed,
    )

    expect(JSON.parse(out[0])).toEqual({
      ok: false,
      error: { code: 'compile_failed', message: 'two errors', details: { errors: 2 } },
    })
    expect(result.exitCode).toBe(ExitCode.CompileFailed)
  })

  it('suppresses progress under --quiet but still emits the result', () => {
    const { streams, out, err } = capture()
    const reporter = new Reporter({ mode: 'json', streams, quiet: true })

    reporter.progress('noise')
    reporter.success({}, () => '')

    expect(err).toEqual([])
    expect(out).toHaveLength(1)
  })

  it('maps an unexpected throw to an internal error rather than a usage error', () => {
    const { streams, out } = capture()
    const reporter = new Reporter({ mode: 'json', streams })

    const result = reporter.internalError(new Error('boom'))

    expect(JSON.parse(out[0]).error).toEqual({ code: 'internal', message: 'boom' })
    expect(result.exitCode).toBe(ExitCode.Internal)
  })

  it('describes a non-Error throw without losing it', () => {
    const { streams, out } = capture()
    new Reporter({ mode: 'json', streams }).internalError('just a string')
    expect(JSON.parse(out[0]).error.message).toBe('just a string')
  })

  it('exposes its mode so commands can skip building human strings', () => {
    const { streams } = capture()
    expect(new Reporter({ mode: 'json', streams }).isJson).toBe(true)
    expect(new Reporter({ mode: 'human', streams }).isJson).toBe(false)
  })
})

describe('Reporter in human mode', () => {
  it('renders the human form on stdout for a success', () => {
    const { streams, out } = capture()
    const reporter = new Reporter({ mode: 'human', streams })

    reporter.success({ artifacts: ['a.bin'] }, () => 'Built 1 artifact')

    expect(out).toEqual(['Built 1 artifact\n'])
  })

  it('sends a failure to stderr, where a human expects errors', () => {
    const { streams, out, err } = capture()
    const reporter = new Reporter({ mode: 'human', streams })

    reporter.failure({ code: ErrorCode.SessionNotFound, message: 'no such session' }, ExitCode.NotFound)

    expect(out).toEqual([])
    expect(err).toEqual(['error [session_not_found]: no such session\n'])
  })

  it('does not double the trailing newline the renderer already added', () => {
    const { streams, out } = capture()
    new Reporter({ mode: 'human', streams }).success({}, () => 'done\n')
    expect(out).toEqual(['done\n'])
  })
})
