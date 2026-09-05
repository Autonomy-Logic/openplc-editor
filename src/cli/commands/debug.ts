/**
 * `openplc-cli debug …` — the session-first debugger.
 *
 * Every subcommand here is a CLIENT of the session protocol. `open` forks a
 * daemon and registers its `session_id`; everything else dials that session's
 * socket, sends one request, prints one reply. The REPL is the same thing in a
 * loop over readline.
 *
 * That is what stops the REPL and the scripted path from drifting: there is no
 * code path a human can reach that a test cannot, because both produce
 * `Request`s and neither touches the debug channel directly.
 */

import { readFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { boolFlag, listFlag, type ParsedArgs, stringFlag } from '../args'
import { resolveRuntimeCredentials } from '../credentials'
import { formatValue, formatVariableList } from '../debug/format'
import { ErrorCode, type ErrorCodeValue, ExitCode, type ExitCodeValue } from '../exit-codes'
import { type CliResult, renderTable, type Reporter } from '../output'
import { sendRequest } from '../session/client'
import type { OkResponse, Request, Response } from '../session/protocol'
import { type SessionRecord, SessionRegistry } from '../session/registry'

export interface DebugContext {
  registry: SessionRegistry
  /** Spawns the daemon process for `debug open`. */
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>
}

export interface SpawnSessionOptions {
  projectPath: string
  target: string
  /** Runtime address. Empty for a target reached over serial. */
  host: string
  /** Serial port. Empty for a target reached over the network. */
  port: string
  username: string
  password: string
  uploadIfNeeded: boolean
  idleTimeoutMs: number
  onProgress: (message: string) => void
}

/**
 * Why opening a session failed.
 *
 * ONE named union, referenced by the spawn result, the daemon handshake and the
 * error-code mapper. It used to be spelled out inline in three places with
 * different members: `openDebugSession` could return `unsupported`, the
 * handshake validator did not accept it, and the mapper's ternary chain fell
 * through to `internal` — so an unknown board name exited 70, documented as
 * "a bug in the CLI, not in the caller's input".
 */
export const SPAWN_FAILURE_CODES = [
  'auth',
  'connection',
  'md5',
  'upload',
  'not-compiled',
  'unsupported',
  'internal',
] as const

export type SpawnFailureCode = (typeof SPAWN_FAILURE_CODES)[number]

export type SpawnSessionResult =
  | { success: true; record: SessionRecord }
  | { success: false; code: SpawnFailureCode; error: string }

/** Map a session-side error code onto the process exit code a caller branches on. */
/**
 * `--idle-timeout` in milliseconds: omitted means the default, `0` means never.
 *
 * A rejected value is a usage error rather than a silent fallback — the whole
 * point of naming a timeout is that the default was wrong for this run, and
 * quietly restoring it is the one answer that cannot be right.
 */
export function parseIdleTimeout(raw: string | undefined): { value: number } | { error: string } {
  if (raw === undefined) return { value: DEFAULT_IDLE_TIMEOUT_MS }
  // Empty is rejected explicitly, because `Number('')` is 0 and 0 is meaningful
  // here: `--idle-timeout=` would otherwise have meant "never close".
  if (raw.trim() === '') {
    return { error: '--idle-timeout needs a value in milliseconds (0 disables it)' }
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: `--idle-timeout must be a number of milliseconds (0 disables it); got "${raw}"` }
  }
  return { value: parsed }
}

export function exitCodeForError(code: string): ExitCodeValue {
  switch (code) {
    case ErrorCode.SessionNotFound:
    case ErrorCode.VariableNotFound:
      return ExitCode.NotFound
    case ErrorCode.NotConnected:
      return ExitCode.Connection
    case ErrorCode.AuthRejected:
    case ErrorCode.AuthRequired:
      return ExitCode.Auth
    case ErrorCode.Timeout:
      return ExitCode.Timeout
    case ErrorCode.InvalidArgument:
    case ErrorCode.ValueInvalid:
    case ErrorCode.MissingArgument:
      return ExitCode.Usage
    case ErrorCode.TargetError:
    case ErrorCode.UploadRejected:
    case ErrorCode.Md5Mismatch:
      return ExitCode.TargetError
    // A board this build does not know, or a project not compiled for it, is
    // something the CALLER named — the same class `compile` already exits 3 for.
    // Without these they fell through to 70, which this CLI documents as "a bug
    // in the CLI, not in the caller's input": the same typo answered 3 from
    // `compile` and 70 from `debug open`.
    case ErrorCode.TargetUnknown:
    case ErrorCode.ProjectInvalid:
    case ErrorCode.ProjectNotFound:
      return ExitCode.NotFound
    default:
      return ExitCode.Internal
  }
}

