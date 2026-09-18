/**
 * Editor WindowPort adapter — delegates to Electron BrowserWindow via IPC bridge.
 *
 * Maps WindowPort methods to the corresponding `window.bridge.*` calls
 * exposed by the preload script. The main process handles the actual
 * BrowserWindow operations (minimize, maximize, close, etc.).
 *
 * IPC channels used:
 *   - window-controls:minimize    (send)
 *   - window-controls:maximize    (send)
 *   - window-controls:close       (send) — triggers graceful close flow
 *   - window-controls:closed      (send) — force destroys window
 *   - window-controls:hide        (send)
 *   - window:reload               (send)
 *   - window:rebuild-menu         (send)
 *   - app:quit                    (send)
 *   - window-controls:is-closing  (on)   — window close notification
 *   - app:darwin-is-closing       (on)   — macOS quit notification
 *   - window-controls:toggle-maximized (on) — maximize state change
 */

import type { Unsubscribe } from '../../shared/ports/types'
import type { WindowPort } from '../../shared/ports/window-port'

export function createEditorWindowAdapter(): WindowPort {
  return {
    minimize(): void {
      window.bridge.minimizeWindow()
    },

    maximize(): void {
      window.bridge.maximizeWindow()
    },

    close(): void {
      window.bridge.handleCloseOrHideWindow()
    },

    hide(): void {
      window.bridge.hideWindow()
    },

    reload(): void {
      window.bridge.reloadWindow()
    },

    quit(): void {
      window.bridge.handleQuitApp()
    },

    rebuildMenu(): void {
      window.bridge.rebuildMenu()
    },

    onCloseRequested(callback: () => void): Unsubscribe {
      return window.bridge.windowIsClosing(() => callback())
    },

    onDarwinAppQuitting(callback: () => void): Unsubscribe {
      return window.bridge.darwinAppIsClosing(() => callback())
    },

    enableAutoCloseHandshake(): Unsubscribe {
      return window.bridge.handleCloseOrHideWindowAccelerator()
    },

    onMaximizedChanged(callback: (isMaximized: boolean) => void): Unsubscribe {
      let maximized = false

      return window.bridge.isMaximizedWindow(() => {
        maximized = !maximized
        callback(maximized)
      })
    },
  }
}
