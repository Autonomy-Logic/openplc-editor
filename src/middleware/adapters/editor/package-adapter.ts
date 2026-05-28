/**
 * Editor PackagePort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process PackageManagerModule for VPP
 * package lifecycle operations (import, list, uninstall, manifest).
 *
 * IPC channels:
 *   packages:import-from-file    (invoke)
 *   packages:list-installed       (invoke)
 *   packages:uninstall            (invoke)
 *   packages:get-manifest         (invoke)
 *   packages:open-manager         (on)
 *   packages:boards-updated       (on)
 *
 * `listRemoteCatalog` and `installFromRemote` are still stubs until the
 * CDN backend ships (see EDGE-482 + subtasks for the wire contract). The
 * UI surface exists and consumes these methods through `PackagePort`; both
 * surface a clean "backend not connected" error today so the Browse Catalog
 * tab degrades gracefully instead of crashing.
 */

import { parsePackageManifest } from '../../shared/ports/package-manifest-schema'
import type { PackagePort } from '../../shared/ports/package-port'
import type {
  ImportResult,
  InstalledPackage,
  PackageManifest,
  RemoteCatalog,
  Result,
  Unsubscribe,
} from '../../shared/ports/types'
import { mockInstallFromRemote, mockListRemoteCatalog } from './remote-catalog-mock'

const REMOTE_BACKEND_NOT_WIRED =
  'OpenPLC CDN catalog backend is not yet available. Use "Add from file..." with a downloaded .vpp for now.'

/**
 * Local-dev toggle: when `true`, the catalog port methods are served from
 * the static fixture in `remote-catalog-mock.ts` so the Browse Catalog UI
 * can be exercised end-to-end without a real CDN. Committed value MUST stay
 * `false` — flipping is a working-tree-only edit while EDGE-482 (real CDN)
 * is still pending.
 */
const USE_LOCAL_MOCK = false

export function createEditorPackageAdapter(): PackagePort {
  return {
    importFromFile(): Promise<ImportResult> {
      return window.bridge.importPackageFromFile()
    },

    listInstalled(): Promise<InstalledPackage[]> {
      return window.bridge.listInstalledPackages()
    },

    async uninstall(packageId: string): Promise<Result> {
      const result = await window.bridge.uninstallPackage(packageId)
      if (result.success) return { success: true } as Result
      return { success: false, error: result.error ?? 'Uninstall failed' }
    },

    async getManifest(packageId: string): Promise<PackageManifest | null> {
      // The bridge declares this as `Promise<unknown>` because the wire
      // contract is JSON the main process originally read from a `.vpp`'s
      // manifest.json. Validate the shape here before handing it to UI
      // code — drift between port type and on-disk JSON is a real risk
      // that an unchecked cast would silently absorb.
      const raw = await window.bridge.getPackageManifest(packageId)
      if (raw === null || raw === undefined) return null
      return parsePackageManifest(raw)
    },

    listRemoteCatalog(): Promise<RemoteCatalog> {
      // TODO(EDGE-482): replace with HTTP fetch against the OpenPLC CDN
      // catalog URL once the backend lands. Until then we reject so the
      // CatalogBrowser surfaces its error state with a Try Again button
      // instead of rendering an empty catalog.
      if (USE_LOCAL_MOCK) return mockListRemoteCatalog()
      return Promise.reject(new Error(REMOTE_BACKEND_NOT_WIRED))
    },

    installFromRemote(packageId: string, version?: string): Promise<ImportResult> {
      // TODO(EDGE-482): replace with `fetch(downloadUrl) -> tmp file ->
      // local install pipeline` once the CDN backend lands. The shape of
      // the error keeps the UI's "Backend not connected" modal honest.
      if (USE_LOCAL_MOCK) return mockInstallFromRemote(packageId, version)
      const versionSuffix = version ? `@${version}` : ''
      return Promise.resolve({
        success: false,
        error: `Remote install for "${packageId}${versionSuffix}" is not available — ${REMOTE_BACKEND_NOT_WIRED}`,
      })
    },

    onOpenManager(callback: () => void): Unsubscribe {
      return window.bridge.onOpenPackageManager(callback)
    },

    onBoardsUpdated(callback: () => void): Unsubscribe {
      return window.bridge.onBoardsUpdated(callback)
    },
  }
}
