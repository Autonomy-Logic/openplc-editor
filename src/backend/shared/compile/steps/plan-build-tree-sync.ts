import { BOARD_HAL_SKELETON_PATH } from './merge-strucpp-runtime-into-skeleton'

/** arduino-cli's `--export-binaries` output, inside the sketch folder. Never removed by a sync. */
export const ARDUINO_EXPORT_DIR = 'examples/Baremetal/build/'

export interface BuildTreeSyncInput {
  /** Every file this build needs, keyed by POSIX path relative to the build folder. */
  desired: Readonly<Record<string, string>>
  /** The editor's static firmware resources at their build-folder paths (skeleton and runtime headers, no HAL). */
  staticFiles: Readonly<Record<string, string>>
  /** POSIX paths of the files currently in the build folder. */
  existingPaths: readonly string[]
  /** Current content of the paths `staticCandidates` returned; a missing entry means unreadable. */
  existingContents: Readonly<Record<string, string>>
}

export interface BuildTreeSyncPlan {
  /** Paths to write from `desired`. */
  write: string[]
  /** Paths to delete. */
  remove: string[]
}

/**
 * Paths whose write may be skipped: the desired content is the editor's
 * static resource, byte for byte. Only these need their disk copy read.
 */
export function staticCandidates(
  desired: Readonly<Record<string, string>>,
  staticFiles: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(desired).filter(
    (path) =>
      path !== BOARD_HAL_SKELETON_PATH && staticFiles[path] !== undefined && staticFiles[path] === desired[path],
  )
}

/**
 * Plans the writes and deletions that bring a kept build folder up to date: unchanged
 * static files are skipped, every other desired file is written, and files no longer
 * desired are removed, except under `ARDUINO_EXPORT_DIR`.
 */
export function planBuildTreeSync(input: BuildTreeSyncInput): BuildTreeSyncPlan {
  const { desired, staticFiles, existingPaths, existingContents } = input
  const unchangedStatic = new Set(
    staticCandidates(desired, staticFiles).filter((path) => existingContents[path] === desired[path]),
  )
  const write = Object.keys(desired)
    .filter((path) => !unchangedStatic.has(path))
    .sort()
  const remove = existingPaths
    .filter((path) => desired[path] === undefined && !path.startsWith(ARDUINO_EXPORT_DIR))
    .sort()
  return { write, remove }
}

/** Whether the board build folder is deleted before a build: always for Runtime v3 and v4 and for a Clean Build. */
export function shouldWipeBuildFolder(args: {
  cleanBuild: boolean
  isRuntimeV3: boolean
  isRuntimeV4: boolean
}): boolean {
  return args.cleanBuild || args.isRuntimeV3 || args.isRuntimeV4
}
