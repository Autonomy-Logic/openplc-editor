/**
 * Daemon bootstrap: read the config line from stdin, then serve.
 *
 * Config arrives on stdin rather than argv because it carries the runtime
 * password, and argv is readable by any process on the machine via `ps`.
 */

import { app } from 'electron'

import { type DaemonConfig, runDaemon } from './session/daemon-main'

export async function runDaemonFromStdin(): Promise<void> {
  const raw = await readFirstLine()
  const config = readConfig(raw)
  if (!config) {
    // Written and awaited before exiting: piped stdout is async, and `app.exit`
    // would drop the line the parent is waiting on.
    await new Promise<void>((resolve) => {
      process.stdout.write(
        `${JSON.stringify({ event: 'failed', code: 'internal', error: 'Malformed daemon config' })}\n`,
        () => resolve(),
      )
    })
    app.exit(1)
    return
  }
  await runDaemon(config)
}

function readFirstLine(): Promise<string> {
  return new Promise((resolve) => {
    let buffered = ''
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString('utf-8')
      const newline = buffered.indexOf('\n')
      if (newline === -1) return
      process.stdin.off('data', onData)
      resolve(buffered.slice(0, newline))
    }
    process.stdin.on('data', onData)
    process.stdin.on('end', () => resolve(buffered))
  })
}

/** Validate the config instead of trusting the pipe. */
function readConfig(line: string): DaemonConfig | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record: Record<string, unknown> = { ...parsed }
  const strings = ['registryDir', 'projectPath', 'target', 'host', 'port', 'username', 'password'] as const
  for (const key of strings) {
    if (typeof record[key] !== 'string') return undefined
  }
  return {
    registryDir: String(record.registryDir),
    projectPath: String(record.projectPath),
    target: String(record.target),
    host: String(record.host),
    port: String(record.port),
    username: String(record.username),
    password: String(record.password),
    uploadIfNeeded: record.uploadIfNeeded === true,
    // Finite and non-negative, not merely `number`: `NaN` passed the old check
    // and `setTimeout(NaN)` fires immediately, which would close a session the
    // instant it opened.
    idleTimeoutMs:
      typeof record.idleTimeoutMs === 'number' && Number.isFinite(record.idleTimeoutMs) && record.idleTimeoutMs >= 0
        ? record.idleTimeoutMs
        : 0,
  }
}
