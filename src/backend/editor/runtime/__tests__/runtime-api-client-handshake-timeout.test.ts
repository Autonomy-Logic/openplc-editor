/** @jest-environment node */

import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import net from 'node:net'

import { RuntimeApiClient } from '../runtime-api-client'

const CONNECTION_TIMEOUT_MS = 5_000
const NFR01_SHARE_MS = 7_500

const mockRoute: { port: number } = { port: 0 }

jest.mock('https', () => {
  const actual = jest.requireActual<typeof import('https')>('https')
  return {
    ...actual,
    request: (options: RequestOptions, callback?: (res: IncomingMessage) => void) =>
      actual.request({ ...options, port: mockRoute.port }, callback),
  }
})

const heldSockets: net.Socket[] = []
const silentServer = net.createServer((socket) => {
  heldSockets.push(socket)
  socket.on('error', () => undefined)
})

beforeAll(async () => {
  mockRoute.port = await new Promise<number>((resolve) => {
    silentServer.listen(0, '127.0.0.1', () => {
      const address = silentServer.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
})

afterAll(async () => {
  heldSockets.forEach((socket) => socket.destroy())
  await new Promise<void>((resolve) => silentServer.close(() => resolve()))
})

describe('RuntimeApiClient TLS handshake deadline (NFR01)', () => {
  it('reports a server that accepts TCP but never answers TLS as a timeout within 7.5 s', async () => {
    const startedAt = performance.now()

    const facts = await new RuntimeApiClient().getUsersInfoFacts('127.0.0.1')
    const elapsed = performance.now() - startedAt

    expect(facts).toEqual({ kind: 'error', message: 'Connection timeout', timedOut: true })
    expect(heldSockets).toHaveLength(1)
    expect(elapsed).toBeGreaterThanOrEqual(CONNECTION_TIMEOUT_MS - 100)
    expect(elapsed).toBeLessThan(NFR01_SHARE_MS)
  }, 15_000)
})
