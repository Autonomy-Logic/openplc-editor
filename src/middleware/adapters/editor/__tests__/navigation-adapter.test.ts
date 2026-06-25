/**
 * @jest-environment node
 *
 * The default jsdom environment locks `window.location.href` (and the
 * `location` property itself) as non-configurable, which blocks both
 * `jest.replaceProperty` and `jest.spyOn(..., 'set')`.  Running this
 * file in node lets us drop a fully stubbed `window` global onto
 * `globalThis` and observe what the adapter assigns to `location.href`
 * directly, without jsdom's anti-navigation hardening.
 */

import type { NavigationPort } from '../../../shared/ports/navigation-port'
import { createEditorNavigationAdapter } from '../navigation-adapter'

interface WindowStub {
  location: { href: string }
  open: jest.Mock
}

let adapter: NavigationPort
let stubWindow: WindowStub
const originalWindow = (globalThis as { window?: unknown }).window

beforeEach(() => {
  stubWindow = { location: { href: 'about:blank' }, open: jest.fn() }
  ;(globalThis as unknown as { window: WindowStub }).window = stubWindow
  adapter = createEditorNavigationAdapter()
})

afterEach(() => {
  ;(globalThis as unknown as { window?: unknown }).window = originalWindow
})

describe('navigate', () => {
  it('builds and assigns a URL with search params to window.location.href', () => {
    adapter.navigate('/conflicts', { branch: 'feat/foo' })

    expect(stubWindow.location.href).toContain('/conflicts')
    expect(stubWindow.location.href).toContain('branch=')
  })

  it('handles a navigation with no search params', () => {
    adapter.navigate('/home')

    expect(stubWindow.location.href).toContain('/home')
  })
})

describe('openInNewWindow', () => {
  it('opens the built URL in a new window', () => {
    adapter.openInNewWindow('/diff', { commit: 'abc123' })

    expect(stubWindow.open).toHaveBeenCalledTimes(1)
    const [url, target] = stubWindow.open.mock.calls[0]
    expect(url).toContain('/diff')
    expect(url).toContain('commit=abc123')
    expect(target).toBe('_blank')
  })

  it('opens with no search params', () => {
    adapter.openInNewWindow('/diff')

    expect(stubWindow.open).toHaveBeenCalledTimes(1)
    const [, target] = stubWindow.open.mock.calls[0]
    expect(target).toBe('_blank')
  })
})
