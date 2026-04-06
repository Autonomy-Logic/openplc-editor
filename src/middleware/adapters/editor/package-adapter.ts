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
 */

import type { PackagePort } from '../../shared/ports/package-port'
import type { ImportResult, InstalledPackage, PackageManifest, Result, Unsubscribe } from '../../shared/ports/types'

export function createEditorPackageAdapter(): PackagePort {
  return {
    importFromFile(): Promise<ImportResult> {
      return window.bridge.importPackageFromFile()
    },

    listInstalled(): Promise<InstalledPackage[]> {
      return window.bridge.listInstalledPackages()
    },

    uninstall(packageId: string): Promise<Result> {
      return window.bridge.uninstallPackage(packageId)
    },

    getManifest(packageId: string): Promise<PackageManifest | null> {
      return window.bridge.getPackageManifest(packageId)
    },

    onOpenManager(callback: () => void): Unsubscribe {
      return window.bridge.onOpenPackageManager(callback)
    },

    onBoardsUpdated(callback: () => void): Unsubscribe {
      return window.bridge.onBoardsUpdated(callback)
    },
  }
}