/**
 * Map a session-spawn failure onto a stable `ErrorCode`.
 *
 * An exhaustive switch, not a ternary chain: `SpawnSessionResult['code']` is a
 * string-literal union, so adding a code becomes a compile error here instead of
 * silently falling through to `Internal` — which is how `unsupported` came to
 * report exit 70 ("a bug in the CLI") for a plain unknown-board typo.
 */
function errorCodeForSpawnFailure(code: SpawnFailureCode): ErrorCodeValue {
  switch (code) {
    case 'auth':
      return ErrorCode.AuthRejected
    case 'connection':
      return ErrorCode.NotConnected
    case 'md5':
      return ErrorCode.Md5Mismatch
    case 'upload':
      return ErrorCode.UploadRejected
    case 'not-compiled':
      return ErrorCode.ProjectInvalid
    case 'unsupported':
      return ErrorCode.TargetUnknown
    case 'internal':
      return ErrorCode.Internal
  }
}

export async function runDebug(args: ParsedArgs, reporter: Reporter, context: DebugContext): Promise<CliResult> {
  switch (args.subcommand) {
    case 'open':
      return runOpen(args, reporter, context)
    case 'list':
      return runList(reporter, context)
    case 'close':
      return runClose(args, reporter, context)
    case 'repl':
      return runRepl(args, reporter, context)
    case 'exec':
      return runExec(args, reporter, context)
    case 'status':
    case 'list-vars':
    case 'read':
    case 'force':
    case 'unforce':
    case 'start':
    case 'stop':
    case 'watch':
    case 'poll':
    case 'unwatch':
      return runOneShot(args.subcommand, args, reporter, context)
    case undefined:
      return reporter.failure(
        {
          code: ErrorCode.MissingArgument,
          message:
            'Name a debug subcommand: open, list, close, status, list-vars, read, force, unforce, start, stop, watch, poll, unwatch, repl',
        },
        ExitCode.Usage,
      )
    default:
      return reporter.failure(
        { code: ErrorCode.UnknownCommand, message: `Unknown debug subcommand "${args.subcommand}"` },
        ExitCode.Usage,
      )
  }
}

// ---------------------------------------------------------------------------
// open / list / close — session lifecycle
// ---------------------------------------------------------------------------

