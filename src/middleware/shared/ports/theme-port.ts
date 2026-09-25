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

export type ThemeVariant = 'light' | 'dark' | 'nineties' | 'squareteal'

/**
 * Themes that opt into the "square" FBD editor look — 90° (step) wires and
 * grey function-block bodies instead of the default smooth/white style.
 * Add a theme here to enable the square FBD style for it.
 */
export const SQUARE_FBD_THEMES: ReadonlySet<ThemeVariant> = new Set(['squareteal'])

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
