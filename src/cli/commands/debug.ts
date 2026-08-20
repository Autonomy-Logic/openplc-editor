/**
 * `openplc debug …` — the session-first debugger.
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

import { userInfo } from 'node:os'
import { createInterface } from 'node:readline'

import { boolFlag, listFlag, type ParsedArgs, stringFlag } from '../args'
import { formatValue, formatVariableList } from '../debug/format'
import { ErrorCode, ExitCode, type ExitCodeValue } from '../exit-codes'
import type { CliResult, Reporter } from '../output'
import { sendRequest } from '../session/client'
import type { OkResponse, Request, Response } from '../session/protocol'
import { type SessionRecord,SessionRegistry } from '../session/registry'
import { renderTable } from './devices'

export interface DebugContext {
  registry: SessionRegistry
  /** Spawns the daemon process for `debug open`. */
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>
}

export interface SpawnSessionOptions {
  projectPath: string
  target: string
  host: string
  username: string
  password: string
  uploadIfNeeded: boolean
  idleTimeoutMs: number
  onProgress: (message: string) => void
}

export type SpawnSessionResult =
  | { success: true; record: SessionRecord }
  | { success: false; code: 'auth' | 'connection' | 'md5' | 'not-compiled' | 'internal'; error: string }

/** Map a session-side error code onto the process exit code a caller branches on. */
function exitCodeForError(code: string): ExitCodeValue {
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
    default:
      return ExitCode.Internal
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
    case 'status':
    case 'list-vars':
    case 'read':
    case 'write':
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
            'Name a debug subcommand: open, list, close, status, list-vars, read, write, force, unforce, start, stop, watch, poll, unwatch, repl',
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
  const target = stringFlag(args, 'target')
  if (!projectPath || !host) {
    return reporter.failure(
      {
        code: ErrorCode.MissingArgument,
        message:
          'debug open needs a project path and --host <address>, e.g. `openplc debug open ./proj --host 192.168.1.50`',
      },
      ExitCode.Usage,
    )
  }

  const credentials = resolveDebugCredentials(args)
  if ('error' in credentials) {
    return reporter.failure({ code: ErrorCode.MissingArgument, message: credentials.error }, ExitCode.Usage)
  }

  // Reuse before opening: a target that serves one client at a time simply
  // never answers a second connection, and the failure reads as a bare timeout
  // while a perfectly good session sits idle.
  if (target && !boolFlag(args, 'force-new')) {
    const existing = context.registry.findReusable(projectPath, target)
    if (existing) {
      reporter.progress(`Reusing session ${existing.sessionId} for the same project and target`)
      return reporter.success(
        { sessionId: existing.sessionId, reused: true, target: existing.target, projectPath: existing.projectPath },
        () => `${existing.sessionId} (reused)`,
      )
    }
  }

  const spawned = await context.spawnSession({
    projectPath,
    target: target ?? '',
    host,
    username: credentials.username,
    password: credentials.password,
    uploadIfNeeded: boolFlag(args, 'upload-if-needed'),
    idleTimeoutMs: Number(stringFlag(args, 'idle-timeout') ?? '') || DEFAULT_IDLE_TIMEOUT_MS,
    onProgress: (message) => reporter.progress(message),
  })

  if (!spawned.success) {
    const code =
      spawned.code === 'auth'
        ? ErrorCode.AuthRejected
        : spawned.code === 'connection'
          ? ErrorCode.NotConnected
          : spawned.code === 'md5'
            ? ErrorCode.Md5Mismatch
            : spawned.code === 'not-compiled'
              ? ErrorCode.ProjectInvalid
              : ErrorCode.Internal
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

function runList(reporter: Reporter, context: DebugContext): Promise<CliResult> {
  // Reaping first means the listing never advertises a session nobody is
  // listening on — an operator reads this to find forces that need clearing.
  const reaped = context.registry.reapStale()
  const sessions = context.registry.list()

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
          ['SESSION', 'TARGET', 'PROJECT', 'MD5', 'STARTED'],
          sessions.map((session) => [
            session.sessionId,
            session.target || '-',
            session.projectPath,
            (session.programMd5 ?? '-').slice(0, 8),
            session.startedAt,
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

  const targets = closeAll
    ? context.registry.list()
    : (() => {
        const sessionId = stringFlag(args, 'session') ?? args.positionals[0]
        if (!sessionId) return undefined
        const record = context.registry.get(sessionId)
        return record ? [record] : []
      })()

  if (targets === undefined) {
    return reporter.failure(
      { code: ErrorCode.MissingArgument, message: 'debug close needs --session <id> or --all' },
      ExitCode.Usage,
    )
  }

  const closed: Array<{ sessionId: string; released: string[] }> = []
  const failed: Array<{ sessionId: string; error: string }> = []

  for (const record of targets) {
    const result = await sendRequest(record.socketPath, { id: 1, kind: 'close', releaseForces })
    if (!result.success) {
      failed.push({ sessionId: record.sessionId, error: result.error })
      // The socket is unreachable, so the daemon is gone; drop the record
      // rather than leaving a listing entry that can never be dialled.
      context.registry.unregister(record.sessionId)
      continue
    }
    const released = result.response.ok && result.response.data.kind === 'close' ? result.response.data.released : []
    context.registry.unregister(record.sessionId)
    closed.push({ sessionId: record.sessionId, released })
  }

  const reaped = context.registry.reapStale()

  return reporter.success({ closed, failed, reaped }, () => {
    const lines: string[] = []
    for (const entry of closed) {
      lines.push(
        entry.released.length > 0
          ? `Closed ${entry.sessionId}, released ${entry.released.length} force(s): ${entry.released.join(', ')}`
          : `Closed ${entry.sessionId}`,
      )
    }
    for (const entry of failed) lines.push(`${entry.sessionId}: ${entry.error} (record removed)`)
    if (lines.length === 0) lines.push('Nothing to close.')
    return lines.join('\n')
  })
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
  if (sessions.length === 0) return { error: 'No open debug sessions — run `openplc debug open` first' }
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
    case 'write':
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

function payloadOf(response: OkResponse): Record<string, unknown> {
  const { kind, ...rest } = response.data
  return { kind, ...rest }
}

export function renderOk(response: OkResponse): string {
  const data = response.data
  switch (data.kind) {
    case 'status': {
      const status = data.status
      const md5 = status.programMd5 ? `${status.programMd5.slice(0, 8)}${status.md5Matches ? '' : ' (MISMATCH)'}` : '-'
      return [
        `session   ${status.sessionId}`,
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
    case 'write':
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

/** Credentials for `debug open`. Same precedence as the build commands. */
export function resolveDebugCredentials(args: ParsedArgs): { username: string; password: string } | { error: string } {
  const combined = stringFlag(args, 'credentials') ?? process.env.OPENPLC_CREDENTIALS
  if (combined) {
    const separator = combined.indexOf(':')
    if (separator <= 0 || separator === combined.length - 1)
      return { error: 'Credentials must look like user:password' }
    return { username: combined.slice(0, separator), password: combined.slice(separator + 1) }
  }
  const username = stringFlag(args, 'user') ?? process.env.OPENPLC_USER
  const password = stringFlag(args, 'password') ?? process.env.OPENPLC_PASSWORD
  if (!username || !password) {
    return {
      error:
        'Runtime credentials are required: pass --credentials user:pass (or --user/--password), ' +
        'or set OPENPLC_CREDENTIALS / OPENPLC_USER + OPENPLC_PASSWORD',
    }
  }
  return { username, password }
}

// ---------------------------------------------------------------------------
// REPL — a client of the same protocol, nothing more
// ---------------------------------------------------------------------------

/**
 * Command vocabulary mirroring `strucpp`'s REPL, so moving between the two does
 * not mean relearning the verbs. `run`/`step`/`code` are absent on purpose:
 * they single-step a compiled binary, which a live PLC cannot do — `start` and
 * `stop` are the equivalents here.
 */
const REPL_HELP = `Commands
  vars [filter]              list variables in the program
  get <name> [name...]       read one or more variables
  set <name> <value>         write a variable (program may overwrite next scan)
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
      return { request: { id, kind: 'list-vars', filter: rest[0] } }
    case 'get':
      if (rest.length === 0) return { error: 'get needs at least one variable name' }
      return { request: { id, kind: 'read', names: rest } }
    case 'set':
      if (rest.length < 2) return { error: 'set needs a variable name and a value' }
      return { request: { id, kind: 'write', name: rest[0], value: rest.slice(1).join(' ') } }
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
