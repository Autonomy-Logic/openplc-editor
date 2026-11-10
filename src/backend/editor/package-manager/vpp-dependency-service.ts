/**
 * Ties a board package's life cycle to its arduino-cli dependencies: install
 * them with the package, install what is missing on Reinstall, and remove what
 * no other package needs on uninstall. Decisions come from the shared plans.
 */

import {
  type ArduinoDependencies,
  collectArduinoDependencies,
  planDependencyRemoval,
} from '@root/backend/shared/packages/arduino-dependencies'

import {
  type ArduinoCliSpawner,
  type DependencyInstallProgress,
  installArduinoDependencies,
  queryInstalledArduinoState,
  removeArduinoDependencies,
} from './arduino-dependency-installer'
import type { PackageDependencyOutcome, PackageManagerModule } from './package-manager-module'
import type { ImportResult, PackageManifest } from './types'

export type DependencyProgressListener = (progress: DependencyInstallProgress) => void

/** The background start-up dependency check, which installs and uninstalls wait for. */
export interface StartupDependencyGate {
  isRunning(): boolean
  whenDone(): Promise<void>
}

const NO_STARTUP_CHECK: StartupDependencyGate = { isRunning: () => false, whenDone: () => Promise.resolve() }

export class VppDependencyService {
  #active: AbortController | null = null

  constructor(
    private readonly packageManager: PackageManagerModule,
    private readonly spawnCli: ArduinoCliSpawner,
    private readonly startup: StartupDependencyGate = NO_STARTUP_CHECK,
  ) {}

  /** Cancels the running install or Reinstall, if any. */
  cancel(): void {
    this.#active?.abort()
  }

  /** Installs the package at @p vppFilePath together with its dependencies. */
  importPackage(vppFilePath: string, onProgress: DependencyProgressListener): Promise<ImportResult> {
    return this.packageManager.importFromFile(vppFilePath, (manifest) => this.#install(manifest, onProgress))
  }

  /** Installs whatever the installed package @p packageId is missing. */
  async reinstall(packageId: string, onProgress: DependencyProgressListener): Promise<ImportResult> {
    const manifest = this.packageManager.getInstalledPackageManifest(packageId)
    if (!manifest) return { success: false, error: `Package ${packageId} is not installed` }
    const outcome = await this.#install(manifest, onProgress)
    if (!outcome.ok) return { success: false, canceled: outcome.cancelled, error: outcome.error }
    return { success: true, packageId, packageName: manifest.package.name }
  }

  /**
   * Uninstalls @p packageId, then removes the cores and libraries no other installed
   * package declares. A removal failure does not undo the uninstall; it comes back
   * as a warning.
   */
  async uninstall(packageId: string): Promise<{ success: boolean; error?: string; warning?: string }> {
    const manifest = this.packageManager.getInstalledPackageManifest(packageId)
    const result = this.packageManager.uninstall(packageId)
    if (!result.success || !manifest) return result
    try {
      await this.startup.whenDone()
      const remaining: ArduinoDependencies[] = this.packageManager
        .listInstalled()
        .map((pkg) => this.packageManager.getInstalledPackageManifest(pkg.packageId))
        .filter((other): other is PackageManifest => other !== null)
        .map(collectArduinoDependencies)
      const installed = await queryInstalledArduinoState(this.spawnCli)
      const plan = planDependencyRemoval(collectArduinoDependencies(manifest), remaining, {
        cores: installed.ownedCores,
        libraries: installed.ownedLibraries,
      })
      const failures = await removeArduinoDependencies(plan, this.spawnCli)
      if (failures.length > 0) return { success: true, warning: `Could not remove ${failures.join(', ')}.` }
      return { success: true }
    } catch (err) {
      return {
        success: true,
        warning: `Could not remove the package's cores and libraries: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  async #install(manifest: PackageManifest, onProgress: DependencyProgressListener): Promise<PackageDependencyOutcome> {
    if (this.#active) return { ok: false, cancelled: false, error: 'Another board package installation is running.' }
    const controller = new AbortController()
    this.#active = controller
    try {
      if (this.startup.isRunning()) {
        onProgress({ step: 0, total: 0, label: 'Waiting for the board dependency check to finish', waiting: true })
        await this.startup.whenDone()
      }
      if (controller.signal.aborted) return { ok: false, cancelled: true, error: 'Installation cancelled.' }
      return await installArduinoDependencies(
        collectArduinoDependencies(manifest),
        this.spawnCli,
        onProgress,
        controller.signal,
      )
    } finally {
      this.#active = null
    }
  }
}
