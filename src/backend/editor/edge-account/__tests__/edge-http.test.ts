/**
 * The Edge transport, against a real loopback server.
 *
 * Deliberately not a socket double. What is worth protecting here is the behaviour of
 * the wire itself — a frame split across two TCP writes, a body that has to be buffered
 * whole because it is a refusal, a request torn down mid-answer — and a hand-rolled
 * fake `http` module would be asserting that the test's own idea of a socket matches
 * the code's. Loopback is also the one host the confidentiality guard lets us reach
 * over plain http, which is exactly why that escape hatch exists.
 */

import http from 'http'
import type { AddressInfo } from 'net'

import type { EdgeStreamSink } from '../edge-http'
import { EdgeStreamHttpError, edgeRequest, edgeStreamRequest } from '../edge-http'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void

let server: http.Server
let handler: Handler = (_req, res) => res.end()
let baseUrl = ''
const originalBaseUrl = process.env.OPENPLC_EDGE_API_URL

/** A sink whose every call is recorded, so ordering can be asserted as well as content. */
function recordingSink(): EdgeStreamSink & { chunks: string[]; calls: string[]; errors: Error[]; statuses: number[] } {
  const chunks: string[] = []
  const calls: string[] = []
  const errors: Error[] = []
  const statuses: number[] = []

  return {
    chunks,
    calls,
    errors,
    statuses,
    onChunk(text) {
      calls.push('chunk')
      chunks.push(text)
    },
    onStatus(status) {
      calls.push('status')
      statuses.push(status)
    },
    onEnd() {
      calls.push('end')
    },
    onError(error) {
      calls.push('error')
      errors.push(error)
    },
  }
}

