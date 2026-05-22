// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Pure mappers from a parsed `.stlib` archive to the
 * `InstalledLibrary` row shape rendered by the Library Manager.
 *
 * Same mapping logic the editor's `LibraryManagerModule.listInstalled()`
 * applies to bundled + user-installed entries — extracted here so the
 * web adapter side renders identical rows for the bundled set without
 * any divergent re-implementation, and so future field additions
 * (e.g. `author`) only need a single touchpoint.
 *
 * Lives under `backend/shared/library/` alongside the other
 * platform-agnostic library helpers (parse-stlib-archive,
 * compile-stlib, …).  No filesystem, no HTTP, no DOM — safe to import
 * from either the editor's main process or the browser bundle.
 */

import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import type { InstalledLibrary } from '../../../middleware/shared/ports/library-types'

/**
 * Map a parsed bundled archive (an entry produced by Vite's `?raw`
 * glob on web, or the same parse called against
 * `<resources>/strucpp/libs/*.stlib` on editor) to an
 * `InstalledLibrary` row pinned with `bundled: true, origin: 'bundled'`.
 *
 * Empty `installedAt` matches the editor's convention — bundled libs
 * have no meaningful "installed at" since they ship with the binary.
 * The optional `displayName` / `description` are spread conditionally
 * so the row shape stays minimal when the manifest doesn't carry them.
 */
export function bundledArchiveToInstalledRow(archive: StlibArchiveDTO): InstalledLibrary {
  return {
    name: archive.manifest.name,
    version: archive.manifest.version,
    bundled: true,
    installedAt: '',
    origin: 'bundled',
    ...(archive.manifest.displayName ? { displayName: archive.manifest.displayName } : {}),
    ...(archive.manifest.description ? { description: archive.manifest.description } : {}),
  }
}

/**
 * Map a parsed user-installed archive plus its registry metadata
 * (install timestamp + how it was acquired) to an `InstalledLibrary`
 * row.  `name` is taken from the registry key — same convention the
 * editor's module uses — so the installed identity wins over whatever
 * the manifest carries in the rare case they disagree.
 */
export function userArchiveToInstalledRow(
  archive: StlibArchiveDTO,
  metadata: { name: string; version: string; installedAt: string; origin: 'stlib' | 'codesys' },
): InstalledLibrary {
  return {
    name: metadata.name,
    version: metadata.version,
    bundled: false,
    installedAt: metadata.installedAt,
    origin: metadata.origin,
    ...(archive.manifest.displayName ? { displayName: archive.manifest.displayName } : {}),
    ...(archive.manifest.description ? { description: archive.manifest.description } : {}),
  }
}
