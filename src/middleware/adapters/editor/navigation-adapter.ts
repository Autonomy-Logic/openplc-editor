/**
 * Editor NavigationPort adapter.
 *
 * No SPA router here: `/history` and `/merge` become store state, an external URL opens a
 * window, any other in-app path is refused. Never assign `location.href` — it reloads the renderer.
 */

import { useOpenPLCStore } from '../../../frontend/store'
import type { NavigationPort, NavigationSearch } from '../../shared/ports/navigation-port'
import { buildNavigationUrl } from '../../shared/ports/navigation-port'

const HISTORY_PATH = '/history'
const MERGE_PATH = '/merge'

// A warning, not a throw: callers are click handlers in shared UI that do not expect navigation to fail.
function refuse(path: string): void {
  console.warn(`[navigation] no desktop screen for "${path}" — request ignored rather than reloading the app.`)
}

export function createEditorNavigationAdapter(): NavigationPort {
  // Same params the `/history` route declares; only `commit_hash` is required.
  const openHistory = (search?: NavigationSearch): boolean => {
    const commitHash = search?.commit_hash

    if (!commitHash) {
      return false
    }

    useOpenPLCStore.getState().versionControlActions.openHistoryView({ commitHash, file: search?.file })

    return true
  }

  // Same params the `/merge` route declares; `target` may legitimately be absent.
  const openMerge = (search?: NavigationSearch): boolean => {
    const sourceBranch = search?.source

    if (!sourceBranch) {
      return false
    }

    useOpenPLCStore.getState().versionControlActions.openMergeView({ sourceBranch, targetBranch: search?.target })

    return true
  }

  return {
    navigate(path: string, search?: NavigationSearch): void {
      if (path === HISTORY_PATH && openHistory(search)) {
        return
      }

      if (path === MERGE_PATH && openMerge(search)) {
        return
      }

      refuse(path)
    },

    openInNewWindow(path: string, search?: NavigationSearch): void {
      if (path === HISTORY_PATH && openHistory(search)) {
        return
      }

      if (path === MERGE_PATH && openMerge(search)) {
        return
      }

      // http(s) only: a `file:` or `javascript:` path must never reach `window.open`.
      if (/^https?:/i.test(path)) {
        window.open(buildNavigationUrl(path, search), '_blank', 'noopener,noreferrer')

        return
      }

      refuse(path)
    },

    exitToHost(): void {
      // No host to return to: the start screen reappears once project state is cleared.
    },
  }
}
