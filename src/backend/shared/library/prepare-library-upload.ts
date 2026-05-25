/**
 * Shared library-upload preparation — the pure-logic half of the
 * "user picked a file, produce a `.stlib` archive plus manifest
 * metadata" pipeline.  Lives in `backend/shared/` so the Electron
 * editor (which reads the picked file off disk) and the openplc-web
 * adapter (which reads off an HTTP upload) call into the same
 * strucpp pipeline.  File I/O — reading the upload bytes / writing
 * the produced archive — stays platform-specific.
 *
 * Strucpp is the single source of truth for both `.stlib` validation
 * and CODESYS `.lib` / `.library` conversion.  Bumping the strucpp
 * package version is the only change required to pick up parser
 * improvements; nothing here interprets archive contents beyond what
 * strucpp returns.
 */

import { importCodesysLibrary } from './codesys-import'
import { compileStlib } from './compile-stlib'
import { parseStlibArchive } from './parse-stlib-archive'

/** Source flavor for the registry / install result. */
export type LibraryOrigin = 'stlib' | 'codesys'

export interface PreparedLibrary {
  /** Manifest name — used as the storage key + registry key. */
  name: string
  version: string
  /** Where the original upload came from.  Used for the registry row
   *  and the install result. */
  origin: LibraryOrigin
  /** Serialized `.stlib` JSON text — persistence callers write this
   *  to disk / S3 verbatim. */
  archive: string
  displayName?: string
  description?: string
  author?: string
}

interface ManifestSummary {
  name: string
  version: string
  displayName?: string
  description?: string
  author?: string
}

function extractManifest(archive: unknown): ManifestSummary | null {
  if (!archive || typeof archive !== 'object') return null
  const manifest = (archive as { manifest?: unknown }).manifest
  if (!manifest || typeof manifest !== 'object') return null
  const m = manifest as Record<string, unknown>
  if (typeof m.name !== 'string' || typeof m.version !== 'string') return null
  return {
    name: m.name,
    version: m.version,
    ...(typeof m.displayName === 'string' ? { displayName: m.displayName } : {}),
    ...(typeof m.description === 'string' ? { description: m.description } : {}),
    ...(typeof m.author === 'string' ? { author: m.author } : {}),
  }
}

/**
 * Path-safe basename extractor — accepts forward- or back-slashed
 * paths (the openplc-web client picks up the raw filename from a
 * File object; Electron callers pass `basename(filePath)`).
 */
function basenameNoExt(filename: string): string {
  const slashed = filename.replace(/\\/g, '/')
  const baseWithExt = slashed.slice(slashed.lastIndexOf('/') + 1)
  const dot = baseWithExt.lastIndexOf('.')
  return dot > 0 ? baseWithExt.slice(0, dot) : baseWithExt
}

/**
 * Derive a strucpp-safe identifier from a CODESYS filename.  CODESYS
 * `.library` files carry richer metadata in the binary header, but
 * strucpp's importer doesn't currently surface it; falling back to
 * the filename gives the user a predictable identifier they can
 * rename later.  Same fallback both the editor and web have always
 * used.
 */
function deriveCodesysIdentifier(filename: string): string {
  const baseName = basenameNoExt(filename)
  let identifier = baseName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
  if (!identifier) identifier = 'imported-library'
  return identifier
}

/**
 * Validate + extract a `.stlib` archive uploaded as text.  Returns
 * the manifest summary + the original bytes (persisted verbatim);
 * throws on a malformed archive so the caller can surface the
 * specific strucpp error.
 */
export function prepareStlibUpload(text: string): PreparedLibrary {
  // strucpp's `loadStlibFromString` validates the archive beyond raw
  // `JSON.parse` — schema, manifest fields, symbol references.
  const parsed = parseStlibArchive(text)
  const manifest = extractManifest(parsed)
  if (!manifest) {
    throw new Error('Library archive is missing a manifest with a name and version')
  }
  return { ...manifest, origin: 'stlib', archive: text }
}

/**
 * Convert a CODESYS V2.3 / V3 `.lib` or `.library` upload to a
 * strucpp `.stlib` archive.  Returns the manifest summary + the
 * serialized archive text; throws on import / compile failure with
 * the strucpp error rolled up into the message.
 */
export async function prepareCodesysUpload(bytes: Uint8Array, filename: string): Promise<PreparedLibrary> {
  const importResult = await importCodesysLibrary(bytes)
  if (!importResult.success || !importResult.sources) {
    const errs = (importResult.errors ?? ['unknown error']).join('; ')
    throw new Error(`CODESYS import failed: ${errs}`)
  }

  const identifier = deriveCodesysIdentifier(filename)
  const compileResult = compileStlib(importResult.sources, {
    name: identifier,
    version: '1.0.0',
    namespace: identifier.replace(/[^A-Za-z0-9_]/g, '_'),
    noSource: false,
    builtin: false,
    ...(importResult.globalConstants ? { globalConstants: importResult.globalConstants } : {}),
  })
  if (!compileResult.success || !compileResult.archive) {
    const errs = (compileResult.errors ?? []).map((e) => e.message).join('; ')
    throw new Error(`CODESYS compile failed: ${errs || 'unknown error'}`)
  }

  const manifest = extractManifest(compileResult.archive)
  if (!manifest) {
    throw new Error('Converted CODESYS library is missing a manifest with a name and version')
  }
  return {
    ...manifest,
    origin: 'codesys',
    archive: JSON.stringify(compileResult.archive),
  }
}
