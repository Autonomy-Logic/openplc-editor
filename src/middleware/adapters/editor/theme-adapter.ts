/**
 * Editor ThemePort adapter — delegates to Electron IPC bridge.
 *
 * Uses nativeTheme on the main process side (via `window.bridge`)
 * for OS-level theme detection and persistence via electron-store.
 *
 * Initial theme is read synchronously from matchMedia, which in Electron
 * reflects the nativeTheme state set by the main process on startup.
 *
 * IPC flow:
 *   Renderer → winHandleUpdateTheme() → main toggles nativeTheme
 *   Main → handleUpdateTheme() → renderer updates local state
 */

import type { ThemePort, ThemeVariant } from '../../shared/ports/theme-port'
import type { Unsubscribe } from '../../shared/ports/types'

export function createEditorThemeAdapter(): ThemePort {
  let currentTheme: ThemeVariant = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

  return {
    getCurrentTheme(): ThemeVariant {
      return currentTheme
    },

    setTheme(theme: ThemeVariant): void {
      currentTheme = theme
      window.bridge?.winHandleUpdateTheme?.()
    },

    toggleTheme(): void {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
      window.bridge?.winHandleUpdateTheme?.()
    },

    onThemeChanged(callback: (theme: ThemeVariant) => void): Unsubscribe {
      let active = true

      const handler = (_event: unknown) => {
        if (!active) return
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
        callback(currentTheme)
      }

      if (typeof window.bridge?.handleUpdateTheme !== 'function') {
        return () => {
          active = false
        }
      }

      window.bridge.handleUpdateTheme(handler)

      return () => {
        active = false
      }
    },
  }
}
