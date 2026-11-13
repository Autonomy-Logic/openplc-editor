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
import type {
  ImportResult,
  InstalledPackage,
  PackageInstallProgress,
  PackageManifest,
  RemoteCatalog,
  Result,
  StartupNotice,
  Unsubscribe,
} from './types'
import type { DeviceVpp } from './vpp-types'

export interface PackagePort {
  /**
   * Point the package layer at the vPLC the IDE is now targeting, or at none.
   *
   * Web: a vPLC runs the package it was created with, so this is what decides
   * which package is loaded, which boards are offered and what the pin is
   * compared against. The adapter fetches and verifies that one archive and
   * fires `onBoardsUpdated`; `null` empties it, and no vendor board is offered.
   *
   * Editor: a no-op. The desktop connects to a board directly, never to a
   * vPLC, and keeps every installed package available.
   */
  setTargetDevice(target: { deviceId: string; vpp: DeviceVpp | null } | null): Promise<void>

  /**
   * Board names the targeted vPLC's package offers.
   *
   * Web: the devices of the one package that vPLC runs. The IDE follows that
   * binding rather than asking for a board the host already decided; more than
   * one name means the package ships several devices and only the user knows
   * which is wired to the backplane.
   *
   * Editor: always empty. The desktop connects to a board directly and targets
   * no vPLC, so the caller keeps whatever board selection it already had.
   */
  listTargetBoards(): Promise<string[]>

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
   * Editor: also removes the cores and libraries no other installed package
   * needs; `warning` names any that could not be removed.
   */
  uninstall(packageId: string): Promise<Result<{ warning?: string }>>

  /**
   * Install whatever cores and libraries the installed package is missing,
   * without uninstalling it. Web: nothing to install, resolves successfully.
   */
  reinstall(packageId: string): Promise<ImportResult>

  /** Cancel the running package installation or Reinstall. Web: no-op. */
  cancelInstall(): void

  /** Subscribe to dependency-installation progress. Web: never fires. */
  onInstallProgress(callback: (progress: PackageInstallProgress) => void): Unsubscribe

  /**
   * Subscribe to the startup dependency check's console messages. Messages raised
   * before anyone subscribed are delivered on subscription. Web: never fires.
   */
  onStartupNotices(callback: (notices: StartupNotice[]) => void): Unsubscribe

  /**
   * Get the full manifest of an installed package.
   */
  getManifest(packageId: string): Promise<PackageManifest | null>

  /**
   * The installed package's pinnable identity — `packageId@version` plus the
   * `contentHash` of its signed payload — or null when it is not installed.
   *
   * The board screen records this as the project's pin, replacing an older
   * pin when a different package is installed. The hash tells a republished
   * package apart, since a republish keeps its version string.
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
