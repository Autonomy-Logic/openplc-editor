/**
 * A `.stlib` archive read from its JSON text and kept verbatim: every top-level field the file carries (the
 * `openplc` metadata, fields added later) stays on the object both platforms hand to the rest of the editor.
 */
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
    typeof namespace === 'string' &&
    typeof isBuiltin === 'boolean' &&
    Array.isArray(functions) &&
    Array.isArray(functionBlocks) &&
    Array.isArray(types)
  )
}

/** The archive in a `.stlib` file's text, with every field it carries, or null when the text is not one. */
export function stlibArchiveFromText(text: string): StlibArchiveDTO | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return isStlibArchiveDTO(parsed) ? parsed : null
}
