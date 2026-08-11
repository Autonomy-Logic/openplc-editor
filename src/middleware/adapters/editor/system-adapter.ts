/**
 * Editor SystemPort adapter — delegates to Electron IPC bridge.
 *
 * Uses window.bridge methods to communicate with the main process
 * for system info, persistent storage (electron-store), external
 * links (shell.openExternal), and logging.
 *
 * IPC channels used:
 *   - system:get-system-info  (invoke)
 *   - app:store-get           (invoke)
 *   - app:store-set           (send)
 *   - open-external-link      (invoke)
 *   - util:log                (send)
 */

import type { SystemPort } from '../../shared/ports/system-port'
import type { SystemInfo } from '../../shared/ports/types'

/**
 * Edge web app host — where the license `/buy` page lives. Authoritative for
 * shipped builds.
 */
const PRODUCTION_EDGE_WEB_URL = 'https://edge.autonomylogic.com'

/**
 * Build-time override, injected by webpack's `EnvironmentPlugin` (renderer dev +
 * prod configs) exactly like `VPP_CATALOG_URL`. Electron renderer bundles have no
 * live `process.env`, so this is evaluated when the bundle is BUILT: set it in the
 * shell before `npm run dev` to aim the buy flow at a local Edge app.
 *
 *     OPENPLC_EDGE_WEB_URL=http://localhost:5173 npm run dev
 *
 * The release pipeline does not set it, and webpack's empty-string default is
 * falsy, so shipped builds always point at production.
 */
const EDGE_WEB_URL = process.env.OPENPLC_EDGE_WEB_URL || PRODUCTION_EDGE_WEB_URL

export function createEditorSystemAdapter(): SystemPort {
  return {
    getSystemInfo(): Promise<SystemInfo> {
      return window.bridge.getSystemInfo()
    },

    getStoreValue(key: string): Promise<unknown> {
      return window.bridge.getStoreValue(key)
    },

    setStoreValue(key: string, value: string): void {
      window.bridge.setStoreValue(key, value)
    },

    openExternalLink(url: string): Promise<{ success: boolean }> {
      return window.bridge.openExternalLinkAccelerator(url)
    },

    log(level: 'info' | 'error', message: string): void {
      window.bridge.log(level, message)
    },

    getEdgeFrontendUrl(): string {
      return EDGE_WEB_URL
    },
  }
}
