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

import type { ImportResult, InstalledPackage, PackageManifest, Result, Unsubscribe } from './types'

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
   * Subscribe to the "open package manager" event (triggered from menu).
   */
  onOpenManager(callback: () => void): Unsubscribe

  /**
   * Subscribe to board list updates (triggered after package install/uninstall).
   */
  onBoardsUpdated(callback: () => void): Unsubscribe
}
