/**
 * Desktop implementation of `CatalogTransportPort` for the Electron
 * main process.
 *
 * Wraps Node `https.request` in a small Promise façade that:
 *   - resolves the base URL from `OPENPLC_EDGE_API_URL` (defaulting
 *     to https://api.autonomylogic.com),
 *   - serialises query parameters,
 *   - accumulates the response body as a utf-8 string,
 *   - turns non-2xx HTTP responses into thrown `Error`s the catalog
 *     client surfaces verbatim,
 *   - honours an AbortSignal so debounced / cancelled UI calls don't
 *     leak in-flight requests.
 *
 * Built on the same `https.request` primitive the runtime-comms code
 * already uses; deliberately not added on top of `electron.net.fetch`
 * to stay framework-light and easy to mock in unit tests.
 */

import https from 'https'

import type { CatalogQueryParams, CatalogTransportPort } from '../../../middleware/shared/ports/catalog-transport-port'

/** Default base URL when no env override is set. */
const DEFAULT_EDGE_API_URL = 'https://api.autonomylogic.com'

/** Request timeout — covers catalog browsing AND `.stlib` downloads,
 *  which can be a few hundred KB.  Errs long; the user is in front of
 *  the modal and would rather see a real result than a premature retry. */
const REQUEST_TIMEOUT_MS = 30_000

export function getEdgeApiBaseUrl(): string {
  const fromEnv = process.env.OPENPLC_EDGE_API_URL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/+$/, '') : DEFAULT_EDGE_API_URL
}

export function createDesktopCatalogTransport(): CatalogTransportPort {
  return {
    async fetchJson<T>(path: string, params?: CatalogQueryParams, signal?: AbortSignal): Promise<T> {
      const body = await requestText(buildUrl(path, params), signal)
      try {
        return JSON.parse(body) as T
      } catch (err) {
        throw new Error(`Catalog response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
      }
    },

    fetchText(path: string, signal?: AbortSignal): Promise<string> {
      return requestText(buildUrl(path), signal)
    },
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildUrl(path: string, params?: CatalogQueryParams): string {
  const base = getEdgeApiBaseUrl()
  const url = new URL(path.startsWith('/') ? path : `/${path}`, base + '/')
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function requestText(url: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError())
      return
    }

    const parsed = new URL(url)
    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        Accept: 'application/json, application/octet-stream;q=0.9, */*;q=0.5',
        'User-Agent': 'OpenPLC-Editor/library-catalog',
      },
    }

    const req = https.request(reqOptions, (res) => {
      // Accumulate as a single utf-8 string instead of buffering raw
      // chunks — sidesteps the Buffer[] vs Uint8Array[] friction in
      // recent @types/node and matches the existing httpRequest in
      // main.ts.  The body is JSON or a JSON-formatted .stlib, so
      // string concatenation is the right model anyway.
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('end', () => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          reject(
            new Error(`Catalog request failed: ${status} ${res.statusMessage ?? ''} ${truncate(body, 200)}`.trim()),
          )
          return
        }
        resolve(body)
      })
    })

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Catalog request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })

    req.on('error', (err) => reject(err))

    if (signal) {
      const onAbort = () => {
        req.destroy(makeAbortError())
      }
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    req.end()
  })
}

function makeAbortError(): Error {
  const err = new Error('Catalog request aborted')
  err.name = 'AbortError'
  return err
}

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '…'
}
