/**
 * A `.stlib` archive read from its JSON text and kept verbatim: every top-level field the file carries (the
 * `openplc` metadata, fields added later) stays on the object both platforms hand to the rest of the editor.
 */
import type { StlibArchive } from 'strucpp'

import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a parsed JSON value has the archive shape the editor reads: a manifest with its identity and symbol lists. */
export function isStlibArchiveDTO(value: unknown): value is StlibArchiveDTO {
  if (!isRecord(value) || !isRecord(value.manifest)) return false
  const { name, version, namespace, isBuiltin, functions, functionBlocks, types } = value.manifest
  return (
    typeof name === 'string' &&
    name !== '' &&
    typeof version === 'string' &&
    version !== '' &&
    typeof namespace === 'string' &&
    namespace !== '' &&
    typeof isBuiltin === 'boolean' &&
    Array.isArray(functions) &&
    Array.isArray(functionBlocks) &&
    Array.isArray(types)
  )
}

/** Whether a value is a library archive with a named manifest, as STruC++ takes one in its `libraries` options. */
export function isStrucppArchive(value: unknown): value is StlibArchive {
  return isRecord(value) && isRecord(value.manifest) && typeof value.manifest.name === 'string'
}

/** A library archive as the editor reads it, or the reason it is not one. */
export type StlibArchiveRead = { ok: true; archive: StlibArchiveDTO } | { ok: false; reason: string }

/** Manifest fields STruC++'s loader requires as non-empty strings. */
const REQUIRED_MANIFEST_TEXT = ['name', 'version', 'namespace'] as const

/** Manifest symbol lists STruC++'s loader reads as empty when they are not lists. */
const MANIFEST_LISTS = ['functions', 'functionBlocks', 'types'] as const

/**
 * `value` as a library archive, with the manifest defaults STruC++'s `loadStlibFromString` applies (`isBuiltin` false,
 * symbol lists that are not lists empty) filled in and every other field kept, or the reason the loader would refuse it.
 */
export function readStlibArchive(value: unknown): StlibArchiveRead {
  if (!isRecord(value)) return { ok: false, reason: 'it is not a JSON object' }
  const { manifest } = value
  if (!isRecord(manifest)) return { ok: false, reason: "its 'manifest' is not an object" }
  for (const field of REQUIRED_MANIFEST_TEXT) {
    const text = manifest[field]
    if (typeof text !== 'string' || text === '')
      return { ok: false, reason: `its manifest '${field}' is not a non-empty string` }
  }
  const lists: Record<string, unknown> = {}
  for (const field of MANIFEST_LISTS) lists[field] = Array.isArray(manifest[field]) ? manifest[field] : []
  const archive = { ...value, manifest: { ...manifest, ...lists, isBuiltin: Boolean(manifest.isBuiltin) } }
  return isStlibArchiveDTO(archive) ? { ok: true, archive } : { ok: false, reason: 'its manifest is not readable' }
}

/**
 * The archive in a `.stlib` file's text, with every field it carries, or null when the text is not one; a refused
 * archive is logged with `label` and the reason.
 */
export function stlibArchiveFromText(text: string, label = 'a library archive'): StlibArchiveDTO | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    console.warn(`[library] ${label} is not loaded: it is not JSON (${String(error)})`)
    return null
  }
  const read = readStlibArchive(parsed)
  if (read.ok) return read.archive
  console.warn(`[library] ${label} is not loaded: ${read.reason}`)
  return null
}
