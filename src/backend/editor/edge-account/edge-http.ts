/**
 * HTTP to the Autonomy Edge API, for the desktop editor's account session.
 *
 * WHY NOT THE CATALOG TRANSPORT. `desktop-catalog-transport` rejects on any non-2xx,
 * which is right for browsing a public catalog: there a 404 and a dropped connection
 * are equally "no catalog". Authentication cannot live with that. A 401 means the
 * credentials were wrong, a 404 on the subscription route means the account has no
 * plan, and a transport failure means NOTHING was established about the session.
 * Collapsing those into one thrown error is exactly the bug `EdgeUserRead`'s
 * `unknown` case exists to prevent — a two-second network blip must not be reported
 * as "you are signed out".
 *
 * So: this resolves with the status for every answer the server gives, and rejects
 * only when the server never answered.
 *
 * WHY IT LIVES IN THE MAIN PROCESS. The renderer is not on Edge's origin, so a
 * direct call from there is cross-origin against a host that has no reason to allow
 * it. The same reasoning already sends the library catalog through here. Built on the
 * same `httpModuleFor` primitive so `OPENPLC_EDGE_API_URL` can point at a local
 * backend over plain http.
 */

import type https from 'https'
import type { z } from 'zod'

import { defaultPortFor, httpModuleFor } from '../utils/http-module'

/** Default base URL when no env override is set. Mirrors the catalog transport. */
const DEFAULT_EDGE_API_URL = 'https://api.autonomylogic.com'

/**
 * Short on purpose: every call here has a user waiting on a sign-in button or an
 * avatar. The catalog can afford 30s for a multi-hundred-KB archive; an auth round
 * trip that takes more than 15s has already failed as far as the user is concerned.
 */
const REQUEST_TIMEOUT_MS = 15_000

/** The Edge API origin, honouring the same override the catalog transport reads. */
export function getEdgeApiBaseUrl(): string {
  const fromEnv = process.env.OPENPLC_EDGE_API_URL?.trim()

  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/+$/, '') : DEFAULT_EDGE_API_URL
}

/**
 * Whether a host is this machine.
 *
 * The same rule browsers use for a secure context: loopback is trusted without TLS
 * because the bytes never leave the machine, so no network can read them. Anything
 * else is a network hop, and a password on a network hop needs TLS.
 */
function isLoopbackHost(hostname: string): boolean {
  // `URL.hostname` keeps the brackets on an IPv6 literal.
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/**
 * Refuse to put a session on the wire in cleartext.
 *
 * `OPENPLC_EDGE_API_URL` exists so a developer can point the editor at a backend
 * running on their own machine, and that is the ONLY case plain http is acceptable
 * in: loopback bytes never reach a network. Pointed at any other host over http, the
 * override would send a password, and then every bearer token minted from it, to
 * whoever is on the path — so it is refused rather than downgraded silently.
 *
 * Rejecting (rather than resolving with a status) is deliberate and matches the
 * contract above: nothing was established about the session, which is exactly what a
 * transport failure means.
 */
function assertTransportIsConfidential(url: URL): void {
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
  method?: 'GET' | 'POST' | 'DELETE'
  /** Serialised and sent as `application/json`. */
  json?: unknown
  /**
   * A body that is already bytes, with its own content type — the multipart form
   * `POST /projects/import` wants, which no amount of JSON can express.
   *
   * Mutually exclusive with `json`; `json` wins if both are somehow set, because a
   * caller passing both has a bug and picking the structured one keeps the failure
   * legible instead of sending a form the server cannot parse.
   */
  raw?: { body: Buffer; contentType: string }
  /** Bearer token, for the routes that need one. */
  accessToken?: string | null
  /**
   * Overrides {@link REQUEST_TIMEOUT_MS}. Version control needs it: committing or
   * switching a branch runs a real git operation on the server against a whole
   * project, and 15s is a budget sized for an auth round trip, not for that.
   */
  timeoutMs?: number
}

/**
 * One request to the Edge API.
 *
 * Resolves for every HTTP answer, including 4xx and 5xx — read `status` to decide
 * what happened. Rejects only when there was no answer at all (offline, DNS, refused
 * connection, timeout), which is the caller's signal that nothing was learned rather
 * than that something was denied.
 */
export function edgeRequest(path: string, init: EdgeRequestInit = {}): Promise<EdgeHttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${getEdgeApiBaseUrl()}/`)

    // Before anything is serialised: a body built here may hold a password.
    assertTransportIsConfidential(url)

    const json = init.json === undefined ? undefined : JSON.stringify(init.json)
    // Bytes either way, so one write path serves both. A JSON string is encoded here
    // rather than by `req.write`'s default so its Content-Length below is measured on
    // exactly what goes out.
    const payload = json !== undefined ? Buffer.from(json, 'utf-8') : init.raw?.body

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'OpenPLC-Editor/edge-account',
    }

    if (payload !== undefined) {
      // Byte length, not string length. A password with non-ASCII characters makes
      // the two differ, and a short Content-Length truncates the body server-side
      // into a validation error that reads like a wrong password.
      headers['Content-Type'] = json !== undefined ? 'application/json' : (init.raw?.contentType ?? 'application/json')
      headers['Content-Length'] = String(payload.length)
    }

    if (init.accessToken) {
      headers.Authorization = `Bearer ${init.accessToken}`
    }

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || defaultPortFor(url),
      path: url.pathname + url.search,
      method: init.method ?? 'GET',
      headers,
    }

    // Scheme-driven, so OPENPLC_EDGE_API_URL can point at the dev backend on
    // http://localhost:3333 without sending a TLS handshake to a plain socket.
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

/**
 * Parse a JSON envelope, tolerating anything.
 *
 * Every failure mode — empty body, a proxy's HTML error page, a truncated response —
 * means "the server did not tell us what we asked", and every caller treats a missing
 * field the same way. Returning null rather than throwing keeps that decision in one
 * place instead of wrapping each call site in a try.
 *
 * Returns `unknown` on purpose. It used to be generic, which let a caller name a type
 * the bytes were never checked against: a 200 whose `accessToken` came back as a
 * number satisfied `TokenPair` at compile time and became session state at runtime.
 * Use {@link parseJsonBodyAs} to get a typed value out of a response.
 */
export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/**
 * Parse a JSON envelope and validate it against a schema.
 *
 * Null for both failure modes — unparseable bytes and a shape the server should not
 * have sent — because no caller here distinguishes them: either way the server did
 * not answer the question that was asked. Callers that want the difference should
 * parse and validate in two steps.
 */
export function parseJsonBodyAs<Output>(body: string, schema: z.ZodType<Output, z.ZodTypeDef, unknown>): Output | null {
  // Parameterised on the OUTPUT type rather than on the schema. `z.ZodTypeAny` types
  // `safeParse` as returning `any`, which would hand the caller an unchecked value out
  // of the one function whose job is to check it.
  const parsed = schema.safeParse(parseJsonBody(body))

  return parsed.success ? parsed.data : null
}
