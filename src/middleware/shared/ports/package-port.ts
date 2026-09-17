/**
 * PackagePort — Abstracts VPP (Vendor Plugin Package) management.
 *
 * Editor adapter: Delegates to main process PackageManagerModule which manages
 *                 packages on the local filesystem ({userData}/packages/).
 * Web adapter:    Will delegate to a backend API for package management.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.importPackageFromFile()
 *   - window.bridge.listInstalledPackages()
 *   - window.bridge.uninstallPackage()
 *   - window.bridge.getPackageManifest()
 */

import type { VppPackagePin } from '../../../backend/shared/types/PLC/devices/configuration'
import type { ImportResult, InstalledPackage, PackageManifest, RemoteCatalog, Result, Unsubscribe } from './types'

export interface PackagePort {
  /**
   * Open a file picker and import a .vpp package file.
   * Editor: shows native file dialog, extracts and registers the package.
   * Web: uploads to backend for processing.
   */
  importFromFile(): Promise<ImportResult>

  /**
   * List all installed VPP packages.
   */
  listInstalled(): Promise<InstalledPackage[]>

  /**
   * Uninstall a VPP package by its ID.
   */
  uninstall(packageId: string): Promise<Result>

  /**
   * Get the full manifest of an installed package.
   */
  getManifest(packageId: string): Promise<PackageManifest | null>

  /**
   * The installed package's pinnable identity — `packageId@version` plus the
   * `contentHash` of its signed payload — or null when it is not installed.
   *
   * A project records this when a VPP board is selected, so the editor can say
   * at authoring and again before an upload that the package has moved since
   * the program was written against it. The hash is the part that matters: a
   * republished package keeps its version string.
   */
  getPackagePin(packageId: string): Promise<VppPackagePin | null>

  /**
   * Fetch the remote VPP catalog from the OpenPLC CDN.
   */
  listRemoteCatalog(): Promise<RemoteCatalog>

  /**
   * Download and install a VPP from the remote catalog. The caller passes
   * the `downloadUrl` it read from the catalog entry's selected version —
   * the editor never constructs download URLs itself (the catalog is the
   * source of truth, per the backend contract documented in EDGE-482).
   */
  installFromRemote(packageId: string, version: string, downloadUrl: string): Promise<ImportResult>

  /**
   * Subscribe to the "open package manager" event (triggered from menu).
   */
  onOpenManager(callback: () => void): Unsubscribe

  /**
   * Subscribe to board list updates (triggered after package install/uninstall).
   */
  onBoardsUpdated(callback: () => void): Unsubscribe

  /**
   * Re-verify the signatures of every installed package and remove any whose
   * signature no longer validates, returning the ids removed. A desktop-only
   * safeguard: locally-installed `.vpp` files can be added or altered outside
   * the signed import flow, so they are re-checked whenever a project opens.
   * Platforms where packages are backend-provided (web) don't wire a `packages`
   * port and never call this; a no-op shim there returns `[]`.
   */
  verifyInstalledSignatures(): Promise<string[]>
}
