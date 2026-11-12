/**
 * `openplc-cli packages` — the installed VPP set, headless.
 *
 * The GUI installs a `.vpp` through "Add from file…"; there was no headless
 * equivalent, so preparing a machine to compile against a given set of packages
 * meant clicking through the UI once per package. That is fine for a person and
 * useless for a matrix run, which is the job this exists for: point a scratch
 * `--user-data` at nothing, install the packages under test, compile.
 *
 * `install` runs the same `VppDependencyService` as the UI (schema, signature and
 * dependency install), then installs the global libraries when missing.
 */

import { readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import { CompilerModule } from '@root/backend/editor/compiler/compiler-module'
import { HardwareModule } from '@root/backend/editor/hardware'
import { PackageManagerModule } from '@root/backend/editor/package-manager'
import { installArduinoDependencies } from '@root/backend/editor/package-manager/arduino-dependency-installer'
import { VppDependencyService } from '@root/backend/editor/package-manager/vpp-dependency-service'
import { STARTUP_ARDUINO_DEPENDENCIES } from '@root/backend/shared/packages/arduino-dependencies'
import type { PackageInstallProgress } from '@root/middleware/shared/ports/types'
import { formatInstallStep } from '@root/middleware/shared/utils/package-install-step'

import type { ParsedArgs } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import { type CliResult, renderTable, type Reporter } from '../output'

interface ListedBoard {
  /** Pass this to `--target`. */
  name: string
  /** Absent for a board that comes from the bundled `hals.json` rather than a package. */
  packageId?: string
  /** `arduino-cli` or `openplc-compiler` — which branch of the pipeline it takes. */
  compiler: string
  /** Absent on a target with no Arduino core at all, such as Runtime v3/v4. */
  core?: string
  /** The version the board's manifest pins, when it pins one. */
  coreVersion?: string
}

/** Every `.vpp` under the given paths; a directory contributes its own entries only. */
async function collectVppPaths(inputs: string[]): Promise<string[]> {
  const found: string[] = []
  for (const input of inputs) {
    const path = resolve(input)
    const info = await stat(path)
    if (!info.isDirectory()) {
      found.push(path)
      continue
    }
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name) === '.vpp') found.push(join(path, entry.name))
    }
  }
  // Sorted so a run over a directory is reproducible, and so a failure part-way
  // through leaves a state a rerun reproduces rather than a new random half.
  return found.sort()
}

async function runInstall(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  if (args.positionals.length === 0) {
    return reporter.failure(
      { code: ErrorCode.MissingArgument, message: 'Name at least one .vpp file or a directory holding them.' },
      ExitCode.Usage,
    )
  }

  let paths: string[]
  try {
    paths = await collectVppPaths(args.positionals)
  } catch (error) {
    return reporter.failure(
      { code: ErrorCode.ProjectNotFound, message: error instanceof Error ? error.message : String(error) },
      ExitCode.NotFound,
    )
  }

  if (paths.length === 0) {
    return reporter.failure(
      { code: ErrorCode.ProjectNotFound, message: 'No .vpp files found at the given paths.' },
      ExitCode.NotFound,
    )
  }

  const compiler = new CompilerModule()
  const spawnCli = (cliArgs: string[]) => compiler.spawnArduinoCli(cliArgs)
  const dependencies = new VppDependencyService(new PackageManagerModule(), spawnCli)
  const installed: { path: string; packageId?: string; devices?: string[] }[] = []
  const failed: { path: string; error: string }[] = []

  const common = await installArduinoDependencies(
    STARTUP_ARDUINO_DEPENDENCIES,
    spawnCli,
    dependencyProgressPrinter(reporter),
    { keepGoing: true },
  )
  if (!common.ok) {
    reporter.progress(
      `  warning: could not install the global libraries (${common.error}). ` +
        'Builds that need them will fail; run this command again while connected to the internet.',
    )
  }

  for (const path of paths) {
    const result = await dependencies.importPackage(path, dependencyProgressPrinter(reporter))
    if (result.success) {
      installed.push({ path, packageId: result.packageId, devices: result.devices })
      reporter.progress(`  installed ${result.packageId ?? path}`)
    } else {
      failed.push({ path, error: result.error ?? 'unknown error' })
      reporter.progress(`  FAILED ${path}: ${result.error ?? 'unknown error'}`)
    }
  }

  // Every package is attempted even after one fails, because a matrix run wants
  // the whole picture rather than the first casualty. The exit code still
  // reports failure, so a script cannot read a partial install as done.
  if (failed.length > 0) {
    return reporter.failure(
      {
        code: ErrorCode.TargetError,
        message: `${failed.length} of ${paths.length} package(s) failed to install:\n${failed
          .map((entry) => `  ${entry.path}: ${entry.error}`)
          .join('\n')}`,
        details: { installed, failed },
      },
      ExitCode.TargetError,
    )
  }

  return reporter.success({ installed, failed }, () => `Installed ${installed.length} package(s).`)
}