async function runOpen(args: ParsedArgs, reporter: Reporter, context: DebugContext): Promise<CliResult> {
  const projectPath = args.positionals[0] ?? stringFlag(args, 'project')
  const host = stringFlag(args, 'host') ?? stringFlag(args, 'address')
  const port = stringFlag(args, 'port')
  const target = stringFlag(args, 'target')
  if (!projectPath) {
    return reporter.failure(
      {
        code: ErrorCode.MissingArgument,
        message:
          'debug open needs a project path, plus --host <address> for a runtime target or --port <serial> for a ' +
          'board (see `openplc-cli devices`)',
      },
      ExitCode.Usage,
    )
  }

  // Credentials are required only by targets controlled over a runtime API. A
  // board on a serial port has nothing to log in to, and demanding a password
  // for it would be a rule the editor does not have.
  // The project remembers its board, and `runBuild` already falls back to it.
  // `debug open` did not, so it reached the daemon with `target: ''` and failed
  // with `Board "" is not available` on a project `compile` builds fine.
  const resolvedTarget = target ?? (await projectBoard(projectPath))
  if (!resolvedTarget) {
    return reporter.failure(
      {
        code: ErrorCode.MissingArgument,
        message: `This project names no board — pass --target (see \`openplc-cli devices\`)`,
      },
      ExitCode.Usage,
    )
  }

  const credentials = host ? resolveRuntimeCredentials(args) : { username: '', password: '' }
  if ('error' in credentials) {
    return reporter.failure({ code: ErrorCode.MissingArgument, message: credentials.error }, ExitCode.Usage)
  }

  // Reuse before opening: a target that serves one client at a time simply
  // never answers a second connection, and the failure reads as a bare timeout
  // while a perfectly good session sits idle.
  if (!boolFlag(args, 'force-new')) {
    const existing = context.registry.findReusable(projectPath, resolvedTarget)
    if (existing) {
      reporter.progress(`Reusing session ${existing.sessionId} for the same project and target`)
      return reporter.success(
        { sessionId: existing.sessionId, reused: true, target: existing.target, projectPath: existing.projectPath },
        () => `${existing.sessionId} (reused)`,
      )
    }
  }

  // B2: parsed, not coerced. `Number(x) || DEFAULT` sent `--idle-timeout 0` to
  // the default (0 is falsy) — so "no idle timeout", which the server supports
  // via `timeout <= 0`, was unreachable — and turned `--idle-timeout 5min` into
  // a silent 30 minutes. A soak test that asked for no timeout had its session
  // closed mid-run, releasing its forces on live hardware.
  const idleTimeout = parseIdleTimeout(stringFlag(args, 'idle-timeout'))
  if ('error' in idleTimeout) {
    return reporter.failure({ code: ErrorCode.InvalidArgument, message: idleTimeout.error }, ExitCode.Usage)
  }

  const spawned = await context.spawnSession({
    projectPath,
    target: resolvedTarget,
    host: host ?? '',
    port: port ?? '',
    username: credentials.username,
    password: credentials.password,
    uploadIfNeeded: boolFlag(args, 'upload-if-needed'),
    idleTimeoutMs: idleTimeout.value,
    onProgress: (message) => reporter.progress(message),
  })

  if (!spawned.success) {
    const code = errorCodeForSpawnFailure(spawned.code)
    return reporter.failure({ code, message: spawned.error }, exitCodeForError(code))
  }

  const record = spawned.record
  return reporter.success(
    {
      sessionId: record.sessionId,
      reused: false,
      target: record.target,
      projectPath: record.projectPath,
      programMd5: record.programMd5,
      socketPath: record.socketPath,
    },
    () => record.sessionId,
  )
}

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** Short, because `list` must stay responsive even if one session is busy. */
const LIST_STATUS_TIMEOUT_MS = 5000

async function runList(reporter: Reporter, context: DebugContext): Promise<CliResult> {
  // Reaping first means the listing never advertises a session nobody is
  // listening on — an operator reads this to find forces that need clearing.
  const reaped = context.registry.reapStale()
  const records = context.registry.list()

  // Ask each live session for its state. The registry record cannot carry this:
  // PLC state and the forced set change constantly, and a stale copy on disk
  // would be worse than none. This is the whole reason an operator reads the
  // list — "which session is holding a force I need to clear" — so the columns
  // are worth one round trip each. A session that fails to answer is still
  // listed, with its live columns blank.
  const sessions = await Promise.all(
    records.map(async (record) => {
      const result = await sendRequest(
        record.socketPath,
        { id: 1, kind: 'status', probe: true },
        LIST_STATUS_TIMEOUT_MS,
      )
      if (!result.success || !result.response.ok || result.response.data.kind !== 'status') {
        return { ...record, plcState: 'unknown' as const, forced: [] as string[], answered: false }
      }
      const status = result.response.data.status
      return { ...record, plcState: status.plcState, forced: status.forced, answered: true }
    }),
  )

  return Promise.resolve(
    reporter.success({ sessions, reaped }, () => {
      const lines: string[] = []
      if (reaped.length > 0) {
        lines.push(`Cleaned ${reaped.length} stale session(s): ${reaped.join(', ')}`)
        lines.push('(a session that died may have left variables forced on its target)')
        lines.push('')
      }
      if (sessions.length === 0) {
        lines.push('No open debug sessions.')
        return lines.join('\n')
      }
      lines.push(
        renderTable(
          ['SESSION', 'TARGET', 'MD5', 'PLC', 'FORCED', 'PROJECT'],
          sessions.map((session) => [
            session.sessionId,
            session.target || '-',
            (session.programMd5 ?? '-').slice(0, 8),
            session.answered ? session.plcState : '(no answer)',
            session.forced.length > 0 ? session.forced.join(', ') : '-',
            session.projectPath,
          ]),
        ),
      )
      return lines.join('\n')
    }),
  )
}

