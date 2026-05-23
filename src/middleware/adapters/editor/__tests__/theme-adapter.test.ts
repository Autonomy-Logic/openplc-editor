import type { ThemePort } from '../../../shared/ports/theme-port'
import { createEditorThemeAdapter } from '../theme-adapter'

let adapter: ThemePort
let themeChangeHandler: ((_event: unknown) => void) | null

beforeEach(() => {
  themeChangeHandler = null

  // Default: matchMedia says dark mode
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: true }),
  })

  window.bridge = {
    winHandleUpdateTheme: jest.fn(),
    handleUpdateTheme: jest.fn().mockImplementation((handler: (_event: unknown) => void) => {
      themeChangeHandler = handler
    }),
  } as unknown as typeof window.bridge

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
})

describe('setTheme', () => {
  it('updates the current theme and calls bridge', () => {
    adapter.setTheme('light')

    expect(adapter.getCurrentTheme()).toBe('light')
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledTimes(1)
  })
})

describe('toggleTheme', () => {
  it('toggles from dark to light', () => {
    expect(adapter.getCurrentTheme()).toBe('dark')

    adapter.toggleTheme()

    expect(adapter.getCurrentTheme()).toBe('light')
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledTimes(1)
  })

  it('toggles from light to dark', () => {
    adapter.toggleTheme() // dark -> light
    adapter.toggleTheme() // light -> dark

    expect(adapter.getCurrentTheme()).toBe('dark')
    expect(window.bridge.winHandleUpdateTheme).toHaveBeenCalledTimes(2)
  })
})

describe('onThemeChanged', () => {
  it('registers a bridge listener and toggles theme on event', () => {
    const cb = jest.fn()
    adapter.onThemeChanged(cb)

    expect(window.bridge.handleUpdateTheme).toHaveBeenCalledTimes(1)

    // Theme starts as dark, so handler should toggle to light
    themeChangeHandler!({})

    expect(cb).toHaveBeenCalledWith('light')
    expect(adapter.getCurrentTheme()).toBe('light')
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

  it('returns an unsubscribe function that deactivates the callback', () => {
    const cb = jest.fn()
    const unsub = adapter.onThemeChanged(cb)

    unsub()
    themeChangeHandler!({})

    expect(cb).not.toHaveBeenCalled()
  })
})

describe('missing preload bridge', () => {
  it('keeps local theme state and returns a no-op unsubscribe', () => {
    window.bridge = undefined as unknown as typeof window.bridge
    adapter = createEditorThemeAdapter()

    expect(() => adapter.setTheme('light')).not.toThrow()
    expect(adapter.getCurrentTheme()).toBe('light')
    expect(() => adapter.toggleTheme()).not.toThrow()
    expect(adapter.getCurrentTheme()).toBe('dark')

    const unsub = adapter.onThemeChanged(jest.fn())
    expect(typeof unsub).toBe('function')
    expect(unsub).not.toThrow()
  })
})
