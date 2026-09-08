/**
 * Backend-internal library-manager types.
 *
 * The cross-process wire types (`InstalledLibrary`,
 * `LibraryInstallResult`) live in
 * `src/middleware/shared/ports/library-types.ts` so the IPC adapter
 * and the renderer share a single contract.  We re-export them here
 * so backend modules keep their imports local; the on-disk
 * `LibraryRegistry` shape stays backend-only.
 */

import type { InstalledLibrary, LibraryInstallResult } from '../../../middleware/shared/ports/library-types'

/** One installed build of one library version. */
export type LibraryVersionEntry = {
  installedAt: string
  /** Absolute path to the `.stlib` archive on disk. */
  stlibPath: string
  /** Source format the user installed from — "stlib" for native
   *  archives, "codesys" for .lib/.library imports.  Purely
   *  informational; UI may surface a badge. */
  origin: 'stlib' | 'codesys'
}

/**
 * On-disk shape of `{userData}/libraries/registry.json`.  Records
 * user-installed libraries (bundled libs are discovered fresh from
 * the strucpp resources dir each session, never persisted here).
 *
 * Keyed by `name` (the strucpp manifest's library identifier) — the
 * same value the project's `libraries[].name` field stores, so
 * project ↔ system pool joins are O(1).  Each name then holds every
 * installed version, so a project can pin one and still roll back.
 *
 * `formatVersion` "1.0" held a single version per name inline; it is
 * migrated on read by `readRegistry`.
 */
export type LibraryRegistry = {
  formatVersion: string
  libraries: Record<
    string,
    {
      /** Keyed by the manifest version string, e.g. "0.0.1". */
      versions: Record<string, LibraryVersionEntry>
    }
  >
}

/** A `formatVersion: "1.0"` registry, as it may still be on disk. */
export type LibraryRegistryV1 = {
  formatVersion: string
  libraries: Record<string, { version: string } & LibraryVersionEntry>
}

export type { InstalledLibrary, LibraryInstallResult }
