/**
 * The `session_id` registry: which debug sessions exist, and how to reach them.
 *
 * A session is a background process holding a live connection. Callers address
 * it by id across unrelated invocations, so the mapping id → socket has to
 * live somewhere both the daemon and every one-shot client can see. That is
 * one small JSON file per session in a registry directory.
 *
 * The hard part is not writing the file, it is the file OUTLIVING its process.
 * A daemon killed with SIGKILL, a laptop suspended mid-test, a CI runner torn
 * down — all leave an entry pointing at a socket nobody is listening on. A
 * caller that trusts the file then hangs, and a `list` that reports dead
 * sessions is worse than no list at all, because an operator reads it to find
 * forces they need to clear. So liveness is checked on every read (`kill(pid,
 * 0)`) and dead entries are reaped rather than reported.
 *
 * Ids are content-free random tokens, not sequential counters: two concurrent
 * `debug open` invocations must not be able to mint the same id, and a counter
 * in a shared file is exactly the race a test suite running in parallel finds.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** What a one-shot client needs in order to reach a session. */
export interface SessionRecord {
  sessionId: string
  /** Owning daemon. Its liveness is what makes this record valid. */
  pid: number
  /** Unix socket path, or Windows named pipe. */
  socketPath: string
  /** Board / runtime target, as named in `hals.json`. */
  target: string
  projectPath: string
  /** MD5 of the program this session verified against, when known. */
  programMd5: string | null
  startedAt: string
}

/** A liveness probe, injectable so tests never depend on real pids. */
export type IsProcessAlive = (pid: number) => boolean

export const defaultIsProcessAlive: IsProcessAlive = (pid) => {
  try {
    // Signal 0 performs the permission and existence check without delivering
    // anything. EPERM means it exists but is not ours — still alive.
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Enough entropy that concurrent opens cannot collide; short enough to type. */
export function mintSessionId(): string {
  return randomBytes(6).toString('hex')
}

/**
 * Where a session's socket lives. On Windows a unix socket does not exist, so
 * the platform's named-pipe namespace is used instead — same addressing role,
 * different syntax, and it must never be treated as a filesystem path.
 */
export function socketPathFor(registryDir: string, sessionId: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `\\\\.\\pipe\\openplc-debug-${sessionId}`
  return join(registryDir, `${sessionId}.sock`)
}

export class SessionRegistry {
  constructor(
    private readonly dir: string,
    private readonly isAlive: IsProcessAlive = defaultIsProcessAlive,
  ) {}

  private recordPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`)
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  register(record: SessionRecord): void {
    this.ensureDir()
    writeFileSync(this.recordPath(record.sessionId), `${JSON.stringify(record, null, 2)}\n`, 'utf-8')
  }

  /**
   * Read one record, or undefined when it is absent OR its owner is gone.
   *
   * A dead owner is reaped here rather than returned, so no caller can dial a
   * socket that cannot answer.
   */
  get(sessionId: string): SessionRecord | undefined {
    const parsed = this.readRecord(this.recordPath(sessionId))
    if (!parsed) return undefined
    if (!this.isAlive(parsed.pid)) {
      this.reap(parsed)
      return undefined
    }
    return parsed
  }

  /** Every live session, oldest first. Dead entries are reaped as a side effect. */
  list(): SessionRecord[] {
    if (!existsSync(this.dir)) return []
    const live: SessionRecord[] = []
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith('.json')) continue
      const parsed = this.readRecord(join(this.dir, entry))
      if (!parsed) continue
      if (!this.isAlive(parsed.pid)) {
        this.reap(parsed)
        continue
      }
      live.push(parsed)
    }
    return live.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  /** Forget a session. Called by the daemon on clean shutdown. */
  unregister(sessionId: string): void {
    const parsed = this.readRecord(this.recordPath(sessionId))
    if (parsed) this.reap(parsed)
    else rmSync(this.recordPath(sessionId), { force: true })
  }

  /**
   * Drop every dead entry and report what was cleaned, so `debug close --all`
   * can tell the operator that stale sessions were found — a hint that
   * something died holding forces.
   */
  reapStale(): string[] {
    if (!existsSync(this.dir)) return []
    const reaped: string[] = []
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith('.json')) continue
      const parsed = this.readRecord(join(this.dir, entry))
      if (!parsed) {
        // Unreadable or malformed: it can never be dialled, so it is garbage.
        rmSync(join(this.dir, entry), { force: true })
        continue
      }
      if (this.isAlive(parsed.pid)) continue
      this.reap(parsed)
      reaped.push(parsed.sessionId)
    }
    return reaped
  }

  /**
   * An existing live session for the same project and target, if any.
   *
   * `debug open` reuses one rather than stacking a second connection to the
   * same device: targets that serve a single client (an Arduino Modbus TCP
   * server, notably) simply never answer the second socket, and the failure
   * looks like a bare timeout while a perfectly good session sits idle.
   */
  findReusable(projectPath: string, target: string): SessionRecord | undefined {
    return this.list().find((record) => record.projectPath === projectPath && record.target === target)
  }

  private readRecord(path: string): SessionRecord | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      return isSessionRecord(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private reap(record: SessionRecord): void {
    rmSync(this.recordPath(record.sessionId), { force: true })
    // The socket file is an artefact of the dead process; on win32 the pipe
    // name is not a path and there is nothing on disk to remove.
    if (!record.socketPath.startsWith('\\\\')) rmSync(record.socketPath, { force: true })
  }
}

/** Validate an external file rather than trusting its shape. */
function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false
  const record: Record<string, unknown> = { ...value }
  return (
    typeof record.sessionId === 'string' &&
    typeof record.pid === 'number' &&
    typeof record.socketPath === 'string' &&
    typeof record.target === 'string' &&
    typeof record.projectPath === 'string' &&
    typeof record.startedAt === 'string' &&
    (record.programMd5 === null || typeof record.programMd5 === 'string')
  )
}
