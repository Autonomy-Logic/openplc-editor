/**
 * Editor PackagePort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process PackageManagerModule for VPP
 * package lifecycle operations (import, list, uninstall, manifest).
 *
 * IPC channels:
 *   packages:import-from-file     (invoke)
 *   packages:install-from-url     (invoke)
 *   packages:list-installed       (invoke)
 *   packages:uninstall            (invoke)
 *   packages:get-manifest         (invoke)
 *   packages:open-manager         (on)
 *   packages:boards-updated       (on)
 *
 * `listRemoteCatalog` fetches the JSON catalog directly from the OpenPLC
 * VPP catalog backend (autonomy-edge). `installFromRemote` defers the
 * binary download to main via the `packages:install-from-url` IPC channel
 * so the existing local install pipeline (`PackageManagerModule.
 * importFromFile`) can run unchanged.
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

/**
 * Base URL of the OpenPLC VPP catalog backend (autonomy-edge).
 *
 * Resolution order:
 *
 *   1. `process.env.VPP_CATALOG_URL` — injected at webpack build time via
 *      `EnvironmentPlugin` (renderer dev + prod configs).  Set this in
 *      your shell before `npm run dev` to point a local editor at
 *      staging / localhost / etc.  Example:
 *
 *          export VPP_CATALOG_URL=http://localhost:3333
 *          npm run dev
 *
 *      `EnvironmentPlugin` evaluates the env at build time, not at
 *      runtime — Electron renderer bundles don't have a live
 *      `process.env`.  The CI/CD release pipeline doesn't set the
 *      variable, so the empty-string default in webpack falls through
 *      to step 2 below and shipped builds always point at production.
 *
 *   2. `PRODUCTION_CATALOG_URL` — the hardcoded production host below.
 *      Authoritative for shipped builds; the empty-string default
 *      from step 1 evaluates as falsy and this string takes over.
 *
 * Local-backend dev tip: setting `VPP_CATALOG_URL=http://localhost:3333`
 * targets a `pnpm dev:backend` autonomy-edge instance instead of the
 * production CDN.
 */
const PRODUCTION_CATALOG_URL = 'https://api.autonomylogic.com'
const CATALOG_BASE_URL = process.env.VPP_CATALOG_URL || PRODUCTION_CATALOG_URL

/**
 * Local-dev toggle: when `true`, the catalog port methods are served from
 * the static fixture in `remote-catalog-mock.ts` so the Browse Catalog UI
 * can be exercised end-to-end without a running backend. Committed value
 * MUST stay `false` — flipping is a working-tree-only edit for offline dev.
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

    async listRemoteCatalog(): Promise<RemoteCatalog> {
      /* istanbul ignore if -- USE_LOCAL_MOCK is a working-tree-only dev toggle (committed false) */
      if (USE_LOCAL_MOCK) return mockListRemoteCatalog()
      const response = await fetch(`${CATALOG_BASE_URL}/vpp-catalog/v1/catalog.json`)
      if (!response.ok) {
        throw new Error(`Catalog fetch failed: ${response.status} ${response.statusText}`)
      }
      return (await response.json()) as RemoteCatalog
    },

    installFromRemote(packageId: string, version: string, downloadUrl: string): Promise<ImportResult> {
      /* istanbul ignore if -- USE_LOCAL_MOCK is a working-tree-only dev toggle (committed false) */
      if (USE_LOCAL_MOCK) return mockInstallFromRemote(packageId, version, downloadUrl)
      // Defer to main — it downloads the binary, writes it to a temp file,
      // and hands it off to PackageManagerModule.importFromFile (the same
      // pipeline that the "Add from file..." flow uses).
      return window.bridge.installPackageFromUrl({ packageId, version, downloadUrl })
    },

    onOpenManager(callback: () => void): Unsubscribe {
      return window.bridge.onOpenPackageManager(callback)
    },

    onBoardsUpdated(callback: () => void): Unsubscribe {
      return window.bridge.onBoardsUpdated(callback)
    },

    verifyInstalledSignatures(): Promise<string[]> {
      return window.bridge.verifyInstalledPackageSignatures()
    },
  }
}