/** One stderr line per dependency step, and one per archive as its download starts. */
function dependencyProgressPrinter(reporter: Reporter): (progress: PackageInstallProgress) => void {
  let lastStep = ''
  const downloads = new Set<string>()
  return (progress) => {
    const step = `  ${formatInstallStep(progress)}`
    if (step !== lastStep) {
      lastStep = step
      reporter.progress(step)
    }
    if (progress.download && !downloads.has(progress.download.item)) {
      downloads.add(progress.download.item)
      reporter.progress(`    downloading ${progress.download.item} (${progress.download.total})`)
    }
  }
}

async function runList(reporter: Reporter): Promise<CliResult> {
  const manager = new PackageManagerModule()
  const packages = manager.listInstalled()

  // Board names come from the hardware module, not from the manifests: this map
  // is what `--target` is matched against, and it already merges the bundled
  // hals.json entries with the installed packages' devices. Listing anything
  // else would hand a caller a name the compile then rejects.
  const available = await new HardwareModule().getAvailableBoards()

  // The pin, on the other hand, is NOT on that map: `getAvailableBoards` fills
  // `coreVersion` from the editor's own installed-core record, which only covers
  // hals.json boards. A VPP device's pin lives in its manifest's
  // `target.coreVersion`, so read it there — without it a caller cannot tell a
  // build that honoured the pin from one that quietly used another version.
  const pins = new Map<string, string>()
  for (const pkg of packages) {
    const manifest = manager.getInstalledPackageManifest(pkg.packageId)
    for (const device of manifest?.devices ?? []) {
      const pinned = device.target?.coreVersion
      if (typeof pinned === 'string') pins.set(`${pkg.packageId}\u0000${device.id}`, pinned)
    }
  }

  const boards: ListedBoard[] = []
  for (const [name, info] of available) {
    const vppPin = info.vpp === undefined ? undefined : pins.get(`${info.vpp.packageId}\u0000${info.vpp.deviceId}`)
    const pinned = vppPin ?? info.coreVersion
    boards.push({
      name,
      ...(info.vpp?.packageId ? { packageId: info.vpp.packageId } : {}),
      compiler: info.compiler,
      ...(info.core ? { core: info.core } : {}),
      ...(pinned ? { coreVersion: pinned } : {}),
    })
  }
  boards.sort((a, b) => a.name.localeCompare(b.name))

  return reporter.success({ packages, boards }, () => {
    if (boards.length === 0) return 'No boards available.'
    return renderTable(
      ['BOARD', 'PACKAGE', 'COMPILER', 'CORE', 'PINNED'],
      boards.map((board) => [
        board.name,
        board.packageId ?? '(built-in)',
        board.compiler,
        board.core ?? '-',
        board.coreVersion ?? '-',
      ]),
    )
  })
}

export async function runPackages(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  switch (args.subcommand) {
    case 'install':
      return runInstall(args, reporter)
    case 'list':
      return runList(reporter)
    case undefined:
      return reporter.failure(
        { code: ErrorCode.MissingArgument, message: 'Name a packages subcommand: install, list' },
        ExitCode.Usage,
      )
    default:
      return reporter.failure(
        { code: ErrorCode.UnknownCommand, message: `Unknown packages subcommand "${args.subcommand}"` },
        ExitCode.Usage,
      )
  }
}
