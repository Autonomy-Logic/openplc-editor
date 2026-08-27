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

const openHistoryView = jest.fn()
const closeHistoryView = jest.fn()

jest.mock('../../../../frontend/store', () => ({
  useOpenPLCStore: {
    getState: () => ({ versionControlActions: { openHistoryView, closeHistoryView } }),
  },
}))

interface WindowStub {
  location: { href: string }
  open: jest.Mock
}

let adapter: NavigationPort
let stubWindow: WindowStub
const originalWindow = (globalThis as { window?: unknown }).window

beforeEach(() => {
  jest.clearAllMocks()
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

/**
 * The desktop has no router, so a routed screen has to be rendered in place. This is the
 * seam that makes that happen, and the reason it is tested here rather than in the
 * component: getting it wrong does not look broken, it looks like a blank window.
 */
describe('the commit history screen is rendered in place, not navigated to', () => {
  it('turns "view all files" into store state instead of a new window', () => {
    adapter.openInNewWindow('/history', { project_id: 'p1', commit_hash: 'abc123', file: 'pous/programs/main.st' })

    // A real window here would load a route this build does not have: an empty window in
    // development, and a missing file:// URL in a packaged app.
    expect(stubWindow.open).not.toHaveBeenCalled()
    expect(openHistoryView).toHaveBeenCalledWith({ commitHash: 'abc123', file: 'pous/programs/main.st' })
  })

  it('carries no file when none was asked for', () => {
    adapter.openInNewWindow('/history', { project_id: 'p1', commit_hash: 'abc123' })

    expect(openHistoryView).toHaveBeenCalledWith({ commitHash: 'abc123', file: undefined })
  })

  it('intercepts an in-app navigation to the same screen', () => {
    adapter.navigate('/history', { project_id: 'p1', commit_hash: 'abc123' })

    // This one matters more than the window: `location.href` would RELOAD the renderer
    // and take the open project down with it.
    expect(stubWindow.location.href).toBe('about:blank')
    expect(openHistoryView).toHaveBeenCalled()
  })

  it('does not open an empty screen when there is no commit to show', () => {
    adapter.openInNewWindow('/history', { project_id: 'p1' })

    expect(openHistoryView).not.toHaveBeenCalled()
    // Falls through to the normal behaviour rather than swallowing the click silently.
    expect(stubWindow.open).toHaveBeenCalled()
  })

  it('leaves every other route alone', () => {
    adapter.navigate('/merge', { project_id: 'p1', source: 'feat' })

    expect(openHistoryView).not.toHaveBeenCalled()
    expect(stubWindow.location.href).toContain('/merge')
  })
})
