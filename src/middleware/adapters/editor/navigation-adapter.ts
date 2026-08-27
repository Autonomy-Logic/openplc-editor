/**
 * Editor NavigationPort adapter.
 *
 * The Electron editor has no SPA router — navigation is tab-driven via the Zustand
 * `tabs`/`editor` slices. So a routed feature the shared UI asks for cannot be reached by
 * changing a URL, and what happens instead depends on the kind of destination:
 *   - An IN-APP PATH the desktop cannot render is REFUSED. It used to be written to
 *     `window.location.href`, which in the Electron renderer reloads the whole SPA shell:
 *     the open project was closed, unsaved edits went with it, and the user landed back on
 *     the start screen having pressed a button labelled "Merge". A deterministic outcome
 *     was the intent, but discarding someone's work is not an outcome worth having, and
 *     nothing about it told them what had happened. Doing nothing and saying so is the
 *     lesser failure.
 *   - An EXTERNAL URL still opens a window. `openInNewWindow` is how the editor links out
 *     to Edge's own pages (sign-up, profile), and that has always worked.
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

/**
 * Decline a destination this build has no screen for.
 *
 * Deliberately not a thrown error: every caller is a click handler in shared UI that does
 * not expect navigation to fail, and an exception there would surface as an unhandled
 * rejection rather than as anything the user can read. The warning is for whoever adds the
 * next routed feature — it names the path, so the missing interception is obvious.
 */
function refuse(path: string): void {
  console.warn(`[navigation] no desktop screen for "${path}" — request ignored rather than reloading the app.`)
}

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

      // Refused, not reloaded. See the note at the top of this file: assigning
      // `location.href` here restarted the renderer and took the open project with it.
      // A caller that reaches this line is asking for a screen this build does not have,
      // and the honest answer is to decline — loudly in the log, so the gap is findable,
      // and without touching what the user has open.
      refuse(path)
    },

    openInNewWindow(path: string, search?: NavigationSearch): void {
      if (path === HISTORY_PATH && openHistory(search)) {
        return
      }

      // An absolute URL is a link out of the app — Edge's sign-up and profile pages come
      // through here — and a real window is the right answer for it. An in-app path is
      // the same missing-screen case as above: a `BrowserWindow` pointed at it shows an
      // empty page in development and a missing `file://` in a packaged build.
      if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
        window.open(buildNavigationUrl(path, search), '_blank')

        return
      }

      refuse(path)
    },

    exitToHost(): void {
      // The editor has no host to return to — the start screen appears automatically
      // once `clearStatesOnCloseProject` has reset project state, so this is
      // intentionally a no-op.
    },
  }
}
