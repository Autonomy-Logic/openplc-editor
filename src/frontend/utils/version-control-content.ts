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
    return raw
  }
  return freshSerialized
}
