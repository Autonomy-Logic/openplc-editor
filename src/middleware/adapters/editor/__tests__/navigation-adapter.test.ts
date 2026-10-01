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
  // Assigning `location.href` in the Electron renderer reloads the SPA shell and closes the open project.
  it('refuses an in-app route this build cannot render, leaving the app alone', () => {
    adapter.navigate('/conflicts', { branch: 'feat/foo' })

    expect(stubWindow.location.href).toBe('about:blank')
  })

  it('refuses it whether or not there are search params', () => {
    adapter.navigate('/home')

    expect(stubWindow.location.href).toBe('about:blank')
  })
})

describe('openInNewWindow', () => {
  it('opens an external URL in a new window, with its params', () => {
    adapter.openInNewWindow('https://edge.example.com/diff', { commit: 'abc123' })

    expect(stubWindow.open).toHaveBeenCalledTimes(1)
    const [url, target, features] = stubWindow.open.mock.calls[0]
    expect(url).toContain('/diff')
    expect(url).toContain('commit=abc123')
    expect(target).toBe('_blank')
    // The opened page must not keep a `window.opener` handle back into the renderer.
    expect(features).toBe('noopener,noreferrer')
  })

  it('refuses an in-app path instead of opening an empty window', () => {
    adapter.openInNewWindow('/diff')

    expect(stubWindow.open).not.toHaveBeenCalled()
  })
})

describe('the commit history screen is rendered in place, not navigated to', () => {
  it('turns "view all files" into store state instead of a new window', () => {
    adapter.openInNewWindow('/history', { project_id: 'p1', commit_hash: 'abc123', file: 'pous/programs/main.st' })

    expect(stubWindow.open).not.toHaveBeenCalled()
    expect(openHistoryView).toHaveBeenCalledWith({ commitHash: 'abc123', file: 'pous/programs/main.st' })
  })

  it('carries no file when none was asked for', () => {
    adapter.openInNewWindow('/history', { project_id: 'p1', commit_hash: 'abc123' })

    expect(openHistoryView).toHaveBeenCalledWith({ commitHash: 'abc123', file: undefined })
  })

  it('intercepts an in-app navigation to the same screen', () => {
    adapter.navigate('/history', { project_id: 'p1', commit_hash: 'abc123' })

    expect(stubWindow.location.href).toBe('about:blank')
    expect(openHistoryView).toHaveBeenCalled()
  })

  it('does not open an empty screen when there is no commit to show', () => {
    adapter.openInNewWindow('/history', { project_id: 'p1' })

    expect(openHistoryView).not.toHaveBeenCalled()
    expect(stubWindow.open).not.toHaveBeenCalled()
  })

  it('does not mistake the merge route for the history screen', () => {
    adapter.navigate('/merge', { project_id: 'p1', source: 'feat' })

    expect(openHistoryView).not.toHaveBeenCalled()
    expect(stubWindow.location.href).toBe('about:blank')
  })
})

describe('the merge screen is rendered in place too', () => {
  it('turns a merge request into store state instead of a navigation', () => {
    adapter.navigate('/merge', { project_id: 'p1', source: 'feat', target: 'main' })

    expect(openMergeView).toHaveBeenCalledWith({ sourceBranch: 'feat', targetBranch: 'main' })
    expect(stubWindow.location.href).toBe('about:blank')
    expect(stubWindow.open).not.toHaveBeenCalled()
  })

  it('accepts a merge with no target, which the screen resolves itself', () => {
    adapter.navigate('/merge', { project_id: 'p1', source: 'feat' })

    // Absent when merge is opened from the current branch; the screen falls back to the default branch.
    expect(openMergeView).toHaveBeenCalledWith({ sourceBranch: 'feat', targetBranch: undefined })
  })

  it('declines a merge with no source branch rather than opening an empty screen', () => {
    adapter.navigate('/merge', { project_id: 'p1' })

    expect(openMergeView).not.toHaveBeenCalled()
    expect(stubWindow.location.href).toBe('about:blank')
  })

  it('does not open a window onto an in-app path either', () => {
    adapter.openInNewWindow('/merge', { project_id: 'p1' })

    expect(stubWindow.open).not.toHaveBeenCalled()
  })

  it('still opens a real external link', () => {
    adapter.openInNewWindow('https://edge.example.com/signup')

    expect(stubWindow.open).toHaveBeenCalled()
    expect(String(stubWindow.open.mock.calls[0][0])).toContain('edge.example.com/signup')
  })
})
