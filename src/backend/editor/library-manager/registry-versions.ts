/**
 * Registry format handling: migrate the v1 shape, and pick a version.
 *
 * Split out of the module so both are testable without an Electron app, and
 * so the one place that decides "which installed version does this project
 * get" is not buried in a filesystem method.
 */

import { compareSemver } from '../../../frontend/utils/semver'
import type { LibraryRegistry, LibraryVersionEntry } from './types'

export const REGISTRY_FORMAT_VERSION = '2.0'

const emptyRegistry = (): LibraryRegistry => ({ formatVersion: REGISTRY_FORMAT_VERSION, libraries: {} })

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => !!value && typeof value === 'object'

/** A v1 row carries its single version inline, beside the path. */
function asV1Entry(value: unknown): ({ version: string } & LibraryVersionEntry) | null {
  if (!isRecord(value)) return null
  if (typeof value.version !== 'string' || typeof value.stlibPath !== 'string') return null
  return value as unknown as { version: string } & LibraryVersionEntry
}

function asVersionMap(value: unknown): Record<string, LibraryVersionEntry> | null {
  if (!isRecord(value) || !isRecord(value.versions)) return null
  const out: Record<string, LibraryVersionEntry> = {}
  for (const [version, entry] of Object.entries(value.versions)) {
    if (isRecord(entry) && typeof entry.stlibPath === 'string') out[version] = entry as unknown as LibraryVersionEntry
  }
  return out
}

/**
 * Return any registry on disk in v2 shape.
 *
 * A v1 row keeps the path it already has rather than being moved, so the
 * migration touches no files and cannot leave the store half-converted.
 */
export function migrateRegistry(raw: unknown): LibraryRegistry {
  if (!isRecord(raw) || !isRecord(raw.libraries)) return emptyRegistry()

  const libraries: LibraryRegistry['libraries'] = {}
  for (const [name, value] of Object.entries(raw.libraries)) {
    const versions = asVersionMap(value)
    if (versions) {
      if (Object.keys(versions).length > 0) libraries[name] = { versions }
      continue
    }
    const v1 = asV1Entry(value)
    if (!v1) continue
    libraries[name] = {
      versions: {
        [v1.version]: {
          installedAt: v1.installedAt,
          stlibPath: v1.stlibPath,
          origin: v1.origin,
        },
      },
    }
  }
  return { formatVersion: REGISTRY_FORMAT_VERSION, libraries }
}

/** Installed versions, newest first. */
export function versionsNewestFirst(versions: Record<string, LibraryVersionEntry>): string[] {
  return Object.keys(versions).sort((a, b) => compareSemver(b, a))
}

export interface ResolvedVersion {
  version: string
  entry: LibraryVersionEntry
  /** The wanted version is not installed, so this is the newest instead. */
  substituted: boolean
}

/**
 * Pick the version a caller gets.
 *
 * An exact match wins. Otherwise the newest installed is returned and flagged
 * as substituted, so the caller reports the mismatch rather than a project
 * silently building against a version it does not name.
 */
export function resolveVersion(
  versions: Record<string, LibraryVersionEntry>,
  wanted?: string,
): ResolvedVersion | null {
  if (wanted && versions[wanted]) return { version: wanted, entry: versions[wanted], substituted: false }
  const newest = versionsNewestFirst(versions)[0]
  if (!newest) return null
  return { version: newest, entry: versions[newest], substituted: wanted !== undefined }
}

/**
 * A directory name to keep one version's archive in.
 *
 * The registry records the real version string and the real path, so the
 * folder only has to be safe -- not equal to the version. That matters
 * because a manifest version is free text: semver build metadata
 * (`1.0.0+sha.abc`) is legal and its `+` is not a permitted path character,
 * and refusing to install such a library would be a regression.
 *
 * @param taken directory names already used by this library's other versions.
 */
export function versionDirName(version: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = version.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
  if (base.length === 0) return `v_${used.size + 1}`
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}
