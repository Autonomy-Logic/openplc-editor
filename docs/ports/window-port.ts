/**
 * WindowPort — Abstracts native window management.
 *
 * Editor adapter: Delegates to Electron BrowserWindow APIs via IPC.
 * Web adapter:    No-op implementation (browser tabs managed by the browser itself).
 *                 Some methods may map to browser equivalents where applicable.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.minimizeWindow()
 *   - window.bridge.maximizeWindow()
 *   - window.bridge.closeWindow()
 *   - window.bridge.hideWindow()
 *   - window.bridge.reloadWindow()
 *   - window.bridge.handleCloseOrHideWindow()
 *   - window.bridge.handleQuitApp()
 *   - window.bridge.rebuildMenu()
 *   - window.bridge.isMaximizedWindow()
 *   - window.bridge.windowIsClosing()
 *   - window.bridge.darwinAppIsClosing()
 *
 * ## Web equivalents:
 *   - Most methods are no-ops in the browser
 *   - reload -> window.location.reload()
 *   - close -> handled by browser tab close (beforeunload event)
 */

import type { Unsubscribe } from './types'

export interface WindowPort {
  /** Minimize the application window. No-op on web. */
  minimize(): void

  /** Maximize/restore the application window. No-op on web. */
  maximize(): void

  /** Close the application window. Web: triggers beforeunload. */
  close(): void

  /** Hide the application window (minimize to tray). No-op on web. */
  hide(): void

  /** Reload the application. Web: window.location.reload(). */
  reload(): void

  /** Quit the application entirely. No-op on web. */
  quit(): void

  /** Rebuild the native application menu. No-op on web. */
  rebuildMenu(): void

  /**
   * Subscribe to window close/quit requests.
   * Editor: fires when user clicks close button or uses Cmd+Q.
   * Web: fires on beforeunload event.
   */
  onCloseRequested(callback: () => void): Unsubscribe

  /**
   * Subscribe to window maximize/restore toggle events.
   * Editor: fires when window state changes.
   * Web: no-op (never fires).
   */
  onMaximizedChanged?(callback: (isMaximized: boolean) => void): Unsubscribe
}
