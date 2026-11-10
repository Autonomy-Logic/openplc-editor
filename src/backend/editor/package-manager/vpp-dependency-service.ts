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
import type { PackageInstallProgress } from '@root/middleware/shared/ports/types'

import {
  type ArduinoCliSpawner,
  type DependencyInstallResult,
  installArduinoDependencies,
  queryInstalledArduinoState,
  removeArduinoDependencies,
} from './arduino-dependency-installer'
import type { PackageManagerModule } from './package-manager-module'
import type { ImportResult, PackageManifest } from './types'

export type DependencyProgressListener = (progress: PackageInstallProgress) => void

/** The background start-up dependency check, which installs and uninstalls wait for. */
export interface StartupDependencyGate {
  isRunning(): boolean
  whenDone(): Promise<void>
}

const NO_STARTUP_CHECK: StartupDependencyGate = { isRunning: () => false, whenDone: () => Promise.resolve() }

const BUSY = 'Another board package installation or removal is running.'
const WAITING = 'Waiting for the board dependency check to finish'

function declaresNothing(dependencies: ArduinoDependencies): boolean {
  return dependencies.cores.length + dependencies.libraries.length + dependencies.gitLibraries.length === 0
}

/** Resolves when @p signal aborts; never rejects. */
function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

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
   * as a warning. Runs alone: not while an install, Reinstall or other uninstall runs.
   */
  async uninstall(
    packageId: string,
    onProgress: DependencyProgressListener = () => undefined,
  ): Promise<{ success: boolean; error?: string; warning?: string }> {
    if (this.#active) return { success: false, error: BUSY }
    this.#active = new AbortController()
    try {
      const manifest = this.packageManager.getInstalledPackageManifest(packageId)
      const result = this.packageManager.uninstall(packageId)
      if (!result.success || !manifest) return result
      const removed = collectArduinoDependencies(manifest)
      if (declaresNothing(removed)) return { success: true }
      return await this.#removeDependencies(removed, onProgress)
    } finally {
      this.#active = null
    }
  }

  async #removeDependencies(
    removed: ArduinoDependencies,
    onProgress: DependencyProgressListener,
  ): Promise<{ success: boolean; warning?: string }> {
    try {
      if (this.startup.isRunning()) {
        onProgress({ step: 0, total: 0, label: WAITING, removing: true })
        await this.startup.whenDone()
      }
      onProgress({ step: 0, total: 0, label: "Removing the package's cores and libraries", removing: true })
      const remaining: ArduinoDependencies[] = this.packageManager
        .listInstalled()
        .map((pkg) => this.packageManager.getInstalledPackageManifest(pkg.packageId))
        .filter((other): other is PackageManifest => other !== null)
        .map(collectArduinoDependencies)
      const installed = await queryInstalledArduinoState(this.spawnCli)
      const plan = planDependencyRemoval(removed, remaining, {
        cores: installed.ownedCores,
        libraries: installed.ownedLibraries,
      })
      const failures = await removeArduinoDependencies(plan, this.spawnCli, onProgress)
      if (failures.length > 0) return { success: true, warning: `Could not remove ${failures.join(', ')}.` }
      return { success: true }
    } catch (err) {
      return {
        success: true,
        warning: `Could not remove the package's cores and libraries: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  async #install(manifest: PackageManifest, onProgress: DependencyProgressListener): Promise<DependencyInstallResult> {
    const dependencies = collectArduinoDependencies(manifest)
    if (declaresNothing(dependencies)) return { ok: true }
    if (this.#active) return { ok: false, cancelled: false, error: BUSY }
    const controller = new AbortController()
    this.#active = controller
    try {
      if (this.startup.isRunning()) {
        onProgress({ step: 0, total: 0, label: WAITING })
        await Promise.race([this.startup.whenDone(), whenAborted(controller.signal)])
      }
      if (controller.signal.aborted) return { ok: false, cancelled: true, error: 'Installation cancelled.' }
      return await installArduinoDependencies(dependencies, this.spawnCli, onProgress, { signal: controller.signal })
    } finally {
      this.#active = null
    }
  }
}