async function runClose(args: ParsedArgs, reporter: Reporter, context: DebugContext): Promise<CliResult> {
  const releaseForces = !boolFlag(args, 'keep-forces')
  const closeAll = boolFlag(args, 'all')

  // The missing-argument case returns early, so `targets` is a plain list.
  // Encoding three outcomes in `undefined` / `[]` / `[record]` made the next
  // line's check the only thing separating a usage error from a silent no-op.
  const sessionId = stringFlag(args, 'session') ?? args.positionals[0]
  if (!closeAll && !sessionId) {
    return reporter.failure(
      { code: ErrorCode.MissingArgument, message: 'debug close needs --session <id> or --all' },
      ExitCode.Usage,
    )
  }

  const targets: SessionRecord[] = closeAll
    ? context.registry.list()
    : [context.registry.get(sessionId ?? '')].filter((record): record is SessionRecord => record !== undefined)

  const closed: Array<{ sessionId: string; released: string[] }> = []
  // `recordRemoved` because the two failures are not the same outcome: a daemon
  // that is GONE loses its record, a daemon that merely did not answer in time
  // keeps it and stays closable by id. Reporting both as "record removed" told
  // the caller its only handle on a live session was gone when it was not.
  const failed: Array<{ sessionId: string; error: string; recordRemoved: boolean }> = []

  for (const record of targets) {
    const result = await sendRequest(record.socketPath, { id: 1, kind: 'close', releaseForces })
    if (!result.success) {
      // Only drop the record when the daemon is genuinely GONE. A timeout means
      // it did not answer within the window, which a busy session can hit — and
      // deleting its record there strands a live daemon still holding the
      // device, with no id left to close it by.
      const recordRemoved = result.unreachable === true
      if (recordRemoved) context.registry.unregister(record.sessionId)
      failed.push({ sessionId: record.sessionId, error: result.error, recordRemoved })
      continue
    }
    const released = result.response.ok && result.response.data.kind === 'close' ? result.response.data.released : []
    context.registry.unregister(record.sessionId)
    closed.push({ sessionId: record.sessionId, released })
  }

  const reaped = context.registry.reapStale()

  // A1: `failed` is not a success. A session that will not answer keeps its
  // forces PINNED on a live PLC — the outcome the release-on-close rule exists
  // to prevent — and exiting 0 told a harness the opposite. The JSON said so all
  // along; the exit code is what callers are told to branch on.
  const render = () => {
    const lines: string[] = []
    for (const entry of closed) {
      lines.push(
        entry.released.length > 0
          ? `Closed ${entry.sessionId}, released ${entry.released.length} force(s): ${entry.released.join(', ')}`
          : `Closed ${entry.sessionId}`,
      )
    }
    for (const entry of failed) {
      lines.push(
        `${entry.sessionId}: ${entry.error} ${entry.recordRemoved ? '(record removed)' : '(record retained — still closable by id)'}`,
      )
    }
    if (lines.length === 0) lines.push('Nothing to close.')
    return lines.join('\n')
  }

  if (failed.length === 0) return reporter.success({ closed, failed, reaped }, render)

  return reporter.partial(
    { closed, failed, reaped },
    {
      code: ErrorCode.TargetError,
      message: `${failed.length} session(s) could not be closed`,
      details: { failed },
    },
    ExitCode.TargetError,
    render,
  )
}

// ---------------------------------------------------------------------------
// One-shot commands
// ---------------------------------------------------------------------------

