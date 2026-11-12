/** @jest-environment node */

import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import https from 'node:https'
import type { RequestOptions } from 'node:https'
import net from 'node:net'
import path from 'node:path'

import { RuntimeApiClient } from '../runtime-api-client'

const mockRoute: { port: number; failWith: Error | null } = { port: 0, failWith: null }

jest.mock('https', () => {
  const actual = jest.requireActual<typeof import('https')>('https')
  return {
    ...actual,
    request: (options: RequestOptions, callback?: (res: IncomingMessage) => void) => {
      const req = actual.request({ ...options, port: mockRoute.port }, callback)
      const failure = mockRoute.failWith
      if (failure !== null) process.nextTick(() => req.destroy(failure))
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
const hungSockets = new Set<net.Socket>()
const hungServer = net.createServer((socket) => {
  hungSockets.add(socket)
})
const plainServer = net.createServer((socket) => {
  socket.once('data', () => socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'))
})

let tlsPort = 0
let hungPort = 0
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

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

beforeAll(async () => {
  tlsPort = await listen(tlsServer)
  hungPort = await listen(hungServer)
  plainPort = await listen(plainServer)
  const released = net.createServer()
  refusedPort = await listen(released)
  await close(released)
})

afterAll(async () => {
  for (const socket of hungSockets) socket.destroy()
  tlsServer.closeAllConnections()
  await Promise.all([close(tlsServer), close(hungServer), close(plainServer)])
})

beforeEach(() => {
  mockRoute.port = tlsPort
  mockRoute.failWith = null
  reply = (_req, res) => res.end()
})

describe('RuntimeApiClient.getUsersInfo when the runtime answers on 8443', () => {
  it('reads 404 as the first-user state with the runtime version and no error', async () => {
    reply = answer(404, '')

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toStrictEqual({
      hasUsers: false,
      runtimeVersion: '4.1.0',
    })
  })

  it('reads 200 as a runtime with users and the runtime version', async () => {
    reply = answer(200, '{"has_users":true}')

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toStrictEqual({
      hasUsers: true,
      runtimeVersion: '4.1.0',
    })
  })

  it('keeps reading a 404 with an HTML body as the first-user state', async () => {
    reply = answer(404, '<html><body>Not Found</body></html>')

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toStrictEqual({
      hasUsers: false,
      runtimeVersion: '4.1.0',
    })
  })

  it('keeps reading a 200 whose body is not JSON as a runtime with users', async () => {
    reply = answer(200, 'not json at all')

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toStrictEqual({
      hasUsers: true,
      runtimeVersion: '4.1.0',
    })
  })

  it.each([
    [500, 'Internal Server Error'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
  ])('reports HTTP %p with its body as the error and no failure kind', async (statusCode, body) => {
    reply = answer(statusCode, body)

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toStrictEqual({
      hasUsers: false,
      error: body,
      runtimeVersion: '4.1.0',
    })
  })

  it('reports an empty-bodied HTTP 500 as an unexpected status with no failure kind', async () => {
    reply = answer(500, '')

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toStrictEqual({
      hasUsers: false,
      error: 'Unexpected status: 500',
      runtimeVersion: '4.1.0',
    })
  })
})

describe('RuntimeApiClient.getUsersInfo when the connection to 8443 fails', () => {
  it('marks a refused port as refused and keeps the connect error text', async () => {
    mockRoute.port = refusedPort

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toEqual({
      hasUsers: false,
      error: expect.stringContaining(`connect ECONNREFUSED 127.0.0.1:${refusedPort}`),
      failure: 'refused',
    })
  })

  it('marks a runtime that accepts and never answers as a timeout after the 5 s timer', async () => {
    mockRoute.port = hungPort
    const startedAt = Date.now()

    const result = await new RuntimeApiClient().getUsersInfo('127.0.0.1')

    expect(result).toEqual({ hasUsers: false, error: 'Connection timeout', failure: 'timeout' })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4900)
  }, 20_000)

  it.each([
    ['EHOSTUNREACH', 'host-unreachable'],
    ['ENETUNREACH', 'network-unreachable'],
  ])('marks a request error with code %s as %s and keeps its message', async (code, failure) => {
    mockRoute.failWith = errorWithCode(`connect ${code} 192.168.1.50:8443`, code)

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toEqual({
      hasUsers: false,
      error: `connect ${code} 192.168.1.50:8443`,
      failure,
    })
  })

  it('does not read an error that only says "Connection timeout" as the client timeout', async () => {
    mockRoute.failWith = new Error('Connection timeout')

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toEqual({
      hasUsers: false,
      error: 'Connection timeout',
      failure: 'other',
    })
  })
})

describe("RuntimeApiClient.getUsersInfo for failures that keep today's error and start no checks", () => {
  it('marks a connection reset mid-request as other with the socket error text', async () => {
    reply = (req) => req.socket.destroy()

    await expect(new RuntimeApiClient().getUsersInfo('127.0.0.1')).resolves.toEqual({
      hasUsers: false,
      error: expect.stringContaining('socket hang up'),
      failure: 'other',
    })
  })

  it('marks a TLS handshake failure against a plain TCP server as other', async () => {
    mockRoute.port = plainPort

    const result = await new RuntimeApiClient().getUsersInfo('127.0.0.1')

    expect(result).toEqual({ hasUsers: false, error: expect.any(String), failure: 'other' })
    expect(result.error).not.toBe('')
  })

  it('marks a host name that does not resolve as other with the lookup error text', async () => {
    const result = await new RuntimeApiClient().getUsersInfo('plc-missing.invalid')

    expect(result).toEqual({
      hasUsers: false,
      error: expect.stringContaining('plc-missing.invalid'),
      failure: 'other',
    })
  })
})
