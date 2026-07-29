/**
 * SystemPort — Abstracts application-level platform services.
 *
 * Editor adapter: Delegates to Electron APIs (electron-store, shell, app).
 * Web adapter:    Uses browser APIs (localStorage, window.open, navigator).
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.getSystemInfo()
 *   - window.bridge.getStoreValue()
 *   - window.bridge.setStoreValue()
 *   - window.bridge.openExternalLinkAccelerator()
 *   - window.bridge.log()
 *
 * ## Web equivalents:
 *   - navigator.userAgent / window.matchMedia for system info
 *   - localStorage for persistent key-value storage
 *   - window.open() for external links
 *   - console.log/error for logging
 */

import type { SystemInfo } from './types'

export interface SystemPort {
  /** Get platform info (OS, architecture, dark mode preference, window state). */
  getSystemInfo(): Promise<SystemInfo>

  /**
   * Get a persistent key-value store value.
   * Editor: reads from electron-store.
   * Web: reads from localStorage.
   */
  getStoreValue(key: string): Promise<unknown>

  /**
   * Set a persistent key-value store value.
   * Editor: writes to electron-store.
   * Web: writes to localStorage.
   */
  setStoreValue(key: string, value: string): void

  /**
   * Open an external URL in the default browser.
   * Editor: uses shell.openExternal().
   * Web: uses window.open().
   */
  openExternalLink(url: string): Promise<{ success: boolean }>

  /**
   * Log a message (for diagnostics, not UI console).
   * Editor: logs via main process logger.
   * Web: logs via console or remote logging service.
   */
  log(level: 'info' | 'error', message: string): void

  /**
   * Absolute base URL of the Autonomy Edge **web app** — the host that serves
   * user-facing pages such as `/buy`. NOT the API host: those are different
   * origins (`edge.autonomylogic.com` vs `api.autonomylogic.com`), and deriving
   * one from the other by string surgery would break the moment either moves.
   *
   * A port and not a shared constant because each platform resolves it
   * differently and both need to be pointable at a local Edge instance for
   * end-to-end testing — a hardcoded production host in shared UI cannot be.
   *
   * Editor: build-time env override (`OPENPLC_EDGE_WEB_URL`) over the production
   *         default. Web: `VITE_EDGE_FRONTEND_URL` (may be a same-origin prefix).
   */
  getEdgeFrontendUrl(): string
}
