import type { ThemePort } from '../../../shared/ports/theme-port'
import { createEditorThemeAdapter } from '../theme-adapter'

let adapter: ThemePort
let themeChangeHandler: ((_event: unknown, ...args: unknown[]) => void) | null

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function mockBridge(storedTheme: 'light' | 'dark' | 'nineties' | null = null) {
  window.bridge = {
    winHandleUpdateTheme: jest.fn(),
    // System store (electron-store on the main process) — the desktop's
    // durable source of truth, analogous to the edge backend on web.
    winGetTheme: jest.fn().mockResolvedValue(storedTheme),
    handleUpdateTheme: jest.fn().mockImplementation((handler: (_event: unknown, ...args: unknown[]) => void) => {
      themeChangeHandler = handler
    }),
  } as unknown as typeof window.bridge
}

beforeEach(() => {
  themeChangeHandler = null
  localStorage.clear()
  document.documentElement.classList.remove('dark', 'light', 'nineties')

  // Default: matchMedia says dark mode
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: true }),
  })

  mockBridge()

  adapter = createEditorThemeAdapter()
})

describe('getCurrentTheme', () => {
  it('returns dark when matchMedia prefers dark', () => {
    expect(adapter.getCurrentTheme()).toBe('dark')
  })

  it('returns light when matchMedia does not prefer dark', () => {
    ;(window.matchMedia as jest.Mock).mockReturnValue({ matches: false })
    adapter = createEditorThemeAdapter()

    expect(adapter.getCurrentTheme()).toBe('light')
  })

  it('prefers the stored explicit theme over matchMedia', () => {
    localStorage.setItem('theme', 'nineties')
    adapter = createEditorThemeAdapter()

    expect(adapter.getCurrentTheme()).toBe('nineties')
    expect(document.documentElement.classList.contains('nineties')).toBe(true)
  })
})

describe('setTheme', () => {
  it('updates the theme, applies the DOM class, persists, and drives nativeTheme', () => {
    adapter.setTheme('light')

    expect(adapter.getCurrentTheme()).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledWith('light')
  })

  it('notifies subscribers', () => {
    const cb = jest.fn()
    adapter.onThemeChanged(cb)

    adapter.setTheme('light')

    expect(cb).toHaveBeenCalledWith('light')
  })

  it('persists the UI-only nineties skin to the system store too', () => {
    adapter.setTheme('nineties')

    expect(adapter.getCurrentTheme()).toBe('nineties')
    expect(document.documentElement.classList.contains('nineties')).toBe(true)
    // The main process maps 'nineties' onto a light nativeTheme but keeps
    // the full preference in its store.
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledWith('nineties')
  })
})

describe('toggleTheme', () => {
  it('toggles from dark to light', () => {
    expect(adapter.getCurrentTheme()).toBe('dark')

    adapter.toggleTheme()

    expect(adapter.getCurrentTheme()).toBe('light')
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledWith('light')
  })

  it('toggles from light to dark', () => {
    adapter.toggleTheme() // dark -> light
    adapter.toggleTheme() // light -> dark

    expect(adapter.getCurrentTheme()).toBe('dark')
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledTimes(2)
  })
})

describe('system store boot reconcile', () => {
  it('applies the stored theme over the renderer localStorage cache', async () => {
    localStorage.setItem('theme', 'dark')
    mockBridge('nineties')

    adapter = createEditorThemeAdapter()
    await flushPromises()

    expect(adapter.getCurrentTheme()).toBe('nineties')
    expect(localStorage.getItem('theme')).toBe('nineties')
    expect(document.documentElement.classList.contains('nineties')).toBe(true)
    // The value came FROM the store — no echo IPC.
    expect(window.bridge.winHandleUpdateTheme).not.toHaveBeenCalled()
  })

  it('seeds the system store from the renderer preference when the store has none', async () => {
    localStorage.setItem('theme', 'nineties')
    mockBridge(null)

    adapter = createEditorThemeAdapter()
    await flushPromises()

    expect(adapter.getCurrentTheme()).toBe('nineties')
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledWith('nineties')
  })

  it('does nothing when neither layer has an explicit preference', async () => {
    mockBridge(null)

    adapter = createEditorThemeAdapter()
    await flushPromises()

    expect(adapter.getCurrentTheme()).toBe('dark') // matchMedia fallback
    expect(window.bridge.winHandleUpdateTheme).not.toHaveBeenCalled()
    expect(localStorage.getItem('theme')).toBeNull()
  })
})

describe('main process theme events', () => {
  it('registers the bridge listener once at creation', () => {
    expect(window.bridge.handleUpdateTheme).toHaveBeenCalledTimes(1)
  })

  it('applies an explicit theme from the native menu without echoing IPC', () => {
    const cb = jest.fn()
    adapter.onThemeChanged(cb)

    themeChangeHandler!({}, 'nineties')

    expect(adapter.getCurrentTheme()).toBe('nineties')
    expect(localStorage.getItem('theme')).toBe('nineties')
    expect(document.documentElement.classList.contains('nineties')).toBe(true)
    expect(cb).toHaveBeenCalledWith('nineties')
    expect(window.bridge.winHandleUpdateTheme).not.toHaveBeenCalled()
  })

  it('toggles theme on a payload-less (OS-level) event without persisting', () => {
    const cb = jest.fn()
    adapter.onThemeChanged(cb)

    // Theme starts as dark, so handler should toggle to light
    themeChangeHandler!({})

    expect(cb).toHaveBeenCalledWith('light')
    expect(adapter.getCurrentTheme()).toBe('light')
    expect(localStorage.getItem('theme')).toBeNull()
  })

  it('toggles back on second event', () => {
    const cb = jest.fn()
    adapter.onThemeChanged(cb)

    themeChangeHandler!({}) // dark -> light
    themeChangeHandler!({}) // light -> dark

    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb).toHaveBeenLastCalledWith('dark')
    expect(adapter.getCurrentTheme()).toBe('dark')
  })

  it('does not flip off the retro skin on a payload-less event', () => {
    const cb = jest.fn()
    adapter.setTheme('nineties')
    adapter.onThemeChanged(cb)

    themeChangeHandler!({})

    expect(adapter.getCurrentTheme()).toBe('nineties')
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('onThemeChanged', () => {
  it('returns an unsubscribe function that deactivates the callback', () => {
    const cb = jest.fn()
    const unsub = adapter.onThemeChanged(cb)

    unsub()
    themeChangeHandler!({})

    expect(cb).not.toHaveBeenCalled()
  })
})
