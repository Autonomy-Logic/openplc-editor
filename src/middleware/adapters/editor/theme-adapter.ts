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
      // 'nineties' is a UI-only retro skin (handled by the shared app-layout /
      // display menu via the `.nineties` class + localStorage); it has no
      // OS-level counterpart, so don't drive nativeTheme for it.
      if (theme === 'light' || theme === 'dark') {
        window.bridge.winHandleUpdateTheme()
      }
    },

    toggleTheme(): void {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
      window.bridge.winHandleUpdateTheme()
    },

    onThemeChanged(callback: (theme: ThemeVariant) => void): Unsubscribe {
      let active = true

      const handler = (_event: unknown) => {
        if (!active) return
        // While the retro skin is active, an OS light/dark change must not
        // flip us off it.
        if (currentTheme === 'nineties') return
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
        callback(currentTheme)
      }

      window.bridge.handleUpdateTheme(handler)

      return () => {
        active = false
      }
    },
  }
}