async function runOneShot(
  kind: Exclude<Request['kind'], 'close'>,
  args: ParsedArgs,
  reporter: Reporter,
  context: DebugContext,
): Promise<CliResult> {
  const resolved = resolveSession(args, context)
  if ('error' in resolved) {
    return reporter.failure({ code: ErrorCode.SessionNotFound, message: resolved.error }, ExitCode.NotFound)
  }

  const request = buildRequest(kind, args)
  if ('error' in request) {
    return reporter.failure({ code: ErrorCode.MissingArgument, message: request.error }, ExitCode.Usage)
  }

  const result = await sendRequest(resolved.record.socketPath, request.request)
  if (!result.success) {
    return reporter.failure({ code: ErrorCode.NotConnected, message: result.error }, ExitCode.Connection)
  }
  return report(reporter, result.response)
}

/**
 * Which session a command talks to: `--session`, or the only open one.
 *
 * Defaulting to the sole session is what makes an interactive sequence bearable
 * without making a multi-session script ambiguous — with more than one open, the
 * id becomes required rather than guessed.
 */
export function resolveSession(args: ParsedArgs, context: DebugContext): { record: SessionRecord } | { error: string } {
  const sessionId = stringFlag(args, 'session')
  if (sessionId) {
    const record = context.registry.get(sessionId)
    return record ? { record } : { error: `No live session "${sessionId}" (it may have exited; run \`debug list\`)` }
  }
  const sessions = context.registry.list()
  if (sessions.length === 1) return { record: sessions[0] }
  if (sessions.length === 0) return { error: 'No open debug sessions — run `openplc-cli debug open` first' }
  return {
    error: `${sessions.length} sessions are open; name one with --session (${sessions.map((s) => s.sessionId).join(', ')})`,
  }
}

/** Turn CLI flags into a protocol request. */
export function buildRequest(
  kind: Exclude<Request['kind'], 'close'>,
  args: ParsedArgs,
): { request: Request } | { error: string } {
  const id = 1
  const names = [...args.positionals, ...listFlag(args, 'var')]

  switch (kind) {
    case 'status':
      return { request: { id, kind } }
    case 'list-vars':
      return { request: { id, kind, filter: stringFlag(args, 'filter') ?? args.positionals[0] } }
    case 'read':
      if (names.length === 0) return { error: 'read needs at least one variable name' }
      return { request: { id, kind, names } }
    case 'force': {
      const name = args.positionals[0] ?? stringFlag(args, 'var')
      const value = args.positionals[1] ?? stringFlag(args, 'value')
      if (!name || value === undefined) return { error: `${kind} needs a variable name and a value` }
      return { request: { id, kind, name, value } }
    }
    case 'unforce': {
      const name = args.positionals[0] ?? stringFlag(args, 'var')
      if (!name) return { error: 'unforce needs a variable name' }
      return { request: { id, kind, name } }
    }
    case 'start':
    case 'stop':
      return { request: { id, kind } }
    case 'watch': {
      if (names.length === 0) return { error: 'watch needs at least one variable name' }
      const interval = stringFlag(args, 'interval')
      return { request: { id, kind, names, intervalMs: interval ? Number(interval) : undefined } }
    }
    case 'poll': {
      const since = stringFlag(args, 'since')
      return { request: { id, kind, since: since ? Number(since) : undefined } }
    }
    case 'unwatch':
      return { request: { id, kind, names: names.length > 0 ? names : undefined } }
  }
}

/** Render a response in both modes. */
function report(reporter: Reporter, response: Response): CliResult {
  if (!response.ok) {
    return reporter.failure(
      { code: coerceErrorCode(response.error.code), message: response.error.message, details: response.error.details },
      exitCodeForError(response.error.code),
    )
  }
  return reporter.success(payloadOf(response), () => renderOk(response))
}

function coerceErrorCode(code: string): (typeof ErrorCode)[keyof typeof ErrorCode] {
  const known = Object.values(ErrorCode).find((value) => value === code)
  return known ?? ErrorCode.Internal
}

/**
 * The response payload, widened for `Reporter.success`.
 *
 * A shallow copy only because the reporter wants `Record<string, unknown>`; an
 * earlier version destructured `kind` off and spread it straight back in the
 * same position, which read like extraction but was `{ ...response.data }`.
 */
function payloadOf(response: OkResponse): Record<string, unknown> {
  return { ...response.data }
}

