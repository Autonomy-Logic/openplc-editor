/** @jest-environment node */

import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import https from 'node:https'
import type { RequestOptions } from 'node:https'
import path from 'node:path'

import { RuntimeApiClient } from '../runtime-api-client'

const mockRoute: { port: number } = { port: 0 }

jest.mock('https', () => {
  const actual = jest.requireActual<typeof import('https')>('https')
  return {
    ...actual,
    request: (options: RequestOptions, callback?: (res: IncomingMessage) => void) =>
      actual.request({ ...options, port: mockRoute.port }, callback),
  }
})

const fixtures = path.join(__dirname, 'fixtures')
const certificate = {
  key: readFileSync(path.join(fixtures, 'self-signed-localhost.key')),
  cert: readFileSync(path.join(fixtures, 'self-signed-localhost.crt')),
}

/** Statuses the next non-login requests get, in order; then 200. */
let queued: number[] = []
let logins = 0
let requests: string[] = []
let issued = 0

function handle(req: IncomingMessage, res: ServerResponse): void {
  req.resume()
  req.on('end', () => {
    if (req.url === '/api/login') {
      logins += 1
      issued += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ access_token: `tok-${issued}` }))
      return
    }
    requests.push(`${req.method ?? ''} ${req.url ?? ''} ${req.headers.authorization ?? ''}`)
    const status = queued.shift() ?? 200
    res.writeHead(status, { 'Content-Type': 'application/json' })
    if (status === 403) res.end(JSON.stringify({ msg: "This account's role may not use this endpoint" }))
    else if (status === 401) res.end(JSON.stringify({ msg: 'Token has expired' }))
    else res.end(JSON.stringify({ status: 'RUNNING', ok: true }))
  })
}

const server = https.createServer(certificate, handle)

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  mockRoute.port = typeof address === 'object' && address !== null ? address.port : 0
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function signedInClient(): Promise<RuntimeApiClient> {
  const client = new RuntimeApiClient()
  const login = await client.login('127.0.0.1', 'op', 'pw')
  expect(login.success).toBe(true)
  logins = 0
  requests = []
  return client
}

beforeEach(() => {
  queued = []
  logins = 0
  requests = []
  issued = 0
})

type Call = (client: RuntimeApiClient) => Promise<{ success: boolean } | { status: number }>

const calls: Array<[string, Call]> = [
  ['list users (GET)', (c) => c.makeRuntimeApiRequest('127.0.0.1', '/api/get-users-info', (d) => d)],
  ['PLC status (GET)', (c) => c.getStatus('127.0.0.1')],
  ['engineering POST', (c) => c.makeRuntimeApiPostRequest('127.0.0.1', '/api/plugins', '{}', (d) => d)],
  ['create user (POST)', (c) => c.makeRuntimeApiMutation('POST', '127.0.0.1', '/api/create-user', '{}')],
  ['update user (PUT)', (c) => c.makeRuntimeApiMutation('PUT', '127.0.0.1', '/api/update-user/2', '{}')],
  ['delete user (DELETE)', (c) => c.makeRuntimeApiMutation('DELETE', '127.0.0.1', '/api/delete-user/2')],
  ['license (exchange)', (c) => c.runtimeApiExchange('GET', '127.0.0.1', '/api/license')],
  [
    'upload',
    (c) =>
      c.makeRuntimeApiUpload({
        ipAddress: '127.0.0.1',
        fileBuffer: Buffer.from('zip'),
        filename: 'program.zip',
        contentType: 'application/zip',
        cleanBuild: false,
      }),
  ],
  [
    'own account (PUT)',
    (c) => c.makeOwnAccountMutation({ password: 'pw2' }, 'PUT', '127.0.0.1', '/api/update-user/1', '{}'),
  ],
]

describe('RuntimeApiClient re-signs in only on 401', () => {
  it.each(calls)('%s: a 403 is the final answer and makes no login', async (_name, call) => {
    const client = await signedInClient()
    queued = [403]

    const result = await call(client)

    expect('status' in result ? result.status === 403 : !result.success).toBe(true)
    expect(logins).toBe(0)
    expect(requests).toHaveLength(1)
    expect(client.tokens.getToken()).toBe('tok-1')
  })

  it.each(calls)('%s: a 401 re-signs in once and retries once with the new token', async (name, call) => {
    const client = await signedInClient()
    queued = [401]

    await call(client)

    expect(logins).toBe(expectedLoginsAfter401(name))
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatch(/Bearer tok-1$/)
    expect(requests[1]).toMatch(/Bearer tok-2$/)
  })

  it('a 401 on the retry is returned without a second sign-in', async () => {
    const client = await signedInClient()
    queued = [401, 401]

    const result = await client.makeRuntimeApiMutation('DELETE', '127.0.0.1', '/api/delete-user/2')

    expect(result.success).toBe(false)
    expect(logins).toBe(1)
    expect(requests).toHaveLength(2)
  })
})

/** An accepted own password change signs in once more, with the new password. */
function expectedLoginsAfter401(name: string): number {
  return name.startsWith('own account') ? 2 : 1
}