/** Resolve once `predicate` holds, or give up — a hung expectation must not hang the suite. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  throw new Error(`Timed out waiting for ${label}`)
}

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  const port = address !== null && typeof address === 'object' ? (address as AddressInfo).port : 0

  baseUrl = `http://127.0.0.1:${port}`
  process.env.OPENPLC_EDGE_API_URL = baseUrl
})

afterAll(async () => {
  process.env.OPENPLC_EDGE_API_URL = originalBaseUrl
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('edgeRequest', () => {
  it('resolves with the status and body for every answer the server gives', async () => {
    handler = (_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end('{"message":"nope"}')
    }

    // A 404 is an answer, not a failure: the subscription route uses one to mean
    // "this account has no plan".
    await expect(edgeRequest('/me/subscription')).resolves.toEqual({ status: 404, body: '{"message":"nope"}' })
  })

  it('sends the bearer, the JSON body and a Content-Length measured in bytes', async () => {
    let seen: { authorization?: string; contentLength?: string; body: string; method?: string } | null = null

    handler = (req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8')
      })
      req.on('end', () => {
        seen = {
          authorization: req.headers.authorization,
          contentLength: req.headers['content-length'],
          body,
          method: req.method,
        }
        res.end('{}')
      })
    }

    // A non-ASCII payload is the case where byte length and string length disagree.
    await edgeRequest('/auth/signin', { method: 'POST', json: { password: 'sènha' }, accessToken: 't1' })

    expect(seen).toEqual({
      authorization: 'Bearer t1',
      contentLength: String(Buffer.byteLength('{"password":"sènha"}', 'utf-8')),
      body: '{"password":"sènha"}',
      method: 'POST',
    })
  })

  it('refuses to carry a session to a remote host over plain http', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://api.example.com'

    // Rejects rather than resolving with a status: nothing was established, which is
    // what a transport failure means.
    await expect(edgeRequest('/auth/signin', { method: 'POST', json: { password: 'p' } })).rejects.toThrow(
      /credentials may only travel over https/,
    )

    process.env.OPENPLC_EDGE_API_URL = baseUrl
  })
})

describe('edgeStreamRequest', () => {
  it('reports the status first, then the body as it arrives, then the end', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: one\n')
      // A second write is a second chunk on the wire, which is the whole point of
      // streaming: the caller must see it before the response is finished.
      setTimeout(() => res.end('data: two\n'), 10)
    }

    const sink = recordingSink()

    edgeStreamRequest('/ai/chat', { method: 'POST', json: {} }, sink)

    await waitFor(() => sink.calls.includes('end'), 'the stream to end')

    expect(sink.statuses).toEqual([200])
    expect(sink.calls[0]).toBe('status')
    expect(sink.calls.at(-1)).toBe('end')
    expect(sink.chunks.join('')).toBe('data: one\ndata: two\n')
    expect(sink.errors).toEqual([])
  })

  it('decodes a multi-byte character split across two writes', async () => {
    // The e-acute is two bytes; sending them in separate packets is what a naive
    // per-chunk `toString` turns into two replacement characters.
    const bytes = Buffer.from('café', 'utf-8')

    handler = (_req, res) => {
      res.writeHead(200)
      res.write(bytes.subarray(0, 4))
      setTimeout(() => res.end(bytes.subarray(4)), 10)
    }

    const sink = recordingSink()

    edgeStreamRequest('/ai/chat', {}, sink)

    await waitFor(() => sink.calls.includes('end'), 'the stream to end')

    expect(sink.chunks.join('')).toBe('café')
  })

  it('buffers a refusal whole and hands it over with its status', async () => {
    // The exhaustion modal is built from this body and nothing else.
    const refusal = JSON.stringify({
      error: { error: 'insufficient_acu', status: 402, message: 'Out of credits.', remaining: 3, required: 10 },
    })

    handler = (_req, res) => {
      res.writeHead(402, { 'Content-Type': 'application/json' })
      res.write(refusal.slice(0, 20))
      setTimeout(() => res.end(refusal.slice(20)), 10)
    }

    const sink = recordingSink()

    edgeStreamRequest('/ai/chat', { method: 'POST', json: {} }, sink)

    await waitFor(() => sink.calls.includes('error'), 'the refusal to arrive')

    const [error] = sink.errors

    expect(error).toBeInstanceOf(EdgeStreamHttpError)
    expect(error instanceof EdgeStreamHttpError ? error.status : null).toBe(402)
    expect(error instanceof EdgeStreamHttpError ? error.body : '').toBe(refusal)
    // A refusal is never streamed: the caller must not have to undo a partial answer.
    expect(sink.chunks).toEqual([])
    expect(sink.calls).toEqual(['status', 'error'])
  })

  it('stops delivering and tears the socket down when cancelled', async () => {
    let closed = false
    let ticker: NodeJS.Timeout | undefined

    handler = (req, res) => {
      res.writeHead(200)
      res.write('first\n')
      ticker = setInterval(() => res.write('more\n'), 5)
      req.on('close', () => {
        closed = true
        clearInterval(ticker)
      })
    }

    const sink = recordingSink()
    const handle = edgeStreamRequest('/ai/chat', {}, sink)

    await waitFor(() => sink.chunks.length > 0, 'the first chunk')

    handle.cancel()

    const delivered = sink.chunks.length

    // The server has to notice: an abandoned AI stream that stays open keeps
    // generating tokens nobody will read.
    await waitFor(() => closed, 'the server to see the disconnect')
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(sink.chunks).toHaveLength(delivered)
    expect(sink.calls).not.toContain('end')
    expect(sink.calls).not.toContain('error')

    clearInterval(ticker)
  })

  it('reports a cleartext base URL through the sink rather than throwing', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://api.example.com'

    const sink = recordingSink()

    // A push API with two failure channels is one the caller will only half handle.
    expect(() => edgeStreamRequest('/ai/chat', { method: 'POST', json: {} }, sink)).not.toThrow()

    await waitFor(() => sink.calls.includes('error'), 'the refusal')

    expect(sink.errors[0].message).toMatch(/credentials may only travel over https/)
    expect(sink.errors[0]).not.toBeInstanceOf(EdgeStreamHttpError)

    process.env.OPENPLC_EDGE_API_URL = baseUrl
  })

  it('reports a connection that never answers as an error, not as an empty body', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://127.0.0.1:1'

    const sink = recordingSink()

    edgeStreamRequest('/ai/chat', {}, sink)

    await waitFor(() => sink.calls.includes('error'), 'the connection to fail')

    expect(sink.calls).toEqual(['error'])
    expect(sink.errors[0]).not.toBeInstanceOf(EdgeStreamHttpError)

    process.env.OPENPLC_EDGE_API_URL = baseUrl
  })
})
