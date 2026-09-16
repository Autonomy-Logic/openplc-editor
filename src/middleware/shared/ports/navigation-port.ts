/** The editor has no SPA router, so shared UI navigates through this port instead of importing the router. */

/** An `undefined` value is dropped from the URL rather than emitted as an empty `key=`. */
export type NavigationSearch = Record<string, string | undefined>

export interface NavigationPort {
  navigate(path: string, search?: NavigationSearch): void

  openInNewWindow(path: string, search?: NavigationSearch): void

  /** Callers must clear project state before calling. */
  exitToHost(): void
}

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
