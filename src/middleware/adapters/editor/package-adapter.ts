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

    async uninstall(packageId: string): Promise<Result> {
      const result = await window.bridge.uninstallPackage(packageId)
      if (result.success) return { success: true } as Result
      return { success: false, error: result.error ?? 'Uninstall failed' }
    },

    async getManifest(packageId: string): Promise<PackageManifest | null> {
      return (await window.bridge.getPackageManifest(packageId)) as PackageManifest | null
    },

    onOpenManager(callback: () => void): Unsubscribe {
      return window.bridge.onOpenPackageManager(callback)
    },

    onBoardsUpdated(callback: () => void): Unsubscribe {
      return window.bridge.onBoardsUpdated(callback)
    },
  }
}
