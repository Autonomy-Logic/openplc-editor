import type { WindowPort } from '../../../shared/ports/window-port'
import { createEditorWindowAdapter } from '../window-adapter'

let adapter: WindowPort
const capturedHandlers: Record<string, ((...args: unknown[]) => void) | null> = {}

beforeEach(() => {
  for (const key of Object.keys(capturedHandlers)) {
    capturedHandlers[key] = null
  }

  window.bridge = {
    minimizeWindow: jest.fn(),
    maximizeWindow: jest.fn(),
    handleCloseOrHideWindow: jest.fn(),
    hideWindow: jest.fn(),
    reloadWindow: jest.fn(),
    handleQuitApp: jest.fn(),
    rebuildMenu: jest.fn(),
    windowIsClosing: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.closeRequested = cb
    }),
    darwinAppIsClosing: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.darwinQuitting = cb
    }),
    handleCloseOrHideWindowAccelerator: jest.fn(),
    removeHandleCloseOrHideWindowAccelerator: jest.fn(),
    isMaximizedWindow: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.maximized = cb
    }),
  } as unknown as typeof window.bridge

  adapter = createEditorWindowAdapter()
})

describe('minimize', () => {
  it('delegates to bridge', () => {
    adapter.minimize()
    expect(window.bridge.minimizeWindow).toHaveBeenCalledTimes(1)
  })
})

describe('maximize', () => {
  it('delegates to bridge', () => {
    adapter.maximize()
    expect(window.bridge.maximizeWindow).toHaveBeenCalledTimes(1)
  })
})

describe('close', () => {
  it('delegates to bridge', () => {
    adapter.close()
    expect(window.bridge.handleCloseOrHideWindow).toHaveBeenCalledTimes(1)
  })
})

describe('hide', () => {
  it('delegates to bridge', () => {
    adapter.hide()
    expect(window.bridge.hideWindow).toHaveBeenCalledTimes(1)
  })
})

describe('reload', () => {
  it('delegates to bridge', () => {
    adapter.reload()
    expect(window.bridge.reloadWindow).toHaveBeenCalledTimes(1)
  })
})

describe('quit', () => {
  it('delegates to bridge', () => {
    adapter.quit()
    expect(window.bridge.handleQuitApp).toHaveBeenCalledTimes(1)
  })
})

describe('rebuildMenu', () => {
  it('delegates to bridge', () => {
    adapter.rebuildMenu()
    expect(window.bridge.rebuildMenu).toHaveBeenCalledTimes(1)
  })
})

describe('onCloseRequested', () => {
  it('registers a bridge listener and fires callback', () => {
    const cb = jest.fn()
    adapter.onCloseRequested(cb)

    expect(window.bridge.windowIsClosing).toHaveBeenCalledTimes(1)
    capturedHandlers.closeRequested!()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('returns an unsubscribe function that deactivates the callback', () => {
    const cb = jest.fn()
    const unsub = adapter.onCloseRequested(cb)

    unsub()
    capturedHandlers.closeRequested!()

    expect(cb).not.toHaveBeenCalled()
  })
})

describe('onDarwinAppQuitting', () => {
  it('registers a bridge listener and fires callback', () => {
    const cb = jest.fn()
    adapter.onDarwinAppQuitting!(cb)

    expect(window.bridge.darwinAppIsClosing).toHaveBeenCalledTimes(1)
    capturedHandlers.darwinQuitting!()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('returns an unsubscribe function that deactivates the callback', () => {
    const cb = jest.fn()
    const unsub = adapter.onDarwinAppQuitting!(cb)

    unsub()
    capturedHandlers.darwinQuitting!()

    expect(cb).not.toHaveBeenCalled()
  })
})

describe('enableAutoCloseHandshake', () => {
  it('registers handshake and returns unsubscribe that removes it', () => {
    const unsub = adapter.enableAutoCloseHandshake!()

    expect(window.bridge.handleCloseOrHideWindowAccelerator).toHaveBeenCalledTimes(1)

    unsub()
    expect(window.bridge.removeHandleCloseOrHideWindowAccelerator).toHaveBeenCalledTimes(1)
  })
})

describe('onMaximizedChanged', () => {
  it('registers a bridge listener and toggles maximized state', () => {
    const cb = jest.fn()
    adapter.onMaximizedChanged!(cb)

    expect(window.bridge.isMaximizedWindow).toHaveBeenCalledTimes(1)

    capturedHandlers.maximized!()
    expect(cb).toHaveBeenCalledWith(true)

    capturedHandlers.maximized!()
    expect(cb).toHaveBeenCalledWith(false)
  })

  it('returns an unsubscribe function (no-op)', () => {
    const cb = jest.fn()
    const unsub = adapter.onMaximizedChanged!(cb)

    expect(typeof unsub).toBe('function')
    // The unsubscribe is a no-op for this channel, but should not throw
    unsub()
  })
})
