/** The window operations needed to distinguish closing a window from quitting. */
export interface QuitWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  show(): void
  restore(): void
  focus(): void
  hide(): void
  destroy(): void
  webContents: { send(channel: string, ...args: unknown[]): void }
}

type QuitEvent = { preventDefault(): void }

/**
 * What a confirmed quit does next. `install-update` swaps the app for a
 * downloaded update and reopens it, which only the updater can do, so the
 * coordinator hands the intent to `quitApp` instead of calling `app.quit()`.
 */
export type QuitIntent = 'quit' | 'install-update'

export interface QuitCoordinator {
  handleBeforeQuit(event: QuitEvent): void
  handleWindowClose(event: QuitEvent): void
  /** Ask the renderer to confirm a quit. The intent belongs to this request only. */
  requestQuit(intent?: QuitIntent): void
  confirmQuit(): void
}

export function createQuitCoordinator({
  platform,
  getWindow,
  quitApp,
  stopSimulator,
  canPrompt,
}: {
  platform: NodeJS.Platform
  getWindow: () => QuitWindow | null
  quitApp: (intent: QuitIntent) => void
  stopSimulator: () => void
  canPrompt: (window: QuitWindow) => boolean
}): QuitCoordinator {
  // Only confirmation commits to shutdown. A dismissed prompt leaves no intent behind.
  let confirmed = false
  // Every request states its own intent, because the renderer never reports a
  // dismissed prompt: a "Restart now" the user cancelled must not turn the next
  // ordinary Cmd+Q into an install and relaunch.
  let intent: QuitIntent = 'quit'

  const liveWindow = () => {
    const window = getWindow()
    return window && !window.isDestroyed() ? window : null
  }

  const requestQuit = (next: QuitIntent = 'quit') => {
    if (confirmed) return
    intent = next
    const window = liveWindow()
    if (!window) {
      stopSimulator()
      quitApp(intent)
      return
    }
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
    // The renderer skips its "quit?" confirmation for an install the user just asked for.
    window.webContents.send('app:quit-requested', { intent })
  }

  return {
    handleBeforeQuit(event) {
      if (confirmed) return
      const window = liveWindow()
      // A crashed or still-loading renderer cannot show the prompt, so holding the quit would swallow it.
      if (platform !== 'darwin' || !window || !canPrompt(window)) {
        stopSimulator()
        window?.destroy()
        return
      }
      event.preventDefault()
      requestQuit()
    },
    handleWindowClose(event) {
      if (confirmed || platform !== 'darwin') return
      const window = liveWindow()
      if (!window) return
      event.preventDefault()
      window.hide()
    },
    requestQuit,
    confirmQuit() {
      if (confirmed) return
      confirmed = true
      stopSimulator()
      if (intent === 'install-update') {
        // The install runs before the window goes. On Linux and Windows the last
        // window closing quits the app on the spot, and electron-updater's own
        // quit hook would then install silently without reopening the editor.
        // The updater defers its app.quit(), so the window is gone by then.
        quitApp(intent)
        liveWindow()?.destroy()
        return
      }
      // Bypass beforeunload now that saving/discarding has been confirmed.
      liveWindow()?.destroy()
      quitApp(intent)
    },
  }
}
