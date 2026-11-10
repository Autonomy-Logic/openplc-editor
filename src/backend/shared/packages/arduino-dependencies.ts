/**
 * The arduino-cli cores and libraries a board package (VPP) depends on, and the
 * decisions taken on them when the package is installed, reinstalled or removed.
 *
 * Pure: manifests and the installed state in, plans out. The editor runs the plans
 * with arduino-cli; the web build has no local arduino-cli and never runs them.
 */

import type { PackageDownloadProgress, PackageManifest } from '../../../middleware/shared/ports/types'
import { resolveTargetCapabilities } from '../../../middleware/shared/utils/target-capabilities'
import { selectThirdPartyLibraries, type ThirdPartyLibrary } from '../compile/third-party-libraries'

/** The core the built-in simulator compiles with; no package provides it. */
export const SIMULATOR_CORE = 'arduino:avr'

/** Libraries installed for every arduino-cli target, independent of any package. */
export const GLOBAL_ARDUINO_LIBRARIES: readonly string[] = [
  'Arduino_EdgeControl',
  'ArduinoJson',
  'Arduino_MachineControl',
  'ArduinoMqttClient',
  'AVR_PWM',
  'CAN',
  'CONTROLLINO',
  'DallasTemperature',
  'Ethernet',
  'megaAVR_PWM',
  'OneWire',
  'P1AM',
  'Portenta_H7_PWM',
  'PubSubClient',
  'RP2040_PWM',
  'SAMD_PWM',
  'SAMDUE_PWM',
  'STM32_CAN',
  'STM32_PWM',
  'WiFiNINA',
]

export interface ArduinoCoreDependency {
  /** Platform id, `vendor:architecture`. */
  id: string
  /** Exact version the package pins, when it pins one. */
  version?: string
  /** Extra board-manager index the core is published in. */
  boardManagerUrl?: string
}

export interface ArduinoDependencies {
  cores: ArduinoCoreDependency[]
  /** Library-index names, possibly `Name@version`. */
  libraries: string[]
  gitLibraries: ThirdPartyLibrary[]
}

/** What arduino-cli reports as installed: core id to version, and library names. */
export interface InstalledArduinoState {
  cores: Readonly<Record<string, string>>
  libraries: readonly string[]
}

export type DependencyStep =
  | { kind: 'core'; core: ArduinoCoreDependency }
  | { kind: 'library'; name: string }
  | { kind: 'git-library'; library: ThirdPartyLibrary }

export interface DependencyRemovalPlan {
  cores: string[]
  libraries: string[]
}

/** `vendor:arch:board` to `vendor:arch`; empty for anything else. */
export function coreIdFromPlatform(platform: string): string {
  const parts = platform.split(':')
  return parts.length >= 2 && parts[0] !== '' && parts[1] !== '' ? `${parts[0]}:${parts[1]}` : ''
}

/** A library reference without its `@version` suffix. */
export function libraryName(reference: string): string {
  const at = reference.indexOf('@')
  return at > 0 ? reference.slice(0, at) : reference
}

/** Every core and library the arduino-cli devices of @p manifest need, without duplicates. */
export function collectArduinoDependencies(manifest: Pick<PackageManifest, 'devices'>): ArduinoDependencies {
  const cores = new Map<string, ArduinoCoreDependency>()
  const libraries = new Map<string, string>()
  const gitLibraries = new Map<string, ThirdPartyLibrary>()
  for (const device of manifest.devices) {
    if (device.target.type !== 'arduino-cli') continue
    const id = coreIdFromPlatform(device.target.platform ?? '') || (device.target.core ?? '')
    if (id !== '' && !cores.has(id)) {
      const core: ArduinoCoreDependency = { id }
      if (device.target.coreVersion) core.version = device.target.coreVersion
      if (device.target.boardManagerUrl) core.boardManagerUrl = device.target.boardManagerUrl
      cores.set(id, core)
    }
    for (const reference of device.hal.extraArduinoLibraries ?? []) {
      if (!libraries.has(libraryName(reference))) libraries.set(libraryName(reference), reference)
    }
    const capabilities = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: device.capabilities })
    for (const library of selectThirdPartyLibraries(capabilities)) gitLibraries.set(library.name, library)
  }
  return { cores: [...cores.values()], libraries: [...libraries.values()], gitLibraries: [...gitLibraries.values()] }
}

/** The steps still needed for @p dependencies: cores first, then git libraries, then index libraries. */
export function planDependencyInstall(
  dependencies: ArduinoDependencies,
  installed: InstalledArduinoState,
): DependencyStep[] {
  const present = new Set(installed.libraries)
  const steps: DependencyStep[] = []
  for (const core of dependencies.cores) {
    const version = installed.cores[core.id]
    const satisfied = version !== undefined && (core.version === undefined || core.version === version)
    if (!satisfied) steps.push({ kind: 'core', core })
  }
  for (const library of dependencies.gitLibraries) {
    if (!present.has(library.name)) steps.push({ kind: 'git-library', library })
  }
  for (const reference of dependencies.libraries) {
    if (!present.has(libraryName(reference))) steps.push({ kind: 'library', name: reference })
  }
  return steps
}

/**
 * What uninstalling a package may remove: its cores and libraries that no package
 * in @p remaining declares, that are installed, and that are neither the
 * simulator's core nor a global library.
 */
