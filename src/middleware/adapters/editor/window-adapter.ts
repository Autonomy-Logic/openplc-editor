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
 *   - window:project-open         (send)
 *   - app:quit                    (send)
 *   - app:request-quit            (send) — request confirmation
 *   - app:quit-requested          (on)   — show confirmation; carries the quit intent
 *   - window-controls:is-closing  (on)   — window close notification
 *   - window-controls:toggle-maximized (on) — maximize state change
 */

import type { Unsubscribe } from '../../shared/ports/types'
import type { QuitRequest, WindowPort } from '../../shared/ports/window-port'

/** Main sends `{ intent }`; anything else is an ordinary quit. */
function toQuitRequest(payload: unknown): QuitRequest {
  const install =
    typeof payload === 'object' && payload !== null && 'intent' in payload && payload.intent === 'install-update'
  return { intent: install ? 'install-update' : 'quit' }
}

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

    requestQuit(): void {
      window.bridge.requestQuitApp()
    },

    onQuitRequested(callback: (request: QuitRequest) => void): Unsubscribe {
      return window.bridge.quitRequested((_event, payload) => callback(toQuitRequest(payload)))
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

export function setMenuProjectOpen(open: boolean): void {
  window.bridge.setMenuProjectOpen(open)
}
