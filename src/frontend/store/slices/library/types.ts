export type {
  LibraryLanguage,
  LibraryPouType,
  LibraryState,
  SystemLibrary,
  SystemLibraryPou,
  SystemLibraryVariable,
  UserLibrary,
} from '../../../../middleware/shared/ports/library-types'

import type { SystemLibrary } from '../../../../middleware/shared/ports/library-types'

/**
 * Project-side reference to a system library.  Mirrors
 * `PLCProjectLibraryRef` from the project schema — duplicated here so
 * the slice doesn't pull in a backend-types dependency.
 */
export type LibraryProjectRef = {
  name: string
  version: string
}

/**
 * One row of the project-pool diff: a library the project lists in
 * its `libraries` field but the system pool doesn't currently have.
 * Surfaced after project open so the missing-libraries modal can
 * route the user to the manager.
 */
export type MissingLibrary = {
  name: string
  /** Optional — the project records a version, but version-mismatch
   *  vs. fully-absent both flow through this list.  The manager UI
   *  decides how to render based on whether the name exists in the
   *  pool at all. */
  version?: string
}

export type LibraryActions = {
  setSystemLibraries: (libraries: SystemLibrary[]) => void
  addLibrary: (name: string, type: 'function' | 'function-block') => void
  updateLibraryName: (name: string, newName: string) => void
  clearUserLibraries: () => void
  removeUserLibrary: (name: string) => void
  /**
   * Mark a system library as enabled for the current project.  No-op
   * for canonical (bundled) libraries — they're always-on regardless
   * of project enablement and don't appear in the per-project list.
   * No-op when the library isn't in the system pool either.  Adds
   * the library's `(name, version)` to `state.project.libraries`.
   */
  enableLibrary: (name: string) => void
  /**
   * Remove a system library from the current project.  No-op for
   * canonical libraries.  Drops the row from `state.project.libraries`.
   */
  disableLibrary: (name: string) => void
  /**
   * Replace the project-enabled set + recompute `missing` against the
   * current system pool.  Called during project open with the parsed
   * `project.libraries` field.
   */
  setProjectLibraries: (refs: LibraryProjectRef[]) => void
  /**
   * Record which names in the system pool are bundled / canonical.
   * Called by the app's library hydration after `listInstalled()` —
   * the bundled flag isn't carried by `SystemLibrary` itself, so the
   * slice has to be told separately.
   */
  setBundledLibraryNames: (names: string[]) => void
}

export type LibrarySliceExtra = {
  /** Names of non-bundled libraries enabled for the current project.
   *  Bundled libraries are always-on and intentionally not tracked
   *  here. */
  enabledLibraries: string[]
  /** Names of bundled / canonical libraries that ship with strucpp.
   *  Always-on regardless of the project's enablement; surfaced to
   *  consumers that need to scope the visible pool to "bundled +
   *  enabled" (left-panel library tree, block pickers). */
  bundledLibraryNames: string[]
  /** Project-referenced libraries the system pool currently can't
   *  resolve.  Drives the missing-libraries modal post-project-open. */
  missingLibraries: MissingLibrary[]
}

export type LibrarySlice = import('../../../../middleware/shared/ports/library-types').LibraryState &
  LibrarySliceExtra & {
    libraryActions: LibraryActions
  }
