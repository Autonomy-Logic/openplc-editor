/**
 * Editor NavigationPort adapter.
 *
 * The Electron editor has no SPA router — navigation is tab-driven via the
 * Zustand `tabs`/`editor` slices. The routed features that drive shared
 * navigation calls (the merge page, the history page) are gated away by
 * `capabilities.hasVersionControl=false`, so in practice these methods
 * never fire from the editor build.
 *
 * The fallbacks below exist purely so the port satisfies its contract for
 * any code path that does call into it (a no-op would silently swallow a
 * navigation request, which is harder to debug):
 *   - `navigate` writes to `window.location.href`. Inside the Electron
 *     renderer this reloads the SPA shell at the requested path; for
 *     unknown routes it simply lands back on the index, but the user
 *     gets a deterministic outcome instead of nothing happening.
 *   - `openInNewWindow` calls `window.open(url, '_blank')`. Electron
 *     translates this into a fresh `BrowserWindow`, matching what the
 *     existing "Open in new tab" affordances did before this port.
 */

import type { NavigationPort, NavigationSearch } from '../../shared/ports/navigation-port'
import { buildNavigationUrl } from '../../shared/ports/navigation-port'

export function createEditorNavigationAdapter(): NavigationPort {
  return {
    navigate(path: string, search?: NavigationSearch): void {
      window.location.href = buildNavigationUrl(path, search)
    },

    openInNewWindow(path: string, search?: NavigationSearch): void {
      window.open(buildNavigationUrl(path, search), '_blank')
    },

    exitToHost(): void {
      // The editor has no host to return to — the start screen appears
      // automatically once `clearStatesOnCloseProject` has reset project
      // state, so this is intentionally a no-op.
    },
  }
}
