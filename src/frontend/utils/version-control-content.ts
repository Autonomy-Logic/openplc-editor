/**
 * Minimal shape of the version-control state slice that `pickContentForSave`
 * needs. Defined here so the helper stays in `utils` (which can't import
 * from `store` per architecture rules) — callers pass `state.versionControl`.
 */
export type VersionControlSyncState = {
  loadedSerialized: Record<string, string>
  rawLoadedContent: Record<string, string>
}

/**
 * Decide what content to upload for a given path. If the freshly serialized
 * value matches the snapshot from the last sync point, the user hasn't
 * effectively touched this file — echo back the raw text so S3 stays
 * byte-identical to HEAD (no parse-serialize drift). Otherwise upload the
 * fresh serialization.
 *
 * Works for any path, including files without file-slice tracking
 * (`project.json`, `devices/configuration.json`, `devices/pin-mapping.json`).
 */
export function pickContentForSave(path: string, freshSerialized: string, syncState: VersionControlSyncState): string {
  const loadedSer = syncState.loadedSerialized[path]
  const raw = syncState.rawLoadedContent[path]
  if (loadedSer !== undefined && freshSerialized === loadedSer && raw !== undefined) {
    // The snapshot taken on open already carries the libraries the save derives from
    // usage, so "unchanged since open" is true even when the file on disk never declared
    // them. Echoing the raw text would then drop the one thing the save exists to add.
    if (path === 'project.json' && declaresLibrariesRawLacks(freshSerialized, raw)) {
      return freshSerialized
    }
    return raw
  }
  return freshSerialized
}

/** True when `fresh` declares a library `raw` does not; anything unparseable reads as "no". */
function declaresLibrariesRawLacks(fresh: string, raw: string): boolean {
  const names = (text: string): Set<string> | null => {
    try {
      const parsed: unknown = JSON.parse(text)
      const libraries = (parsed as { data?: { libraries?: unknown } }).data?.libraries
      if (!Array.isArray(libraries)) return new Set()
      return new Set(
        libraries.flatMap((entry) => {
          const name = (entry as { name?: unknown }).name
          return typeof name === 'string' ? [name] : []
        }),
      )
    } catch {
      return null
    }
  }
  const freshNames = names(fresh)
  const rawNames = names(raw)
  if (!freshNames || !rawNames) return false
  return [...freshNames].some((name) => !rawNames.has(name))
}
