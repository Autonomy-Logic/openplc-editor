import type { WindowPort } from '../../../shared/ports/window-port'
import { createEditorWindowAdapter } from '../window-adapter'

let adapter: WindowPort

/**
 * A captured handler going back to `null` stands in for the real bridge
 * dropping the IPC listener — the adapter must return the bridge's disposer
 * verbatim for that to happen.
 */
const capturedHandlers: Record<string, ((...args: unknown[]) => void) | null> = {}

/**
 * Narrows an optional `WindowPort` member. CLAUDE.md forbids non-null
 * assertions, and a bare `?.()` would let a missing implementation pass the
 * test silently — this fails loudly instead.
 */
function implemented<T>(member: T | undefined, name: string): T {
  if (!member) throw new Error(`WindowPort.${name} is not implemented by the editor adapter`)
  return member
}

/** Invokes a captured bridge listener, failing loudly if none was registered. */
const fire = (key: string, ...args: unknown[]): void => {
  const handler = capturedHandlers[key]
  if (!handler) throw new Error(`no listener captured for "${key}"`)
  handler(...args)
}

/** Emits on a channel whose listener may already be gone — used after an
 *  unsubscribe to show the callback stays silent. */
const fireIfRegistered = (key: string, ...args: unknown[]): void => {
  capturedHandlers[key]?.(...args)
}

/** Mirrors the bridge contract: register the listener, return its disposer. */
const register = (key: string) =>
  jest.fn().mockImplementation((cb: (...args: unknown[]) => void) => {
    capturedHandlers[key] = cb
    return () => {
      capturedHandlers[key] = null
    }
  })

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
    windowIsClosing: register('closeRequested'),
    darwinAppIsClosing: register('darwinQuitting'),
    // Takes no callback of its own — the main process echoes the close back —
    // but still hands out a disposer for the listener it registered.
    handleCloseOrHideWindowAccelerator: jest.fn().mockImplementation(() => {
      capturedHandlers.autoCloseHandshake = () => {}
      return () => {
        capturedHandlers.autoCloseHandshake = null
      }
    }),
    isMaximizedWindow: register('maximized'),
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
    fire('closeRequested')

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('returns an unsubscribe function that removes the bridge listener', () => {
    const cb = jest.fn()
    const unsub = adapter.onCloseRequested(cb)

    unsub()
    fireIfRegistered('closeRequested')

    expect(cb).not.toHaveBeenCalled()
    expect(capturedHandlers.closeRequested).toBeNull()
  })
})

describe('onDarwinAppQuitting', () => {
  it('registers a bridge listener and fires callback', () => {
    const cb = jest.fn()
    implemented(adapter.onDarwinAppQuitting, 'onDarwinAppQuitting')(cb)

    expect(window.bridge.darwinAppIsClosing).toHaveBeenCalledTimes(1)
    fire('darwinQuitting')

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('returns an unsubscribe function that removes the bridge listener', () => {
    const cb = jest.fn()
    const unsub = implemented(adapter.onDarwinAppQuitting, 'onDarwinAppQuitting')(cb)

    unsub()
    fireIfRegistered('darwinQuitting')

    expect(cb).not.toHaveBeenCalled()
    expect(capturedHandlers.darwinQuitting).toBeNull()
  })
})

describe('enableAutoCloseHandshake', () => {
  it('registers handshake and returns unsubscribe that removes it', () => {
    const unsub = implemented(adapter.enableAutoCloseHandshake, 'enableAutoCloseHandshake')()

    expect(window.bridge.handleCloseOrHideWindowAccelerator).toHaveBeenCalledTimes(1)
    expect(capturedHandlers.autoCloseHandshake).toBeInstanceOf(Function)

    unsub()
    expect(capturedHandlers.autoCloseHandshake).toBeNull()
  })
})

describe('onMaximizedChanged', () => {
  it('registers a bridge listener and toggles maximized state', () => {
    const cb = jest.fn()
    implemented(adapter.onMaximizedChanged, 'onMaximizedChanged')(cb)

    expect(window.bridge.isMaximizedWindow).toHaveBeenCalledTimes(1)

    fire('maximized')
    expect(cb).toHaveBeenCalledWith(true)

    fire('maximized')
    expect(cb).toHaveBeenCalledWith(false)
  })

  it('returns an unsubscribe function that removes the bridge listener', () => {
    const cb = jest.fn()
    const unsub = implemented(adapter.onMaximizedChanged, 'onMaximizedChanged')(cb)

    unsub()
    fireIfRegistered('maximized')

    expect(cb).not.toHaveBeenCalled()
    expect(capturedHandlers.maximized).toBeNull()
  })
})
