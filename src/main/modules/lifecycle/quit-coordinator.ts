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
  webContents: { send(channel: string): void }
}

type QuitEvent = { preventDefault(): void }

export interface QuitCoordinator {
  handleBeforeQuit(event: QuitEvent): void
  handleWindowClose(event: QuitEvent): void
  requestQuit(): void
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
  quitApp: () => void
  stopSimulator: () => void
  canPrompt: (window: QuitWindow) => boolean
}): QuitCoordinator {
  // Only confirmation commits to shutdown. A dismissed prompt leaves no intent behind.
  let confirmed = false

  const liveWindow = () => {
    const window = getWindow()
    return window && !window.isDestroyed() ? window : null
  }

  const requestQuit = () => {
    if (confirmed) return
    const window = liveWindow()
    if (!window) {
      stopSimulator()
      quitApp()
      return
    }
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
    window.webContents.send('app:quit-requested')
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
      // Bypass beforeunload now that saving/discarding has been confirmed.
      liveWindow()?.destroy()
      quitApp()
    },
  }
}
