/** NavigationPort abstracts in-app and external navigation; the editor has no SPA router, so shared UI goes through this instead of importing TanStack Router directly. */

/** Values may be `undefined`, in which case the adapter omits the key instead of emitting an empty `key=` pair. */
export type NavigationSearch = Record<string, string | undefined>

export interface NavigationPort {
  /** Navigate within the app to a route, preserving SPA state where possible. */
  navigate(path: string, search?: NavigationSearch): void

  /** Open a route or external URL in a new window/tab. */
  openInNewWindow(path: string, search?: NavigationSearch): void

  /** Exit the editor surface back to the host. Callers must clear project state first. */
  exitToHost(): void
}

/** Build a `path?search` URL, omitting entries whose value is empty or undefined. */
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