export function planDependencyRemoval(
  removed: ArduinoDependencies,
  remaining: readonly ArduinoDependencies[],
  installed: InstalledArduinoState,
): DependencyRemovalPlan {
  const keptCores = new Set([SIMULATOR_CORE, ...remaining.flatMap((deps) => deps.cores.map((core) => core.id))])
  const keptLibraries = new Set([
    ...GLOBAL_ARDUINO_LIBRARIES,
    ...remaining.flatMap((deps) => [...deps.libraries.map(libraryName), ...deps.gitLibraries.map((l) => l.name)]),
  ])
  const presentLibraries = new Set(installed.libraries)
  const cores = removed.cores
    .map((core) => core.id)
    .filter((id) => !keptCores.has(id) && installed.cores[id] !== undefined)
  const libraries = [...removed.libraries.map(libraryName), ...removed.gitLibraries.map((l) => l.name)].filter(
    (name) => !keptLibraries.has(name) && presentLibraries.has(name),
  )
  return { cores: [...new Set(cores)], libraries: [...new Set(libraries)] }
}

/** The arduino-cli argument lists that carry out @p step, run in order. */
export function dependencyStepArgs(step: DependencyStep): string[][] {
  switch (step.kind) {
    case 'core': {
      const reference = step.core.version ? `${step.core.id}@${step.core.version}` : step.core.id
      if (!step.core.boardManagerUrl) return [['core', 'install', reference]]
      const urls = ['--additional-urls', step.core.boardManagerUrl]
      return [
        ['core', 'update-index', ...urls],
        ['core', 'install', reference, ...urls],
      ]
    }
    case 'library':
      return [['lib', 'install', step.name]]
    case 'git-library':
      return [['lib', 'install', '--git-url', step.library.gitUrl]]
  }
}

/** One line naming a step, e.g. `Installing core esp32:esp32 3.3.10`. */
export function describeDependencyStep(step: DependencyStep): string {
  switch (step.kind) {
    case 'core':
      return `Installing core ${step.core.id}${step.core.version ? ` ${step.core.version}` : ''}`
    case 'library':
      return `Installing library ${step.name}`
    case 'git-library':
      return `Installing library ${step.library.name} (${step.library.reason})`
  }
}

/** The name of what @p step installs, e.g. `arduino:avr` or `Ethernet`. */
export function dependencyStepName(step: DependencyStep): string {
  switch (step.kind) {
    case 'core':
      return step.core.id
    case 'library':
      return libraryName(step.name)
    case 'git-library':
      return step.library.name
  }
}

const PROGRESS_RECORD = /^(\S+)\s+([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B)\s+([\d.]+)%/

/** The last download-progress record in a chunk of arduino-cli output, or null when there is none. */
export function parseArduinoCliProgress(output: string): PackageDownloadProgress | null {
  const records = output.split(/[\r\n]+/)
  for (let index = records.length - 1; index >= 0; index--) {
    const match = PROGRESS_RECORD.exec(records[index].trim())
    if (match) return { item: match[1], done: match[2], total: match[3], percent: Number(match[4]) }
  }
  return null
}

/** Where the hint is shown, which decides how the user is told to repair the install. */
export type DependencyHintSurface = 'desktop' | 'cli'

const MISSING_CORE = /Platform '[^']+' not found|platform not installed/i

/** Whether arduino-cli output shows that the board's core is not installed. */
export function detectsMissingArduinoCore(output: string): boolean {
  return MISSING_CORE.test(output)
}

/** The console hint for a build that failed because its core is not installed. */
export function missingArduinoCoreHint(options: { simulator: boolean; surface: DependencyHintSurface }): string {
  if (options.simulator) {
    const repair =
      options.surface === 'cli'
        ? 'Run openplc-cli packages install <file.vpp> with any board package while connected to the internet; it also installs the simulator core.'
        : 'Start the OpenPLC Editor while connected to the internet so it can install it.'
    return `The simulator's Arduino core (${SIMULATOR_CORE}) is not installed. ${repair} Then build again.`
  }
  const repair =
    options.surface === 'cli'
      ? 'Reinstall the board package with: openplc-cli packages install <file.vpp>'
      : 'Open File > Board Package Manager..., select the board package and click Reinstall.'
  return `The Arduino core for this device is not installed. ${repair} Then build again.`
}

/** What the editor installs at startup when missing: the simulator's core and the global libraries. */
export const STARTUP_ARDUINO_DEPENDENCIES: ArduinoDependencies = {
  cores: [{ id: SIMULATOR_CORE }],
  libraries: [...GLOBAL_ARDUINO_LIBRARIES],
  gitLibraries: [],
}

/** The console line announcing what the startup check is about to install. */
export function startupInstallNotice(steps: readonly DependencyStep[]): string {
  return `Installing Arduino components every build needs: ${steps.map(dependencyStepName).join(', ')}.`
}

/** The console warning when the startup check could not install what was missing. */
export function startupInstallWarning(error: string): string {
  return (
    `Could not install the Arduino components every build needs (${error}). ` +
    'Builds still run, but may fail on a missing library or, for the simulator, a missing core. ' +
    'Restart the editor while connected to the internet to try again.'
  )
}
