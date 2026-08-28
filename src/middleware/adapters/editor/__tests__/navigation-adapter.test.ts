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

const openMergeView = jest.fn()

jest.mock('../../../../frontend/store', () => ({
  useOpenPLCStore: {
    getState: () => ({ versionControlActions: { openHistoryView, closeHistoryView, openMergeView } }),
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
  /**
   * These two used to assert the opposite — that an unknown route was written to
   * `location.href`. That WAS the behaviour, and it was the bug: inside the Electron
   * renderer the assignment reloads the SPA shell, so pressing "Merge" closed the open
   * project and dropped the user on the start screen with their unsaved edits gone.
   */
  it('refuses an in-app route this build cannot render, leaving the app alone', () => {
    // `/conflicts` has no desktop screen; `/history` and `/merge` do, and are covered
    // separately. The refusal path still matters for whatever gets routed next.
    adapter.navigate('/conflicts', { branch: 'feat/foo' })

    expect(stubWindow.location.href).toBe('about:blank')
  })

  it('refuses it whether or not there are search params', () => {
    adapter.navigate('/home')

    expect(stubWindow.location.href).toBe('about:blank')
  })
})

describe('openInNewWindow', () => {
  /**
   * These asserted that ANY path opened a window, `/diff` included. An in-app path no
   * longer does: the desktop has no such route, so the window would show an empty page in
   * development and a missing `file://` in a packaged build. An external URL — how the
   * editor reaches Edge's own pages — still opens one, and that is the distinction now.
   */
  it('opens an external URL in a new window, with its params', () => {
    adapter.openInNewWindow('https://edge.example.com/diff', { commit: 'abc123' })

    expect(stubWindow.open).toHaveBeenCalledTimes(1)
    const [url, target] = stubWindow.open.mock.calls[0]
    expect(url).toContain('/diff')
    expect(url).toContain('commit=abc123')
    expect(target).toBe('_blank')
  })

  it('refuses an in-app path instead of opening an empty window', () => {
    adapter.openInNewWindow('/diff')

    expect(stubWindow.open).not.toHaveBeenCalled()
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

    // Nothing to show, and nothing to open: `/history` is an in-app path, so the request
    // is declined rather than becoming a blank window.
    expect(openHistoryView).not.toHaveBeenCalled()
    expect(stubWindow.open).not.toHaveBeenCalled()
  })

  it('does not mistake the merge route for the history screen', () => {
    adapter.navigate('/merge', { project_id: 'p1', source: 'feat' })

    // Interception is exact: each route reaches its own screen, and neither falls through
    // to a navigation.
    expect(openHistoryView).not.toHaveBeenCalled()
    expect(stubWindow.location.href).toBe('about:blank')
  })
})

/**
 * The merge entry is the reason this file changed. It is the one caller that asked for a
 * route the desktop has no screen for, and the old fallback answered by restarting the app.
 */
describe('the merge screen is rendered in place too', () => {
  it('turns a merge request into store state instead of a navigation', () => {
    adapter.navigate('/merge', { project_id: 'p1', source: 'feat', target: 'main' })

    // This used to write `location.href`, which reloaded the renderer and closed the open
    // project. It is now the same interception `/history` gets.
    expect(openMergeView).toHaveBeenCalledWith({ sourceBranch: 'feat', targetBranch: 'main' })
    expect(stubWindow.location.href).toBe('about:blank')
    expect(stubWindow.open).not.toHaveBeenCalled()
  })

  it('accepts a merge with no target, which the screen resolves itself', () => {
    adapter.navigate('/merge', { project_id: 'p1', source: 'feat' })

    // Legitimately absent when merge is opened from the branch you are on; the screen
    // falls back to the default branch, as the web page does.
    expect(openMergeView).toHaveBeenCalledWith({ sourceBranch: 'feat', targetBranch: undefined })
  })

  it('declines a merge with no source branch rather than opening an empty screen', () => {
    adapter.navigate('/merge', { project_id: 'p1' })

    expect(openMergeView).not.toHaveBeenCalled()
    expect(stubWindow.location.href).toBe('about:blank')
  })

  it('does not open a window onto an in-app path either', () => {
    adapter.openInNewWindow('/merge', { project_id: 'p1' })

    // A BrowserWindow pointed at a route this build lacks is an empty page in development
    // and a missing file:// in a packaged app.
    expect(stubWindow.open).not.toHaveBeenCalled()
  })

  it('still opens a real external link', () => {
    adapter.openInNewWindow('https://edge.example.com/signup')

    // How the editor reaches Edge's own pages — sign-up, profile. Refusing these would
    // have traded one broken affordance for another.
    expect(stubWindow.open).toHaveBeenCalled()
    expect(String(stubWindow.open.mock.calls[0][0])).toContain('edge.example.com/signup')
  })
})
