/**
 * ThemePort — Abstracts theme detection and switching.
 *
 * Editor adapter: Listens for IPC theme-update events from main process.
 *                 Main process detects OS theme changes via nativeTheme API.
 * Web adapter:    Uses window.matchMedia('(prefers-color-scheme: dark)') listener.
 *                 May also read theme preference from localStorage.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.handleUpdateTheme()
 *   - window.bridge.winHandleUpdateTheme()
 *
 * ## Web equivalents:
 *   - matchMedia listener
 *   - localStorage theme preference
 *   - theme.ts utility
 */

import type { Unsubscribe } from './types'

export type ThemeVariant = 'light' | 'dark' | 'nineties'

export interface ThemePort {
  /** Get the current active theme. */
  getCurrentTheme(): ThemeVariant

  /** Set the theme explicitly (persists the preference). */
  setTheme(theme: ThemeVariant): void

  /** Toggle between light and dark themes. */
  toggleTheme(): void

  /**
   * Subscribe to theme change events (OS-level or user-initiated).
   * Returns unsubscribe function.
   */
  onThemeChanged(callback: (theme: ThemeVariant) => void): Unsubscribe
}
