/**
 * Editor NavigationPort adapter.
 *
 * The Electron editor has no SPA router — navigation is tab-driven via the Zustand
 * `tabs`/`editor` slices. So the routed features the shared UI asks for cannot be reached
 * by changing a URL, and the fallbacks below are what a request lands on instead:
 *   - `navigate` writes to `window.location.href`. Inside the Electron renderer this
 *     reloads the SPA shell at the requested path; for unknown routes it lands back on
 *     the index, but the user gets a deterministic outcome instead of nothing happening.
 *   - `openInNewWindow` calls `window.open(url, '_blank')`. Electron translates this into
 *     a fresh `BrowserWindow`, matching what the "Open in new tab" affordances did before
 *     this port existed.
 *
 * `/history` IS INTERCEPTED, and that is the point of this file now. The commit's
 * full-file view is a real screen the desktop has to offer: source control is on for cloud
 * projects, so "View all files" is reachable, and a `window.open('/history?…')` would open
 * a BrowserWindow onto a route that does not exist — an empty window in development and a
 * missing `file://` in a packaged build. Rather than degrade the web (where it opens a
 * genuine second tab and the workspace stays put), the platform difference lives here:
 * the request becomes store state, and the workspace screen lays the same shared
 * `CommitHistoryView` over itself.
 *
 * This is the only adapter that writes to the store, which is worth stating plainly: the
 * alternative was for the shared component to know which product it is running in, and
 * keeping that knowledge here is exactly why the port exists.
 */

import { useOpenPLCStore } from '../../../frontend/store'
import type { NavigationPort, NavigationSearch } from '../../shared/ports/navigation-port'
import { buildNavigationUrl } from '../../shared/ports/navigation-port'

/** The routed screens the desktop renders in place rather than navigating to. */
const HISTORY_PATH = '/history'

export function createEditorNavigationAdapter(): NavigationPort {
  /**
   * Reads the same two params the `/history` route declares, so the shared caller does
   * not need to know it is being intercepted. `commit_hash` is the only required one —
   * without it there is no commit to show, and opening an empty screen would be worse
   * than leaving the click unanswered.
   */
  const openHistory = (search?: NavigationSearch): boolean => {
    const commitHash = search?.commit_hash

    if (!commitHash) {
      return false
    }

    useOpenPLCStore.getState().versionControlActions.openHistoryView({ commitHash, file: search?.file })

    return true
  }

  return {
    navigate(path: string, search?: NavigationSearch): void {
      if (path === HISTORY_PATH && openHistory(search)) {
        return
      }

      window.location.href = buildNavigationUrl(path, search)
    },

    openInNewWindow(path: string, search?: NavigationSearch): void {
      if (path === HISTORY_PATH && openHistory(search)) {
        return
      }

      window.open(buildNavigationUrl(path, search), '_blank')
    },

    exitToHost(): void {
      // The editor has no host to return to — the start screen appears automatically
      // once `clearStatesOnCloseProject` has reset project state, so this is
      // intentionally a no-op.
    },
  }
}
