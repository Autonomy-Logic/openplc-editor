/**
 * CatalogTransportPort — platform-agnostic transport for the
 * autonomy-edge public-library catalog endpoints.
 *
 * The shared catalog client (see `public-catalog-client.ts`) owns the
 * URL paths, query-string assembly, and response-shape validation;
 * everything platform-specific (TLS config, base URL resolution,
 * cookie/header handling) lives behind this port.
 *
 *   - Desktop port (Electron main process): wraps Node `https.request`
 *     and reads `OPENPLC_EDGE_API_URL` for the base URL.
 *   - Web port (browser, future): wraps `fetch` and reuses the web
 *     app's existing API client base URL.
 *
 * Two methods are deliberately separate so platforms can choose
 * different encodings for binary-but-JSON payloads (the `.stlib`
 * archive is JSON content served as `application/octet-stream`; on
 * Node we accumulate as utf-8 string, on the browser we can read
 * either text or arrayBuffer).
 */

/** Query parameter values the catalog client emits — all scalar. */
export type CatalogQueryParams = Record<string, string | number | boolean | undefined>

export interface CatalogTransportPort {
  /**
   * Fetch a JSON-bodied endpoint and return the parsed body.  The
   * platform impl handles HTTP→Error conversion: non-2xx responses
   * must throw with a message the catalog client can surface in the
   * UI (e.g. `Catalog request failed: 503 Service Unavailable`).
   *
   * `signal` is honored when supplied — callers (debounced search,
   * unmounting modals) pass an AbortSignal so the impl can cancel
   * the in-flight request and avoid setState-after-unmount.
   */
  fetchJson<T>(path: string, params?: CatalogQueryParams, signal?: AbortSignal): Promise<T>

  /**
   * Fetch a binary-ish endpoint (today: the `.stlib` download) and
   * return its body as a utf-8 string.  The autonomy-edge download
   * endpoint serves `application/octet-stream`, but the bytes are a
   * JSON-formatted `.stlib` archive — string is a faithful container
   * for both consumers (Node `writeFileSync`, browser blob).  Non-2xx
   * must throw, same contract as `fetchJson`.
   */
  fetchText(path: string, signal?: AbortSignal): Promise<string>
}
