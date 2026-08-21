/**
 * Spawning the debug-session daemon from `debug open`.
 *
 * The child is the same executable re-invoked with `--cli-daemon`, detached and
 * with its stdio piped only long enough to read the handshake line. After that
 * the pipes are unref'd so the parent can exit while the session keeps running
 * — which is the entire point of a session that survives across commands.
 *
 * The MD5-mismatch upload runs HERE, in the parent, rather than in the daemon:
 * uploading needs the whole compile pipeline, and putting that inside the
 * long-lived process would make every session carry the compiler. So `open`
 * compiles and uploads first if asked, and by the time the daemon probes the
 * target a mismatch is a real mismatch.
 */

import { spawn } from 'node:child_process'

import {
  SPAWN_FAILURE_CODES,
  type SpawnFailureCode,
  type SpawnSessionOptions,
  type SpawnSessionResult,
} from './commands/debug'
import { loadDebugIndex } from './debug/variables'
import { splitLines } from './session/protocol'

export interface SpawnDependencies {
  registryDir: string
  /** argv[0] and the fixed leading args needed to re-enter this program. */
  execPath: string
  execArgs: string[]
  /** Runs a compile + upload for the MD5-mismatch path. */
  uploadProgram: (options: {
    projectPath: string
    target: string
    /** Empty for a USB target. */
    host: string
    /** Serial port, for a USB target. */
    port: string
    username: string
    password: string
    onLine: (message: string) => void
  }) => Promise<{ success: boolean; error?: string }>
  /** Probes the target's program MD5 without opening a full session. */
  probeTargetMd5: (options: {
    host: string
    username: string
    password: string
  }) => Promise<{ success: true; md5: string | null } | { success: false; error: string }>
}

const HANDSHAKE_TIMEOUT_MS = 120_000

