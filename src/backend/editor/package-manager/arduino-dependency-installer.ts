/**
 * Runs the shared arduino dependency plans with the editor's arduino-cli.
 *
 * The decisions (what to install, what may be removed) live in
 * `backend/shared/packages/arduino-dependencies`; this module only spawns
 * arduino-cli, reports progress and maps its output.
 */

import {
  type ArduinoDependencies,
  type DependencyRemovalPlan,
  dependencyStepArgs,
  describeDependencyStep,
  type InstalledArduinoState,
  libraryName,
  parseArduinoCliProgress,
  planDependencyInstall,
} from '@root/backend/shared/packages/arduino-dependencies'
import type { PackageInstallProgress } from '@root/middleware/shared/ports/types'
import type { ChildProcess } from 'child_process'

/** Starts arduino-cli with @p args (the editor's `--config-file` already applied). */
export type ArduinoCliSpawner = (args: string[]) => ChildProcess

export type DependencyInstallProgress = PackageInstallProgress

export type DependencyInstallResult = { ok: true } | { ok: false; cancelled: boolean; error: string }

interface CliOutcome {
  code: number | null
  output: string
}

function runCli(
  spawnCli: ArduinoCliSpawner,
  args: string[],
  onOutput?: (text: string) => void,
  signal?: AbortSignal,
): Promise<CliOutcome> {
  return new Promise((resolve) => {
    const child = spawnCli(args)
    let output = ''
    const collect = (data: Buffer) => {
      const text = data.toString()
      output += text
      onOutput?.(text)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (err) => {
      signal?.removeEventListener('abort', abort)
      resolve({ code: -1, output: `${output}${err.message}` })
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      resolve({ code, output })
    })
  })
}

interface CoreListJson {
  platforms?: Array<{ id?: string; installed_version?: string; manually_installed?: boolean }>
}

interface LibListJson {
  installed_libraries?: Array<{ library?: { name?: string; location?: string } }>
}

/**
 * What arduino-cli has installed. `cores` and `libraries` list everything a build can
 * find; `ownedCores` and `ownedLibraries` only what sits in the editor's own folders,
 * the only items an uninstall may remove (never the Arduino sketchbook's).
 */
export async function queryInstalledArduinoState(
  spawnCli: ArduinoCliSpawner,
): Promise<InstalledArduinoState & { ownedCores: Record<string, string>; ownedLibraries: string[] }> {
  const cores: Record<string, string> = {}
  const ownedCores: Record<string, string> = {}
  const coreList = await runCli(spawnCli, ['core', 'list', '--json'])
  if (coreList.code !== 0) throw new Error(`arduino-cli core list failed: ${coreList.output.trim()}`)
  for (const platform of (JSON.parse(coreList.output) as CoreListJson).platforms ?? []) {
    if (!platform.id || !platform.installed_version) continue
    cores[platform.id] = platform.installed_version
    if (!platform.manually_installed) ownedCores[platform.id] = platform.installed_version
  }
  const libList = await runCli(spawnCli, ['lib', 'list', '--all', '--json'])
  if (libList.code !== 0) throw new Error(`arduino-cli lib list failed: ${libList.output.trim()}`)
  const libraries = new Set<string>()
  const ownedLibraries = new Set<string>()
  for (const entry of (JSON.parse(libList.output) as LibListJson).installed_libraries ?? []) {
    const name = entry.library?.name
    if (!name) continue
    libraries.add(name)
    if (entry.library?.location === 'user') ownedLibraries.add(name)
  }
  return { cores, ownedCores, libraries: [...libraries], ownedLibraries: [...ownedLibraries] }
}

/** Installs what @p dependencies still need, stopping at the first failure or on @p signal. */
export async function installArduinoDependencies(
  dependencies: ArduinoDependencies,
  spawnCli: ArduinoCliSpawner,
  onProgress: (progress: DependencyInstallProgress) => void,
  signal?: AbortSignal,
): Promise<DependencyInstallResult> {
  let installed: InstalledArduinoState
  try {
    installed = await queryInstalledArduinoState(spawnCli)
  } catch (err) {
    return { ok: false, cancelled: false, error: err instanceof Error ? err.message : String(err) }
  }
  const steps = planDependencyInstall(dependencies, installed)
  for (const [index, step] of steps.entries()) {
    const label = describeDependencyStep(step)
    onProgress({ step: index + 1, total: steps.length, label })
    for (const args of dependencyStepArgs(step)) {
      if (signal?.aborted) return { ok: false, cancelled: true, error: 'Installation cancelled.' }
      const outcome = await runCli(
        spawnCli,
        args,
        (text) => {
          const download = parseArduinoCliProgress(text)
          if (download) onProgress({ step: index + 1, total: steps.length, label, download })
        },
        signal,
      )
      if (signal?.aborted) return { ok: false, cancelled: true, error: 'Installation cancelled.' }
      if (outcome.code !== 0) {
        const detail = outcome.output
          .split(/[\r\n]+/)
          .filter(Boolean)
          .slice(-3)
          .join(' ')
        return {
          ok: false,
          cancelled: false,
          error: `${label} failed: ${detail || `exit code ${String(outcome.code)}`}`,
        }
      }
    }
  }
  return { ok: true }
}

/** Removes the cores and libraries in @p plan; returns a message per item that could not be removed. */
export async function removeArduinoDependencies(
  plan: DependencyRemovalPlan,
  spawnCli: ArduinoCliSpawner,
): Promise<string[]> {
  const failures: string[] = []
  for (const core of plan.cores) {
    const outcome = await runCli(spawnCli, ['core', 'uninstall', core])
    if (outcome.code !== 0) failures.push(`core ${core}`)
  }
  for (const library of plan.libraries) {
    const outcome = await runCli(spawnCli, ['lib', 'uninstall', libraryName(library)])
    if (outcome.code !== 0) failures.push(`library ${library}`)
  }
  return failures
}
