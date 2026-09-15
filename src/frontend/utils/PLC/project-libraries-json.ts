/**
 * Replace `data.libraries` in a `project.json` document, leaving every other
 * key byte-for-byte as it was.
 *
 * The library manager changes one field of a file the whole editor writes, so a
 * full re-serialise would rewrite unrelated keys — including any a newer build
 * added that this one does not model. Surgical replacement keeps the diff to the
 * line that changed.
 *
 * Pure and string-in/string-out so the GUI's save path and the CLI can share it
 * rather than growing a second implementation each.
 */

export interface ProjectLibraryRef {
  name: string
  version: string
}

export type WithProjectLibrariesResult = { ok: true; json: string } | { ok: false; error: string }

/**
 * Refs are sorted by name so two editors repinning the same project produce the
 * same file, and a diff shows the version change rather than a reordering.
 */
export function sortProjectLibraryRefs(refs: readonly ProjectLibraryRef[]): ProjectLibraryRef[] {
  return [...refs].sort((a, b) => a.name.localeCompare(b.name)).map((ref) => ({ name: ref.name, version: ref.version }))
}

export function withProjectLibraries(json: string, refs: readonly ProjectLibraryRef[]): WithProjectLibrariesResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: 'project.json on disk is malformed' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'project.json on disk is not an object' }
  }

  const document = parsed as Record<string, unknown>
  // A project.json without a `data` key is not one this editor wrote, but the
  // caller asked for libraries to be set — create it rather than failing.
  const data =
    typeof document.data === 'object' && document.data !== null && !Array.isArray(document.data)
      ? (document.data as Record<string, unknown>)
      : {}
  document.data = data
  data.libraries = sortProjectLibraryRefs(refs)

  return { ok: true, json: JSON.stringify(document, null, 2) }
}