export function renderOk(response: OkResponse): string {
  const data = response.data
  switch (data.kind) {
    case 'status': {
      const status = data.status
      const md5 = status.programMd5 ? `${status.programMd5.slice(0, 8)}${status.md5Matches ? '' : ' (MISMATCH)'}` : '-'
      return [
        `session   ${status.sessionId}`,
        // Composed here, from the two fields the status carries separately.
        `target    ${status.target || '-'} via ${status.transport} ${status.descriptor}`,
        `project   ${status.projectPath}`,
        `program   ${md5}`,
        `plc       ${status.plcState}`,
        `forced    ${status.forced.length > 0 ? status.forced.join(', ') : '(none)'}`,
        `watching  ${status.watching.length > 0 ? status.watching.join(', ') : '(none)'}`,
        `since     ${status.startedAt}`,
      ].join('\n')
    }
    case 'list-vars':
      return data.variables.length === 0
        ? '(no variables match)'
        : renderTable(
            ['NAME', 'TYPE', 'BYTES'],
            data.variables.map((variable) => [variable.name, variable.type, String(variable.size)]),
          )
    case 'read':
      return formatVariableList(data.values)
    case 'force':
    case 'unforce':
      return `${data.value.name} : ${data.value.type} = ${formatValue(data.value)}${data.value.forced ? ' [FORCED]' : ''}`
    case 'plc-state':
      return `PLC is now ${data.plcState}`
    case 'watch':
      return `Recording ${data.watching.length} variable(s) every ${data.intervalMs} ms: ${data.watching.join(', ')}`
    case 'poll': {
      if (data.samples.length === 0)
        return data.dropped > 0 ? `(no new samples; ${data.dropped} dropped)` : '(no new samples)'
      const lines = data.samples.map(
        (sample) =>
          `[${String(sample.atMs).padStart(7)} ms] ` +
          sample.values.map((value) => `${value.name}=${formatValue(value)}`).join('  '),
      )
      if (data.dropped > 0) lines.push(`(${data.dropped} sample(s) dropped — the buffer filled)`)
      return lines.join('\n')
    }
    case 'unwatch':
      return data.watching.length === 0 ? 'Stopped recording.' : `Still recording: ${data.watching.join(', ')}`
    case 'close':
      return data.released.length > 0 ? `Closed, released: ${data.released.join(', ')}` : 'Closed.'
  }
}

// ---------------------------------------------------------------------------
// REPL — a client of the same protocol, nothing more
// ---------------------------------------------------------------------------

/**
 * Command vocabulary mirroring `strucpp`'s REPL, so moving between the two does
 * not mean relearning the verbs. `run`/`step`/`code` are absent on purpose:
 * they single-step a compiled binary, which a live PLC cannot do — `start` and
 * `stop` are the equivalents here.
 *
 * Two of those verbs are spelled differently as subcommands — `vars`/`get`
 * here against `list-vars`/`read` outside — so BOTH spellings are
 * accepted for each. They are one operation reached two ways, and a caller who
 * learned `openplc-cli debug read x` should not be told `read` is unknown the
 * first time it types it into `debug exec`. (It was: that is why this is here.)
 */
const REPL_HELP = `Commands
  vars | list-vars [filter]  list variables in the program
  get | read <name>...       read one or more variables
  force <name> <value>       pin a variable until unforced
  unforce <name>             release a pinned variable
  watch <name> [name...]     start recording; use poll to drain
  poll                       show what has been recorded since the last poll
  unwatch [name...]          stop recording (all, or the named ones)
  start | stop               run/stop the PLC
  status                     connection, program md5, plc state, forced list
  help                       this list
  quit | exit                leave the REPL (the session stays open)`

