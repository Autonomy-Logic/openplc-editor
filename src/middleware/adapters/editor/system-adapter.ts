/**
 * Editor SystemPort adapter — delegates to Electron IPC bridge.
 *
 * Uses window.bridge methods to communicate with the main process
 * for system info, persistent storage (electron-store), external
 * links (shell.openExternal), and logging.
 *
 * IPC channels used:
 *   - system:get-system-info  (invoke)
 *   - app:store-get           (invoke)
 *   - app:store-set           (send)
 *   - open-external-link      (invoke)
 *   - util:log                (send)
 */

import type { SystemPort } from '../../shared/ports/system-port'
import type { SystemInfo } from '../../shared/ports/types'

export function createEditorSystemAdapter(): SystemPort {
  return {
    getSystemInfo(): Promise<SystemInfo> {
      return (
        window.bridge?.getSystemInfo?.() ??
        Promise.resolve({
          OS: '',
          architecture: '',
          prefersDarkMode: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
          isWindowMaximized: false,
        })
      )
    },

    getStoreValue(key: string): Promise<unknown> {
      return window.bridge?.getStoreValue?.(key) ?? Promise.resolve(localStorage.getItem(key))
    },

    setStoreValue(key: string, value: string): void {
      if (typeof window.bridge?.setStoreValue === 'function') {
        window.bridge.setStoreValue(key, value)
        return
      }
      localStorage.setItem(key, value)
    },

    openExternalLink(url: string): Promise<{ success: boolean }> {
      return window.bridge?.openExternalLinkAccelerator?.(url) ?? Promise.resolve({ success: false })
    },

    log(level: 'info' | 'error', message: string): void {
      window.bridge?.log?.(level, message)
    },
  }
}
