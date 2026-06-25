/**
 * NavigationPort — Abstracts in-app and external navigation.
 *
 * Editor adapter: Falls back to `window.open` (new BrowserWindow) for
 *                 secondary windows; `navigate` is a best-effort
 *                 `window.location.href` fallback. The editor has no
 *                 SPA router, but the routed features (merge, history)
 *                 are gated behind `capabilities.hasVersionControl=false`
 *                 and never reached in practice.
 * Web adapter:    Delegates to TanStack Router's `router.navigate(...)`
 *                 for in-app navigation (preserves SPA state, no full
 *                 reload) and `window.open(url, '_blank')` for the
 *                 "open in a new tab" flow.
 *
 * Why a port: shared UI components like the version-control panel need
 * to navigate between pages (`/merge`, `/history`, `/?project_id=…`).
 * The web app uses TanStack Router; importing `useNavigate` directly in
 * shared code would break the editor at bundle time because the editor
 * doesn't depend on `@tanstack/react-router`. Going through a port lets
 * each platform implement navigation in its native way while exposing
 * the same interface to the shared UI.
 */

/**
 * Search/query params for a navigation. Values may be `undefined`, in
 * which case the adapter is expected to omit the key from the URL
 * entirely (instead of emitting an empty `key=` pair).
 */
export type NavigationSearch = Record<string, string | undefined>

export interface NavigationPort {
  /**
   * Navigate within the app to a route, preserving SPA state where
   * possible. On platforms without a router, this is a best-effort
   * fallback or a no-op.
   */
  navigate(path: string, search?: NavigationSearch): void

  /**
   * Open a route or external URL in a new window/tab.
   * Web: `window.open(url, '_blank')` (new tab).
   * Editor: `window.open(url, '_blank')` (new BrowserWindow).
   */
  openInNewWindow(path: string, search?: NavigationSearch): void

  /**
   * Exit the editor surface back to the host that embedded it.
   * Web: hard-redirects to the autonomy-edge project list
   *      (`${VITE_EDGE_FRONTEND_URL}/projects`).
   * Editor: no-op — the start screen reappears automatically once
   *         the project state has been cleared by the caller.
   *
   * Callers are expected to clear project state first (via the shared
   * `clearStatesOnCloseProject` action) so the editor view is in a
   * coherent "no project loaded" state before the platform decides
   * whether to stay (editor) or navigate away (web).
   */
  exitToHost(): void
}

/**
 * Build a `path?search` URL by serializing only the entries whose value
 * is a non-empty string, encoding both keys and values. Returned as an
 * absolute path so adapters can hand it directly to `window.open` or
 * `window.location.href`.
 */
export function buildNavigationUrl(path: string, search?: NavigationSearch): string {
  if (!search) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === '') continue
    params.set(key, value)
  }
  const query = params.toString()
  return query.length > 0 ? `${path}?${query}` : path
}