/** Map a typed REPL line onto a protocol request. */
export function parseReplLine(
  line: string,
  id: number,
): { request: Request } | { error: string } | 'quit' | 'help' | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  const [verb, ...rest] = trimmed.split(/\s+/)

  switch (verb.toLowerCase()) {
    case 'quit':
    case 'exit':
      return 'quit'
    case 'help':
    case '?':
      return 'help'
    case 'vars':
    case 'list-vars':
      return { request: { id, kind: 'list-vars', filter: rest[0] } }
    case 'get':
    case 'read':
      if (rest.length === 0) return { error: `${verb} needs at least one variable name` }
      return { request: { id, kind: 'read', names: rest } }
    case 'force':
      if (rest.length < 2) return { error: 'force needs a variable name and a value' }
      return { request: { id, kind: 'force', name: rest[0], value: rest.slice(1).join(' ') } }
    case 'unforce':
      if (rest.length === 0) return { error: 'unforce needs a variable name' }
      return { request: { id, kind: 'unforce', name: rest[0] } }
    case 'watch':
      if (rest.length === 0) return { error: 'watch needs at least one variable name' }
      return { request: { id, kind: 'watch', names: rest } }
    case 'poll':
      return { request: { id, kind: 'poll' } }
    case 'unwatch':
      return { request: { id, kind: 'unwatch', names: rest.length > 0 ? rest : undefined } }
    case 'start':
      return { request: { id, kind: 'start' } }
    case 'stop':
      return { request: { id, kind: 'stop' } }
    case 'status':
      return { request: { id, kind: 'status' } }
    default:
      return { error: `Unknown command "${verb}" — type help` }
  }
}

async function runRepl(args: ParsedArgs, reporter: Reporter, context: DebugContext): Promise<CliResult> {
  const resolved = resolveSession(args, context)
  if ('error' in resolved) {
    return reporter.failure({ code: ErrorCode.SessionNotFound, message: resolved.error }, ExitCode.NotFound)
  }
  const record = resolved.record

  // Refused rather than degraded: readline over a pipe delivers buffered lines
  // in one burst, so a scripted REPL silently drops commands. `exec` is the
  // deterministic path and the error names it.
  if (!process.stdin.isTTY) {
    return reporter.failure(
      {
        code: ErrorCode.InvalidArgument,
        message:
          'debug repl needs a terminal. For a script, use `openplc-cli debug exec -` (reads commands from stdin, one per line).',
      },
      ExitCode.Usage,
    )
  }

  process.stdout.write(
    `OpenPLC debug session ${record.sessionId}\n` +
      `target ${record.target || '-'}  project ${record.projectPath}\n` +
      `Type help for commands. Leaving the REPL does not close the session.\n\n`,
  )

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `openplc[${userInfo().username}]> `,
  })
  let nextId = 1

  await new Promise<void>((resolve) => {
    rl.prompt()
    rl.on('line', (line) => {
      const parsed = parseReplLine(line, nextId++)
      if (parsed === null) {
        rl.prompt()
        return
      }
      if (parsed === 'quit') {
        rl.close()
        return
      }
      if (parsed === 'help') {
        process.stdout.write(`${REPL_HELP}\n`)
        rl.prompt()
        return
      }
      if ('error' in parsed) {
        process.stdout.write(`${parsed.error}\n`)
        rl.prompt()
        return
      }
      // Pause while the request is in flight so a fast typist cannot interleave
      // two commands on one debug channel.
      rl.pause()
      void sendRequest(record.socketPath, parsed.request).then((result) => {
        if (!result.success) process.stdout.write(`error: ${result.error}\n`)
        else if (!result.response.ok)
          process.stdout.write(`error [${result.response.error.code}]: ${result.response.error.message}\n`)
        else process.stdout.write(`${renderOk(result.response)}\n`)
        rl.resume()
        rl.prompt()
      })
    })
    rl.on('close', () => resolve())
  })

  return reporter.success({ sessionId: record.sessionId, left: true }, () => `Left session ${record.sessionId}.`)
}

/**
 * `debug exec` — run a script of REPL commands, one per line.
 *
 * Separate from the REPL rather than "the REPL with piped stdin", because
 * readline is the wrong tool for a script: with a non-TTY input it delivers
 * every buffered line in one synchronous burst, so pausing between commands
 * cannot hold them back and lines get dropped. Observed exactly that — a piped
 * seven-command script ran the first and the last.
 *
 * This reads the whole input, then runs the commands strictly in sequence over
 * one connection each, which is also what makes the output deterministic enough
 * to assert on. Stops at the first failure unless `--keep-going`, so a script
 * cannot keep issuing writes after something went wrong.
 */
