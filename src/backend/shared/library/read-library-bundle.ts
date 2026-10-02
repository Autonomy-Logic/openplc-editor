/**
 * Read the library files out of a ZIP the user picked.
 *
 * A library ships as several files more often than not — a vendor set, or one
 * library built for several versions — and picking them one at a time is the
 * whole reason this exists. Both formats the manager installs are recognised:
 * a `.stlib` comes back as text, a CODESYS `.lib`/`.library` as bytes, since
 * that is what each one's preparer takes. Installing is the caller's job, so
 * this stays free of the filesystem and of strucpp.
 *
 * The ZIP is untrusted: it arrives from wherever the user got it. Nothing here
 * writes to disk, so a traversing entry path cannot escape anything, but a
 * bomb still costs memory — declared sizes are checked before a single entry
 * is decompressed.
 */

import JSZip from 'jszip'

export class LibraryBundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryBundleError'
  }
}

export interface BundleLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  maxCompressionRatio: number
}

/**
 * Smaller than the project-snapshot limits: an archive of ST source and
 * compiled chunks is measured in megabytes, and a zip of them in tens.
 */
export const BUNDLE_LIMITS: BundleLimits = {
  maxEntries: 2_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  /** JSON of source text compresses well, but not this well. */
  maxCompressionRatio: 1_000,
} as const

/** Extensions the manager can install, and which preparer each one goes to. */
const LIBRARY_EXTENSIONS: ReadonlyArray<{ suffix: string; kind: 'stlib' | 'codesys' }> = [
  { suffix: '.stlib', kind: 'stlib' },
  { suffix: '.library', kind: 'codesys' },
  { suffix: '.lib', kind: 'codesys' },
]

/**
 * One library file found in the bundle. `path` is the entry path inside the
 * ZIP so a failure names something the user can find.
 */
export type BundledLibraryFile =
  | { path: string; kind: 'stlib'; text: string }
  | {
      path: string
      kind: 'codesys'
      bytes: Uint8Array
      /** Basename only: the CODESYS preparer derives the library identifier
       *  from it, and a folder path would end up in the name. */
      filename: string
    }

/**
 * True for entries a ZIP carries that the user never put there.
 *
 * macOS writes a `__MACOSX/` tree of `._name` resource forks beside the real
 * files. They carry the same extensions and are not libraries, so without this
 * every Mac-authored bundle reports half its entries as corrupt.
 */
function isMetadataEntry(path: string): boolean {
  const segments = path.split('/')
  return segments.some((segment) => segment === '__MACOSX') || segments[segments.length - 1].startsWith('._')
}

/** The kind this entry installs as, or null when it is not a library file. */
function libraryKind(path: string): 'stlib' | 'codesys' | null {
  const lower = path.toLowerCase()
  return LIBRARY_EXTENSIONS.find((entry) => lower.endsWith(entry.suffix))?.kind ?? null
}

/**
 * Every library file in the bundle, in path order so two runs install the same
 * way.
 *
 * Throws when the ZIP will not open or holds no library at all — both are the
 * user picking the wrong file, which is worth saying plainly rather than
 * reporting as an install of nothing.
 */
export async function readLibraryBundle(
  bytes: Uint8Array,
  limits: BundleLimits = BUNDLE_LIMITS,
): Promise<BundledLibraryFile[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (error) {
    throw new LibraryBundleError(
      `Not a readable ZIP archive: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  if (entries.length > limits.maxEntries) {
    throw new LibraryBundleError(`ZIP has too many files (${entries.length}, limit ${limits.maxEntries})`)
  }

  const wanted = entries
    .filter((entry) => {
      const path = entry.name.replace(/\\/g, '/')
      return libraryKind(path) !== null && !isMetadataEntry(path)
    })
    // Codepoint order, not `localeCompare`: collation varies with the host's
    // ICU data, and the point of sorting at all is that two machines install
    // the same bundle in the same order.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  if (wanted.length === 0) {
    throw new LibraryBundleError('ZIP contains no .stlib, .lib or .library files')
  }

  // Declared sizes first: decompressing is what a bomb costs, so the refusal
  // has to come before any of it.
  let declaredTotal = 0
  for (const entry of wanted) {
    const meta = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data
    const uncompressed = meta?.uncompressedSize ?? 0
    const compressed = meta?.compressedSize ?? 0

    if (uncompressed > limits.maxEntryBytes) {
      throw new LibraryBundleError(`ZIP entry is too large: ${entry.name}`)
    }
    if (compressed > 0 && uncompressed / compressed > limits.maxCompressionRatio) {
      throw new LibraryBundleError(`ZIP entry has a suspicious compression ratio: ${entry.name}`)
    }
    declaredTotal += uncompressed
  }
  if (declaredTotal > limits.maxTotalBytes) {
    throw new LibraryBundleError(
      `ZIP is too large uncompressed (${declaredTotal} bytes, limit ${limits.maxTotalBytes})`,
    )
  }

  const files: BundledLibraryFile[] = []
  let readTotal = 0
  for (const entry of wanted) {
    const path = entry.name.replace(/\\/g, '/')
    if (libraryKind(path) === 'stlib') {
      const text = await entry.async('string')
      readTotal += text.length
      files.push({ path, kind: 'stlib', text })
    } else {
      // CODESYS libraries are binary, so they cannot go through `string` --
      // that would mangle them before the importer ever saw them.
      const bytes = await entry.async('uint8array')
      readTotal += bytes.byteLength
      files.push({ path, kind: 'codesys', bytes, filename: path.split('/').pop() ?? path })
    }
    // The backstop for an entry whose declared sizes were absent or lied.
    if (readTotal > limits.maxTotalBytes) {
      throw new LibraryBundleError(`ZIP is too large uncompressed (limit ${limits.maxTotalBytes} bytes)`)
    }
  }
  return files
}
