import type { PackageInstallProgress } from '../ports/types'

/** The step line of a board package install or removal, e.g. `Installing core arduino:avr (1 of 3)`. */
export function formatInstallStep(progress: PackageInstallProgress): string {
  return progress.total > 0 ? `${progress.label} (${progress.step} of ${progress.total})` : progress.label
}
