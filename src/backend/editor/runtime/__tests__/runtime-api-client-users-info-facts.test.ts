/** @jest-environment node */

import { readFileSync } from 'node:fs'
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http'
import https from 'node:https'
import type { RequestOptions } from 'node:https'
import net from 'node:net'
import path from 'node:path'

import { RuntimeApiClient } from '../runtime-api-client'

const mockRoute: { port: number; interrupt: ((req: ClientRequest) => void) | null } = { port: 0, interrupt: null }

jest.mock('https', () => {
  const actual = jest.requireActual<typeof import('https')>('https')
  return {
    ...actual,
    request: (options: RequestOptions, callback?: (res: IncomingMessage) => void) => {
      const req = actual.request({ ...options, port: mockRoute.port }, callback)
      const interrupt = mockRoute.interrupt
      if (interrupt !== null) process.nextTick(() => interrupt(req))
      return req
    },
  }
})

type Reply = (req: IncomingMessage, res: ServerResponse) => void

const fixtures = path.join(__dirname, 'fixtures')
const certificate = {
  key: readFileSync(path.join(fixtures, 'self-signed-localhost.key')),
  cert: readFileSync(path.join(fixtures, 'self-signed-localhost.crt')),
}

let reply: Reply = (_req, res) => res.end()
const tlsServer = https.createServer(certificate, (req, res) => reply(req, res))
const plainServer = net.createServer((socket) => {
  socket.once('data', () => socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'))
})

let tlsPort = 0
let plainPort = 0
let refusedPort = 0

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function answer(statusCode: number, body: string): Reply {
  return (_req, res) => {
    res.writeHead(statusCode, { 'x-openplc-runtime-version': '4.1.0' })
    res.end(body)
  }
}

function errorWithCode(message: string, code: unknown): Error {
  return Object.assign(new Error(message), { code })
}

function failRequestWith(error: Error): void {
  mockRoute.interrupt = (req) => req.destroy(error)
}

beforeAll(async () => {
  tlsPort = await listen(tlsServer)
  plainPort = await listen(plainServer)
  const released = net.createServer()
  refusedPort = await listen(released)
  await close(released)
})

afterAll(async () => {
  tlsServer.closeAllConnections()
  await Promise.all([close(tlsServer), close(plainServer)])
})

beforeEach(() => {
  mockRoute.port = tlsPort
  mockRoute.interrupt = null
  reply = (_req, res) => res.end()
})

describe('RuntimeApiClient.getUsersInfoFacts on a response', () => {
  it('asks the users-info endpoint with a GET', async () => {
    let seen = ''
    reply = (req, res) => {
      seen = `${req.method ?? ''} ${req.url ?? ''}`
      res.writeHead(404)
      res.end()
    }

    await new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')

    expect(seen).toBe('GET /api/get-users-info')
  })

  it.each([
    [404, ''],
    [200, '{"has_users":true}'],
    [500, 'Internal Server Error'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
  ])('returns status %p, the raw body and the runtime version header', async (statusCode, body) => {
    reply = answer(statusCode, body)

    await expect(new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')).resolves.toEqual({
      kind: 'response',
      statusCode,
      body,
      runtimeVersion: '4.1.0',
    })
  })

  it('leaves the runtime version out when the header is missing', async () => {
    reply = (_req, res) => {
      res.writeHead(404)
      res.end()
    }

    const facts = await new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')

    expect(facts).toEqual({ kind: 'response', statusCode: 404, body: '' })
  })
})

describe('RuntimeApiClient.getUsersInfoFacts on a request error', () => {
  it('carries the code and message of a refused connection, not timed out', async () => {
    mockRoute.port = refusedPort

    await expect(new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')).resolves.toEqual({
      kind: 'error',
      code: 'ECONNREFUSED',
      message: expect.stringContaining(`connect ECONNREFUSED 127.0.0.1:${refusedPort}`),
      timedOut: false,
    })
  })

  it('marks its own request timeout as timed out, with the message Connection timeout', async () => {
    mockRoute.interrupt = (req) => req.emit('timeout')

    const facts = await new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')

    expect(facts).toMatchObject({ kind: 'error', message: 'Connection timeout', timedOut: true })
  })

  it.each(['EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'])('carries a %s request error unchanged', async (code) => {
    failRequestWith(errorWithCode(`connect ${code} 192.168.1.50:8443`, code))

    await expect(new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')).resolves.toEqual({
      kind: 'error',
      code,
      message: `connect ${code} 192.168.1.50:8443`,
      timedOut: false,
    })
  })

  it('does not mark an error as timed out because its message reads Connection timeout', async () => {
    failRequestWith(new Error('Connection timeout'))

    const facts = await new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')

    expect(facts).toEqual({ kind: 'error', message: 'Connection timeout', timedOut: false })
  })

  it('leaves out an error code that is not a string', async () => {
    failRequestWith(errorWithCode('boom', 42))

    const facts = await new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')

    expect(facts).toEqual({ kind: 'error', message: 'boom', timedOut: false })
  })

  it('carries ECONNRESET when the socket is destroyed mid-request', async () => {
    reply = (req) => req.socket.destroy()

    await expect(new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')).resolves.toEqual({
      kind: 'error',
      code: 'ECONNRESET',
      message: expect.stringContaining('socket hang up'),
      timedOut: false,
    })
  })

  it('carries a TLS error code from a plain TCP server, not timed out', async () => {
    mockRoute.port = plainPort

    const facts = await new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')

    expect(facts).toEqual({ kind: 'error', code: expect.any(String), message: expect.any(String), timedOut: false })
  })

  it('carries the lookup error of a host name that does not resolve, not timed out', async () => {
    const facts = await new RuntimeApiClient().getUsersInfoFacts('plc-missing.invalid')

    expect(facts).toEqual({
      kind: 'error',
      code: expect.stringMatching(/^(ENOTFOUND|EAI_AGAIN)$/),
      message: expect.stringContaining('plc-missing.invalid'),
      timedOut: false,
    })
  })
})
