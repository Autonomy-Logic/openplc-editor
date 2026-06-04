/**
 * Editor ThemePort adapter — owns theme state for the desktop app.
 *
 * The shared frontend surface (display menu, app-layout, accelerator
 * handler) no longer touches localStorage or the <html> classes directly —
 * the platform's theme adapter owns persistence and DOM application (the
 * web adapter additionally syncs a cross-subdomain cookie and the edge
 * backend; on desktop neither applies). This adapter therefore:
 *
 *   - reads the stored preference (localStorage `theme`) at creation and
 *     applies the <html> class before the UI mounts
 *   - applies + persists explicit changes from `setTheme`/`toggleTheme`,
 *     driving Electron's nativeTheme for light/dark via IPC
 *   - listens for theme events from the main process (native menu) and
 *     mirrors them into the DOM and subscribers
 *
 * IPC flow:
 *   Renderer → winHandleUpdateTheme(theme) → main sets nativeTheme + store
 *   Main (native menu) → handleUpdateTheme() → renderer applies + notifies
 *
 * 'nineties' is a UI-only retro skin: it has no OS-level counterpart, so
 * it never drives nativeTheme and is light-based for Monaco purposes.
 */

import type { ThemePort, ThemeVariant } from '../../shared/ports/theme-port'
import type { Unsubscribe } from '../../shared/ports/types'

const STORAGE_KEY = 'theme'

function getSystemThemePreference(): ThemeVariant {
  // In Electron this reflects nativeTheme, which the main process restored
  // from electron-store at startup.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readExplicitPreference(): ThemeVariant | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' || stored === 'light' || stored === 'nineties' ? stored : null
}

function applyThemeToDOM(theme: ThemeVariant): void {
  const root = document.documentElement
  // Mutually-exclusive theme classes — clear all three, then set the active
  // one. 'nineties' is a light-based retro skin, so it never carries 'dark'.
  root.classList.remove('dark', 'light', 'nineties')
  root.classList.add(theme)
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
}

export function createEditorThemeAdapter(): ThemePort {
  let explicitPreference: ThemeVariant | null = readExplicitPreference()
  let currentTheme: ThemeVariant = explicitPreference ?? getSystemThemePreference()
  const listeners = new Set<(theme: ThemeVariant) => void>()

  applyThemeToDOM(currentTheme)

  function notifyListeners(): void {
    for (const cb of listeners) {
      cb(currentTheme)
    }
  }

  /** Record an explicit theme locally (state, DOM, localStorage) and notify. */
  function applyExplicitTheme(theme: ThemeVariant): void {
    explicitPreference = theme
    localStorage.setItem(STORAGE_KEY, theme)
    if (theme === currentTheme) return
    currentTheme = theme
    applyThemeToDOM(theme)
    notifyListeners()
  }

  // Theme events from the main process (native menu picks, OS changes).
  window.bridge.handleUpdateTheme((_event: unknown, ...args: unknown[]) => {
    const theme = args[0]
    if (theme === 'light' || theme === 'dark' || theme === 'nineties') {
      // Explicit pick from the native menu — main already updated
      // nativeTheme + its store, so only mirror it locally (no echo IPC).
      applyExplicitTheme(theme)
      return
    }

    // No payload = an OS-level light/dark flip; don't flip off the retro
    // skin, and don't persist — it is not an explicit user choice.
    if (currentTheme === 'nineties') return
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
    applyThemeToDOM(currentTheme)
    notifyListeners()
  })

  return {
    getCurrentTheme(): ThemeVariant {
      return currentTheme
    },

    setTheme(theme: ThemeVariant): void {
      applyExplicitTheme(theme)
      // Passing the theme explicitly makes the IPC idempotent (no toggle
      // semantics), so the display menu's own bridge push is harmless.
      if (theme === 'light' || theme === 'dark') {
        window.bridge.winHandleUpdateTheme(theme)
      }
    },

    toggleTheme(): void {
      const next: ThemeVariant = currentTheme === 'dark' ? 'light' : 'dark'
      applyExplicitTheme(next)
      window.bridge.winHandleUpdateTheme(next)
    },

    onThemeChanged(callback: (theme: ThemeVariant) => void): Unsubscribe {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
  }
}
