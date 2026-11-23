/**
 * A real OpenPLC Runtime v4 in Docker on 127.0.0.1:8443: builds the image once (cached by tag), starts a fresh
 * container, waits for it and removes it.
 *
 * Env: `E2E_RUNTIME_IMAGE` (tag, default `openplc-runtime:e2e-users`), `E2E_RUNTIME_ROOT` (openplc-runtime
 * checkout to build from, default `../openplc-runtime`), `E2E_RUNTIME_REBUILD=1` (build even when cached).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:https'
import { join } from 'node:path'

export const RUNTIME_HOST = '127.0.0.1'
const RUNTIME_PORT = 8443
const CONTAINER = 'openplc-e2e-user-roles'
const IMAGE = process.env.E2E_RUNTIME_IMAGE ?? 'openplc-runtime:e2e-users'
const RUNTIME_ROOT = process.env.E2E_RUNTIME_ROOT ?? join(__dirname, '..', '..', '..', 'openplc-runtime')

function docker(args: string[], timeoutMs = 60000): { ok: boolean; output: string } {
  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs })
  return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}` }
}

/** Why the runtime container cannot run here, or null when Docker answers and the image exists or can be built. */
export function runtimeContainerUnavailable(): string | null {
  if (!docker(['info'], 20000).ok) return 'Docker is not available'
  if (process.env.E2E_RUNTIME_REBUILD !== '1' && docker(['image', 'inspect', IMAGE]).ok) return null
  if (!existsSync(join(RUNTIME_ROOT, 'Dockerfile'))) {
    return `no image ${IMAGE} and no openplc-runtime checkout at ${RUNTIME_ROOT} (set E2E_RUNTIME_ROOT)`
  }
  return null
}

/** Builds the runtime image from `E2E_RUNTIME_ROOT` unless it is cached, stamping the version from its VERSION file. */
export function ensureRuntimeImage(): void {
  if (process.env.E2E_RUNTIME_REBUILD !== '1' && docker(['image', 'inspect', IMAGE]).ok) return
  const version = readFileSync(join(RUNTIME_ROOT, 'VERSION'), 'utf8').trim()
  const build = docker(['build', '--build-arg', `RUNTIME_VERSION=${version}`, '-t', IMAGE, RUNTIME_ROOT], 1800000)
  if (!build.ok) throw new Error(`docker build failed:\n${build.output.slice(-3000)}`)
}

export interface RuntimeReply {
  status: number
  body: unknown
}

/** One JSON request to the runtime API on this host; the runtime serves a self-signed certificate. */
export function runtimeRequest(method: string, path: string, body?: object, token?: string): Promise<RuntimeReply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = request(
      {
        hostname: RUNTIME_HOST,
        port: RUNTIME_PORT,
        path,
        method,
        rejectUnauthorized: false,
        timeout: 10000,
        headers: {
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => (data += chunk.toString()))
        res.on('end', () => {
          let parsed: unknown = data
          try {
            parsed = JSON.parse(data)
          } catch {
            /* not JSON: keep the text */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error(`${method} ${path} timed out`)))
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/** Removes the container and its anonymous volumes. */
export function stopRuntimeContainer(): void {
  docker(['rm', '-f', '-v', CONTAINER])
}

/** Starts a fresh runtime container (no accounts) and resolves once `/api/version` answers, within 3 minutes. */
export async function startRuntimeContainer(): Promise<void> {
  stopRuntimeContainer()
  const run = docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '--cap-add=sys_nice',
    '-p',
    `${RUNTIME_HOST}:${RUNTIME_PORT}:8443`,
    IMAGE,
  ])
  if (!run.ok) throw new Error(`docker run failed:\n${run.output}`)
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const reply = await runtimeRequest('GET', '/api/version').catch(() => null)
    if (reply?.status === 200) return
    const state = docker(['inspect', '-f', '{{.State.Running}}', CONTAINER])
    if (state.output.trim() === 'false') {
      throw new Error(`the runtime container stopped:\n${docker(['logs', CONTAINER]).output.slice(-3000)}`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('the runtime container did not answer /api/version within 3 minutes')
}

/** Signs in and returns the access token; throws with the runtime's reply when refused. */
export async function signIn(username: string, password: string): Promise<string> {
  const reply = await runtimeRequest('POST', '/api/login', { username, password })
  const body = reply.body
  if (reply.status === 200 && typeof body === 'object' && body !== null && 'access_token' in body) {
    return String(body.access_token)
  }
  throw new Error(`sign-in of ${username} refused: ${reply.status} ${JSON.stringify(body)}`)
}

/** Creates the first account (always an admin, no sign-in needed). */
export async function createFirstAdmin(username: string, password: string): Promise<void> {
  const reply = await runtimeRequest('POST', '/api/create-user', { username, password })
  if (reply.status !== 201) throw new Error(`first admin not created: ${reply.status} ${JSON.stringify(reply.body)}`)
}

/** Creates an account with `role`, signed in as an admin. */
export async function createAccount(adminToken: string, username: string, password: string, role: string) {
  const reply = await runtimeRequest('POST', '/api/create-user', { username, password, role }, adminToken)
  if (reply.status !== 201) throw new Error(`${username} not created: ${reply.status} ${JSON.stringify(reply.body)}`)
}

/** The accounts the runtime holds, by username, with their roles. */
export async function rolesOnRuntime(adminToken: string): Promise<Record<string, string>> {
  const reply = await runtimeRequest('GET', '/api/get-users-info', undefined, adminToken)
  const roles: Record<string, string> = {}
  if (Array.isArray(reply.body)) {
    for (const entry of reply.body) {
      if (typeof entry === 'object' && entry !== null && 'username' in entry && 'role' in entry) {
        roles[String(entry.username)] = String(entry.role)
      }
    }
  }
  return roles
}
