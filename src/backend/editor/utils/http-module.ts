/**
 * Pick the Node request module that matches a URL's scheme.
 *
 * The edge clients (`desktop-catalog-transport`, `license-activation-client`)
 * were both written against `https.request` directly. That is right for
 * production — every deployed edge host is HTTPS — but it makes the base-URL
 * override (`OPENPLC_EDGE_API_URL`) a lie: pointing it at a local backend
 * (`http://localhost:3333`, the port the autonomy-edge dev server binds) sends
 * a TLS ClientHello to a plain HTTP socket. The connection dies with EPROTO /
 * ECONNRESET, the client's catch turns that into a generic failure, and the
 * editor silently falls back to demo mode. The result is that the one contract
 * we most need to exercise end-to-end cannot be exercised locally at all.
 *
 * `http.request` and `https.request` share a call signature, so a scheme-driven
 * lookup is a drop-in for either call site.
 */

import http from 'http'
import https from 'https'

/** Node's `http`/`https` share the `request` signature we rely on. */
export type NodeRequestModule = Pick<typeof https, 'request'>

/**
 * The request module for `url`'s scheme. Defaults to `https` for anything that
 * is not explicitly `http:` — an unparseable or exotic URL should not silently
 * downgrade to plaintext.
 */
export function httpModuleFor(url: string | URL): NodeRequestModule {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url
    return parsed.protocol === 'http:' ? http : https
  } catch {
    return https
  }
}

/** Default port for a URL that does not carry one, by scheme. */
export function defaultPortFor(url: string | URL): number {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url
    return parsed.protocol === 'http:' ? 80 : 443
  } catch {
    return 443
  }
}