async function runExec(args: ParsedArgs, reporter: Reporter, context: DebugContext): Promise<CliResult> {
  const resolved = resolveSession(args, context)
  if ('error' in resolved) {
    return reporter.failure({ code: ErrorCode.SessionNotFound, message: resolved.error }, ExitCode.NotFound)
  }

  const script = await readScript(args)
  if ('error' in script) {
    return reporter.failure({ code: ErrorCode.InvalidArgument, message: script.error }, ExitCode.Usage)
  }

  const keepGoing = boolFlag(args, 'keep-going')
  const steps: Array<{ command: string; ok: boolean; output?: string; error?: string }> = []
  let failures = 0
  let id = 1

  for (const line of script.lines) {
    const parsed = parseReplLine(line, id++)
    // `help` and blank lines are no-ops in a script; `quit` ends it early.
    if (parsed === null || parsed === 'help') continue
    if (parsed === 'quit') break

    if ('error' in parsed) {
      steps.push({ command: line, ok: false, error: parsed.error })
      failures += 1
      if (!keepGoing) break
      continue
    }

    const result = await sendRequest(resolved.record.socketPath, parsed.request)
    if (!result.success) {
      steps.push({ command: line, ok: false, error: result.error })
      failures += 1
      if (!keepGoing) break
      continue
    }
    if (!result.response.ok) {
      steps.push({
        command: line,
        ok: false,
        error: `[${result.response.error.code}] ${result.response.error.message}`,
      })
      failures += 1
      if (!keepGoing) break
      continue
    }
    const rendered = renderOk(result.response)
    steps.push({ command: line, ok: true, output: rendered })
    reporter.progress(`${line}`)
  }

  if (failures > 0) {
    return reporter.failure(
      {
        code: ErrorCode.TargetError,
        message: `${failures} of ${steps.length} command(s) failed`,
        details: { steps },
      },
      ExitCode.TargetError,
    )
  }

  return reporter.success({ steps }, () => steps.map((step) => `> ${step.command}\n${step.output ?? ''}`).join('\n'))
}

/** Command lines from a file argument, or from stdin when given `-`. */
async function readScript(args: ParsedArgs): Promise<{ lines: string[] } | { error: string }> {
  const source = args.positionals[0] ?? stringFlag(args, 'script') ?? '-'
  let text: string
  if (source === '-') {
    // Reading a terminal's stdin waits for a person to type and then press
    // ctrl-D, which nobody typing `openplc-cli debug exec` is expecting: it
    // looked like a hang, and no guard could rescue it because nothing rejects
    // and nothing raises EPIPE. `debug repl` refuses the mirror-image case (a
    // pipe) for the same reason.
    if (process.stdin.isTTY) {
      return {
        error:
          'debug exec reads its script from stdin or a file. Pass a path, or pipe one:\n' +
          '  openplc-cli debug exec commands.txt\n' +
          "  printf 'status\\nread main:blink\\n' | openplc-cli debug exec -",
      }
    }
    text = await readAllStdin()
  } else {
    try {
      text = await readFile(source, 'utf-8')
    } catch {
      return { error: `Could not read the command script at ${source}` }
    }
  }
  const lines = text
    .split('\n')
    // A comment starts at the beginning of a line or after whitespace. `#` is
    // ALSO IEC based-literal syntax, which this CLI accepts — `force x 16#FF`.
    // Stripping from any `#` turned that into `force x 16` and wrote 16 instead
    // of 255 to live hardware, silently.
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return { error: 'The command script is empty' }
  return { lines }
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buffered = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: string) => {
      buffered += chunk
    })
    process.stdin.on('end', () => resolve(buffered))
  })
}

/**
 * The board a project last selected, for when `--target` is omitted.
 *
 * Read straight off `devices/configuration.json` rather than through a full
 * project load: this runs before the daemon exists, and the only thing needed is
 * the dropdown's remembered value.
 */
async function projectBoard(projectPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(projectPath, 'devices', 'configuration.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record: Record<string, unknown> = { ...parsed }
    return typeof record.deviceBoard === 'string' && record.deviceBoard.length > 0 ? record.deviceBoard : undefined
  } catch {
    return undefined
  }
}
