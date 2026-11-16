import {
  type ArduinoDependencies,
  type DependencyRemovalPlan,
  dependencyStepArgs,
  describeDependencyStep,
  type InstalledArduinoInventory,
  type InstalledArduinoState,
  libraryName,
  parseArduinoCliProgress,
  parseInstalledArduinoState,
  planDependencyInstall,
} from '@root/backend/shared/packages/arduino-dependencies'
import type { PackageInstallProgress } from '@root/middleware/shared/ports/types'
import type { ChildProcess } from 'child_process'

/** Starts arduino-cli with @p args (the editor's `--config-file` already applied). */
export type ArduinoCliSpawner = (args: string[]) => ChildProcess

/** Outcome of installing a package's arduino-cli dependencies; `installed` counts the steps that ran. */
export type DependencyInstallResult = { ok: true; installed: number } | { ok: false; cancelled: boolean; error: string }

interface CliOutcome {
  code: number | null
  /** stdout and stderr interleaved, for error messages. */
  output: string
  stdout: string
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
    let stdout = ''
    const collect = (data: Buffer) => {
      const text = data.toString()
      output += text
      onOutput?.(text)
      return text
    }
    child.stdout?.on('data', (data: Buffer) => {
      stdout += collect(data)
    })
    child.stderr?.on('data', collect)
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (err) => {
      signal?.removeEventListener('abort', abort)
      resolve({ code: -1, output: `${output}${err.message}`, stdout })
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      resolve({ code, output, stdout })
    })
  })
}

/** What arduino-cli has installed, as `parseInstalledArduinoState` reads it. */
export async function queryInstalledArduinoState(spawnCli: ArduinoCliSpawner): Promise<InstalledArduinoInventory> {
  const coreList = await runCli(spawnCli, ['core', 'list', '--json'])
  if (coreList.code !== 0) throw new Error(`arduino-cli core list failed: ${coreList.output.trim()}`)
  const libList = await runCli(spawnCli, ['lib', 'list', '--all', '--json'])
  if (libList.code !== 0) throw new Error(`arduino-cli lib list failed: ${libList.output.trim()}`)
  return parseInstalledArduinoState(coreList.stdout, libList.stdout)
}

export interface InstallOptions {
  signal?: AbortSignal
  /** Attempt every step even after one fails, and report all failures at the end. */
  keepGoing?: boolean
}

/**
 * Installs what @p dependencies still need. Stops at the first failure unless
 * `keepGoing` is set, and on `signal`.
 */
export async function installArduinoDependencies(
  dependencies: ArduinoDependencies,
  spawnCli: ArduinoCliSpawner,
  onProgress: (progress: PackageInstallProgress) => void,
  options: InstallOptions = {},
): Promise<DependencyInstallResult> {
  const { signal, keepGoing = false } = options
  let installed: InstalledArduinoState
  try {
    installed = await queryInstalledArduinoState(spawnCli)
  } catch (err) {
    return { ok: false, cancelled: false, error: err instanceof Error ? err.message : String(err) }
  }
  const failures: string[] = []
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
        const error = `${label} failed: ${detail || `exit code ${String(outcome.code)}`}`
        if (!keepGoing) return { ok: false, cancelled: false, error }
        failures.push(error)
        break
      }
    }
  }
  if (failures.length > 0) return { ok: false, cancelled: false, error: failures.join('; ') }
  return { ok: true, installed: steps.length }
}

/** Removes the cores and libraries in @p plan; returns a message per item that could not be removed. */
export async function removeArduinoDependencies(
  plan: DependencyRemovalPlan,
  spawnCli: ArduinoCliSpawner,
  onProgress: (progress: PackageInstallProgress) => void = () => undefined,
): Promise<string[]> {
  const items = [
    ...plan.cores.map((core) => ({ what: `core ${core}`, args: ['core', 'uninstall', core] })),
    ...plan.libraries.map((library) => ({
      what: `library ${library}`,
      args: ['lib', 'uninstall', libraryName(library)],
    })),
  ]
  const failures: string[] = []
  for (const [index, item] of items.entries()) {
    onProgress({ step: index + 1, total: items.length, label: `Removing ${item.what}`, removing: true })
    const outcome = await runCli(spawnCli, item.args)
    if (outcome.code !== 0) failures.push(item.what)
  }
  return failures
}
