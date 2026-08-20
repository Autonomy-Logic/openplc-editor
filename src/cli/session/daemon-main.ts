/**
 * The debug session daemon's own entry point.
 *
 * Spawned by `debug open` as a detached child. It opens the channel, registers
 * its `session_id`, and then serves requests until it is closed or goes idle.
 *
 * The handshake with the parent runs over stdout as one JSON line — `ready`
 * with the record, or `failed` with a reason — so `debug open` can report a bad
 * password or an MD5 mismatch as its OWN failure instead of returning a session
 * id that turns out to be dead on the first read.
 */

import { app } from 'electron'

import { openRuntimeSession } from '../debug/open-session'
import { mintSessionId, SessionRegistry, socketPathFor } from './registry'
import { SessionServer } from './server'

export interface DaemonConfig {
  registryDir: string
  projectPath: string
  target: string
  host: string
  username: string
  password: string
  uploadIfNeeded: boolean
  idleTimeoutMs: number
}

/** One JSON line on stdout; the parent reads exactly this. */
function announce(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

export async function runDaemon(config: DaemonConfig): Promise<void> {
  const sessionId = mintSessionId()
  const socketPath = socketPathFor(config.registryDir, sessionId, process.platform)
  const registry = new SessionRegistry(config.registryDir)

  const opened = await openRuntimeSession({
    sessionId,
    projectPath: config.projectPath,
    target: config.target,
    host: config.host,
    username: config.username,
    password: config.password,
    // Uploading from inside the daemon would need the whole compile pipeline
    // here; `debug open --upload-if-needed` runs it in the PARENT before
    // spawning, so by this point a mismatch is genuinely a mismatch.
    onMd5Mismatch: undefined,
    onProgress: (message) => announce({ event: 'progress', message }),
  })

  if (!opened.success) {
    announce({ event: 'failed', code: opened.code, error: opened.error })
    app.exit(1)
    return
  }

  const server = new SessionServer({
    core: opened.core,
    socketPath,
    idleTimeoutMs: config.idleTimeoutMs,
    onDiagnostic: (message) => announce({ event: 'progress', message }),
    onClosed: () => {
      registry.unregister(sessionId)
      app.exit(0)
    },
  })

  try {
    await server.listen()
  } catch (error) {
    await opened.core.close(true)
    announce({
      event: 'failed',
      code: 'internal',
      error: `Could not listen on ${socketPath}: ${error instanceof Error ? error.message : String(error)}`,
    })
    app.exit(1)
    return
  }

  const record = {
    sessionId,
    pid: process.pid,
    socketPath,
    target: config.target,
    projectPath: config.projectPath,
    programMd5: opened.programMd5,
    startedAt: new Date().toISOString(),
  }
  registry.register(record)
  announce({ event: 'ready', record })

  // A terminated daemon must not leave a record pointing at a dead socket, and
  // must not leave variables pinned on the target.
  const shutdown = () => {
    void opened.core.close(true).finally(() => {
      registry.unregister(sessionId)
      app.exit(0)
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
