// Resolves with the status for every server answer (4xx/5xx included); rejects only when
// the server never answered. Collapsing the two would report a network blip as "signed out".

import type https from 'https'
import type { z } from 'zod'

import { defaultPortFor, httpModuleFor } from '../utils/http-module'

const DEFAULT_EDGE_API_URL = 'https://api.autonomylogic.com'

const REQUEST_TIMEOUT_MS = 15_000

export function getEdgeApiBaseUrl(): string {
  const fromEnv = process.env.OPENPLC_EDGE_API_URL?.trim()

  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/+$/, '') : DEFAULT_EDGE_API_URL
}

function isLoopbackHost(hostname: string): boolean {
  // `URL.hostname` keeps the brackets on an IPv6 literal.
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/** Refuses cleartext to any non-loopback host: credentials travel over https, or http to this machine only. */
export function assertTransportIsConfidential(url: URL): void {
  if (url.protocol === 'https:' || isLoopbackHost(url.hostname)) {
    return
  }

  throw new Error(
    `Refusing to talk to the Autonomy Edge API over ${url.protocol}//${url.host}: ` +
      'credentials may only travel over https, or over http to this machine. ' +
      'Set OPENPLC_EDGE_API_URL to an https URL.',
  )
}

export interface EdgeHttpResponse {
  status: number
  body: string
}

export interface EdgeRequestInit {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  json?: unknown
  /** Pre-encoded body with its own content type. Mutually exclusive with `json`; `json` wins. */
  raw?: { body: Buffer; contentType: string }
  accessToken?: string | null
  timeoutMs?: number
  headers?: Record<string, string>
}

// Shared by the buffered and streaming paths so the guard, Content-Length and bearer
// header cannot drift.
function prepareRequest(
  path: string,
  init: EdgeRequestInit,
  accept: string,
): { url: URL; options: https.RequestOptions; payload: Buffer | undefined } {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${getEdgeApiBaseUrl()}/`)

  assertTransportIsConfidential(url)

  const json = init.json === undefined ? undefined : JSON.stringify(init.json)
  const payload = json !== undefined ? Buffer.from(json, 'utf-8') : init.raw?.body

  const headers: Record<string, string> = {
    ...init.headers,
    Accept: accept,
    'User-Agent': 'OpenPLC-Editor/edge-account',
  }

  if (payload !== undefined) {
    // Content-Length is the byte length: a non-ASCII password makes it differ from the
    // string length.
    headers['Content-Type'] = json !== undefined ? 'application/json' : (init.raw?.contentType ?? 'application/json')
    headers['Content-Length'] = String(payload.length)
  }

  if (init.accessToken) {
    headers.Authorization = `Bearer ${init.accessToken}`
  }

  return {
    url,
    options: {
      hostname: url.hostname,
      port: url.port || defaultPortFor(url),
      path: url.pathname + url.search,
      method: init.method ?? 'GET',
      headers,
    },
    payload,
  }
}

export function edgeRequest(path: string, init: EdgeRequestInit = {}): Promise<EdgeHttpResponse> {
  return new Promise((resolve, reject) => {
    const { url, options, payload } = prepareRequest(path, init, 'application/json')

    const req = httpModuleFor(url).request(options, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body })
      })
    })

    const timeoutMs = init.timeoutMs ?? REQUEST_TIMEOUT_MS

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Edge account request timed out after ${timeoutMs}ms`))
    })

    req.on('error', reject)

    if (payload !== undefined) {
      req.write(payload)
    }

    req.end()
  })
}

// Idle budget, not a total one: `setTimeout` arms the socket, which is quiet only while
// nothing arrives.
const STREAM_IDLE_TIMEOUT_MS = 60_000

const MAX_ERROR_BODY_CHARS = 64 * 1024

/** The body travels with the status: a 402 carries the billing payload. */
export class EdgeStreamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Autonomy Edge answered ${status}.`)
    this.name = 'EdgeStreamHttpError'
  }
}

/** Exactly one of `onEnd`/`onError` fires, once; nothing fires after `cancel`. */
export interface EdgeStreamSink {
  /** Chunk boundaries are whatever the network produced; framing is the caller's job. */
  onChunk(text: string): void
  /** Delivered once the headers are in, before any chunk. */
  onStatus(status: number): void
  onEnd(): void
  onError(error: Error): void
}

export interface EdgeStreamHandle {
  /** Drops the request and tears down the socket so the server stops generating. */
  cancel(): void
}

/** A non-2xx is buffered into `onError`; nothing throws. */
export function edgeStreamRequest(path: string, init: EdgeRequestInit, sink: EdgeStreamSink): EdgeStreamHandle {
  let closed = false
  let abort = (): void => {
    closed = true
  }

  const settle = (report: () => void): void => {
    if (closed) {
      return
    }

    closed = true
    report()
  }

  try {
    const { url, options, payload } = prepareRequest(path, init, 'text/event-stream')

    const req = httpModuleFor(url).request(options, (res) => {
      if (closed) {
        // Cancelled in flight: nothing is owed to the sink, but the socket still has to go.
        res.destroy()

        return
      }

      const status = res.statusCode ?? 0

      // setEncoding, not a per-chunk toString: a multi-byte char split across TCP
      // segments would garble.
      res.setEncoding('utf-8')
      sink.onStatus(status)

      if (status < 200 || status >= 300) {
        let body = ''

        res.on('data', (chunk: string) => {
          if (body.length < MAX_ERROR_BODY_CHARS) {
            body += chunk
          }
        })
        res.on('end', () => settle(() => sink.onError(new EdgeStreamHttpError(status, body))))
        res.on('error', (error: Error) => settle(() => sink.onError(error)))

        return
      }

      res.on('data', (chunk: string) => {
        if (!closed) {
          sink.onChunk(chunk)
        }
      })
      res.on('end', () => settle(() => sink.onEnd()))
      res.on('error', (error: Error) => settle(() => sink.onError(error)))
    })

    const timeoutMs = init.timeoutMs ?? STREAM_IDLE_TIMEOUT_MS

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Edge stream went quiet for ${timeoutMs}ms`))
    })

    req.on('error', (error: Error) => settle(() => sink.onError(error)))

    abort = () => {
      closed = true
      req.destroy()
    }

    if (payload !== undefined) {
      req.write(payload)
    }

    req.end()
  } catch (error) {
    settle(() => sink.onError(error instanceof Error ? error : new Error(String(error))))
  }

  return {
    cancel() {
      abort()
    },
  }
}

/** `unknown` on purpose; use `parseJsonBodyAs` for a typed value. */
export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export function parseJsonBodyAs<Output>(body: string, schema: z.ZodType<Output, z.ZodTypeDef, unknown>): Output | null {
  // Parameterised on the output type, not the schema: `z.ZodTypeAny` makes `safeParse`
  // return `any`.
  const parsed = schema.safeParse(parseJsonBody(body))

  return parsed.success ? parsed.data : null
}
