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

export interface EdgeHttpResponse {
  status: number
  body: string
}

export interface EdgeRequestInit {
  method?: 'GET' | 'POST'
  /** Serialised and sent as `application/json`. */
  json?: unknown
  /** Bearer token, for the routes that need one. */
  accessToken?: string | null
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
    const payload = init.json === undefined ? undefined : JSON.stringify(init.json)

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'OpenPLC-Editor/edge-account',
    }

    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json'
      // Byte length, not string length. A password with non-ASCII characters makes
      // the two differ, and a short Content-Length truncates the body server-side
      // into a validation error that reads like a wrong password.
      headers['Content-Length'] = String(Buffer.byteLength(payload))
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

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Edge account request timed out after ${REQUEST_TIMEOUT_MS}ms`))
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
 */
export function parseJsonBody<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T
  } catch {
    return null
  }
}
