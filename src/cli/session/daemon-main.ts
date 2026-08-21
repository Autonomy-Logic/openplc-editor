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

import { openDebugSession } from '../debug/open-session'
import { applyConnectionOverrides, loadProject } from '../project/load'
import { mintSessionId, SessionRegistry, socketPathFor } from './registry'
import { SessionServer } from './server'

export interface DaemonConfig {
  registryDir: string
  projectPath: string
  target: string
  host: string
  /** Serial port, for a target whose debug channel rides one. */
  port: string
  username: string
  password: string
  uploadIfNeeded: boolean
  idleTimeoutMs: number
}

/** One JSON line on stdout; the parent reads exactly this. */
function announce(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

/**
 * Announce, then exit once the line has actually left.
 *
 * The daemon is spawned with piped stdio, so its stdout is asynchronous on
 * POSIX and `app.exit` drops whatever is queued. Every failure path here
 * announced a reason and exited on the next statement, so the parent never saw
 * it: a wrong runtime password or a genuine MD5 mismatch reached the user as
 * `The session process exited with code 1` — discarding the specific reason the
 * handshake exists to carry.
 */
async function announceAndExit(payload: Record<string, unknown>, code: number): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`, () => resolve())
  })
  app.exit(code)
}

export async function runDaemon(config: DaemonConfig): Promise<void> {
  const sessionId = mintSessionId()
  const socketPath = socketPathFor(config.registryDir, sessionId, process.platform)
  const registry = new SessionRegistry(config.registryDir)

  // Hydrate the editor state this process will resolve against: the debug-spec
  // resolver reads the device configuration and available boards off the store,
  // the same way it does behind the GUI's Debug button.
  const loaded = await loadProject(config.projectPath)
  if (!loaded.success) {
    await announceAndExit({ event: 'failed', code: 'not-compiled', error: loaded.error }, 1)
    return
  }
  applyConnectionOverrides({ port: config.port, host: config.host })

  // Uploading from inside the daemon would need the whole compile pipeline here;
  // `debug open --upload-if-needed` runs it in the PARENT before spawning, so by
  // this point an MD5 mismatch is genuinely a mismatch.
  const opened = await openDebugSession({
    sessionId,
    projectPath: config.projectPath,
    target: config.target,
    host: config.host || undefined,
    username: config.username || undefined,
    password: config.password || undefined,
    onProgress: (message: string) => announce({ event: 'progress', message }),
  })

  if (!opened.success) {
    await announceAndExit({ event: 'failed', code: opened.code, error: opened.error }, 1)
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
    // Before binding, not after: the socket lives in the registry directory, and
    // registering only happens once listening succeeds.
    registry.ensureDirectory()
    await server.listen()
  } catch (error) {
    await opened.core.close(true)
    await announceAndExit(
      {
        event: 'failed',
        code: 'internal',
        error: `Could not listen on ${socketPath}: ${error instanceof Error ? error.message : String(error)}`,
      },
      1,
    )
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
    void opened.core.closeFromOutsideRequest(true).finally(() => {
      registry.unregister(sessionId)
      app.exit(0)
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