export function createSessionSpawner(deps: SpawnDependencies) {
  return async function spawnSession(options: SpawnSessionOptions): Promise<SpawnSessionResult> {
    if (options.uploadIfNeeded) {
      const prepared = await ensureProgramMatches(deps, options)
      if (!prepared.success) return prepared
    }

    const config = {
      registryDir: deps.registryDir,
      projectPath: options.projectPath,
      target: options.target,
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      uploadIfNeeded: false,
      idleTimeoutMs: options.idleTimeoutMs,
    }

    // Credentials go over stdin, not argv: argv is world-readable in `ps`.
    const child = spawn(deps.execPath, [...deps.execArgs, '--cli-daemon'], {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OPENPLC_CLI_DAEMON: '1' },
    })

    child.stdin.write(`${JSON.stringify(config)}\n`)
    child.stdin.end()

    return await new Promise<SpawnSessionResult>((resolve) => {
      let buffered = ''
      let settled = false
      let stderr = ''

      const finish = (result: SpawnSessionResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // A child that never reported ready must not be left running. It can
        // still become ready afterwards, register a session and TAKE THE TARGET
        // — a serial port, or a single-client Modbus TCP socket — while the
        // caller has already been told the open failed and holds no id to close
        // it with.
        if (!result.success) child.kill('SIGTERM')
        child.stdout.removeAllListeners('data')
        // Let go of the child so this process can exit while it keeps serving.
        // The streams are destroyed rather than unref'd: `unref` is a socket
        // method and these are plain Readables, so keeping them merely open
        // would hold the event loop.
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
        resolve(result)
      }

      const timer = setTimeout(
        () =>
          finish({
            success: false,
            code: 'connection',
            error: `The session did not report ready within ${HANDSHAKE_TIMEOUT_MS} ms${stderr ? `: ${stderr.trim()}` : ''}`,
          }),
        HANDSHAKE_TIMEOUT_MS,
      )

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
      })

      child.stdout.on('data', (chunk: Buffer) => {
        const { lines, rest } = splitLines(buffered, chunk.toString('utf-8'))
        buffered = rest
        for (const line of lines) {
          const message = readHandshake(line)
          if (!message) continue
          if (message.event === 'progress' && message.message) {
            options.onProgress(message.message)
            continue
          }
          if (message.event === 'ready' && message.record) {
            finish({ success: true, record: message.record })
            return
          }
          if (message.event === 'failed') {
            finish({
              success: false,
              code: message.code ?? 'internal',
              error: message.error ?? 'The session failed to open',
            })
            return
          }
        }
      })

      child.on('error', (error) =>
        finish({ success: false, code: 'internal', error: `Could not start the session process: ${error.message}` }),
      )

      child.on('exit', (code) => {
        finish({
          success: false,
          code: 'internal',
          error: `The session process exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.trim()}` : ''}`,
        })
      })
    })
  }
}

/**
 * Bring the target's program in line with the local build before the session
 * opens, so the daemon never has to decide whether to flash a PLC.
 */
async function ensureProgramMatches(
  deps: SpawnDependencies,
  options: SpawnSessionOptions,
): Promise<{ success: true } | SpawnSessionResult> {
  const index = await loadDebugIndex(options.projectPath, options.target)
  if (!index.success) return { success: false, code: 'not-compiled', error: index.error }

  // The shortcut probe is a RUNTIME REST call, so it only applies to a target
  // that has a runtime. Running it unconditionally broke `--upload-if-needed` on
  // every USB board: the probe logged in to an empty host, failed, and aborted
  // the open — so the flag the usage text advertises turned a working
  // `debug open` into a connection error.
  //
  // With no probe the local build is uploaded unconditionally, which is the
  // correct conservative choice: the session's own MD5 check is authoritative
  // either way, and the probe exists only to skip a needless upload.
  if (options.host) {
    const probe = await deps.probeTargetMd5({
      host: options.host,
      username: options.username,
      password: options.password,
    })
    if (!probe.success) return { success: false, code: 'connection', error: probe.error }
    if (probe.md5 && probe.md5.toLowerCase() === index.index.md5.toLowerCase()) return { success: true }
  }

  options.onProgress(`Uploading the local build (${index.index.md5}) before opening the session…`)
  const uploaded = await deps.uploadProgram({
    projectPath: options.projectPath,
    target: options.target,
    host: options.host,
    port: options.port,
    username: options.username,
    password: options.password,
    onLine: options.onProgress,
  })
  if (!uploaded.success) {
    // `upload`, not `md5`: the target's program is not the problem, the upload
    // is. Callers branch on the code, so a wrong code is a wrong answer.
    return { success: false, code: 'upload', error: uploaded.error ?? 'The upload failed' }
  }
  return { success: true }
}

interface HandshakeMessage {
  event?: 'progress' | 'ready' | 'failed'
  message?: string
  code?: SpawnFailureCode
  error?: string
  record?: {
    sessionId: string
    pid: number
    socketPath: string
    target: string
    projectPath: string
    programMd5: string | null
    startedAt: string
  }
}

/** Validate the handshake line rather than trusting the child's output. */
function readHandshake(line: string): HandshakeMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record: Record<string, unknown> = { ...parsed }
  const event = record.event
  if (event !== 'progress' && event !== 'ready' && event !== 'failed') return undefined

  const message: HandshakeMessage = { event }
  if (typeof record.message === 'string') message.message = record.message
  if (typeof record.error === 'string') message.error = record.error
  // Validated against the ONE shared union, so a member added there is accepted
  // here instead of being silently downgraded to `internal`.
  const code = record.code
  if (typeof code === 'string' && (SPAWN_FAILURE_CODES as readonly string[]).includes(code)) {
    message.code = code as SpawnFailureCode
  }
  if (typeof record.record === 'object' && record.record !== null) {
    const raw: Record<string, unknown> = { ...record.record }
    if (
      typeof raw.sessionId === 'string' &&
      typeof raw.pid === 'number' &&
      typeof raw.socketPath === 'string' &&
      typeof raw.target === 'string' &&
      typeof raw.projectPath === 'string' &&
      typeof raw.startedAt === 'string' &&
      (raw.programMd5 === null || typeof raw.programMd5 === 'string')
    ) {
      message.record = {
        sessionId: raw.sessionId,
        pid: raw.pid,
        socketPath: raw.socketPath,
        target: raw.target,
        projectPath: raw.projectPath,
        programMd5: raw.programMd5,
        startedAt: raw.startedAt,
      }
    }
  }
  return message
}
