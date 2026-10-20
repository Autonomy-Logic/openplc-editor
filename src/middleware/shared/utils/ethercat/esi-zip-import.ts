/**
 * ESI ZIP import.
 *
 * The repository is permissive: every XML file dropped on it is stored unchanged, and
 * validity is checked at the moment of use. A ZIP's contents are routed into the
 * repository per file; files that are not recognisable ESI XML are dropped and the
 * import report names them.
 *
 * The utility is transport-agnostic: it accepts a ZIP buffer and returns the files to
 * import plus a dropped-files report. The caller writes to the repository.
 */

import JSZip from 'jszip'

// JSZip implements `ZipObject#internalStream` (documented API) but its typings omit it.
declare module 'jszip' {
  interface JSZipObject {
    internalStream(type: 'uint8array'): JSZipStreamHelper<Uint8Array>
  }
}

export interface ESIImportFile {
  /** File name as it appears inside the ZIP (basename, no path). */
  filename: string
  /** Decoded XML contents. */
  xml: string
}

export interface ESIImportReport {
  /** Files that look like ESI XML and are candidates for the repository. */
  imported: ESIImportFile[]
  /** Entries left out, each with the reason. */
  dropped: string[]
}

/** Largest single XML entry accepted, uncompressed. */
export const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024
/** Largest total uncompressed size read from one ZIP. */
export const MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024
/** Most entries one ZIP may hold. */
export const MAX_ZIP_ENTRIES = 2000

/**
 * Minimal ESI shape check; the parser validates fully at use time. Accepts both ETG
 * roots: `EtherCATInfo` (devices) and `EtherCATModule` (module-only libraries).
 */
export function looksLikeESI(xml: string): boolean {
  if (xml.length === 0 || xml.length > MAX_ZIP_ENTRY_BYTES) return false
  return xml.includes('<EtherCATInfo') || xml.includes('<EtherCATModule')
}

/**
 * Decode XML bytes using the BOM when present, otherwise the `encoding` declared in the
 * XML prolog, otherwise UTF-8. Unknown encodings fall back to UTF-8.
 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 256))
  const declared = /<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head)?.[1]
  if (declared !== undefined) {
    try {
      return new TextDecoder(declared).decode(bytes)
    } catch {
      // Label not supported by this runtime: fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

type ReadOutcome = { kind: 'ok'; bytes: Uint8Array } | { kind: 'too-large' } | { kind: 'error' }

/** Read one entry, stopping as soon as it passes `limit` bytes so a bomb is never fully inflated. */
function readEntryBounded(entry: JSZip.JSZipObject, limit: number): Promise<ReadOutcome> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let settled = false
    const stream = entry.internalStream('uint8array')
    stream
      .on('data', (chunk: Uint8Array) => {
        if (settled) return
        size += chunk.length
        if (size > limit) {
          settled = true
          stream.pause()
          resolve({ kind: 'too-large' })
          return
        }
        chunks.push(chunk)
      })
      .on('error', () => {
        if (settled) return
        settled = true
        resolve({ kind: 'error' })
      })
      .on('end', () => {
        if (settled) return
        settled = true
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const c of chunks) {
          bytes.set(c, offset)
          offset += c.length
        }
        resolve({ kind: 'ok', bytes })
      })
      .resume()
  })
}

/**
 * Walk a ZIP buffer at any folder depth, pick up every `.xml` entry, decode and classify.
 * Directory entries, hidden files and `__MACOSX/` metadata are skipped silently.
 */
export async function importESIZip(buffer: Buffer | Uint8Array | ArrayBuffer): Promise<ESIImportReport> {
  const zip = await JSZip.loadAsync(buffer)
  const imported: ESIImportFile[] = []
  const dropped: string[] = []
  const seen = new Set<string>()
  let total = 0

  const entries = Object.values(zip.files).filter((e) => !e.dir)
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`ZIP holds ${entries.length} entries; the limit is ${MAX_ZIP_ENTRIES}.`)
  }

  for (const entry of entries) {
    const path = entry.name
    const base = path.split('/').pop() ?? path
    if (path.includes('__MACOSX/') || base.startsWith('.')) continue
    if (!base.toLowerCase().endsWith('.xml')) {
      dropped.push(`${base} (not an XML file)`)
      continue
    }
    const key = base.toLowerCase()
    if (seen.has(key)) {
      dropped.push(`${path} (duplicate file name)`)
      continue
    }
    const remaining = MAX_ZIP_TOTAL_BYTES - total
    const outcome = await readEntryBounded(entry, Math.min(MAX_ZIP_ENTRY_BYTES, remaining))
    if (outcome.kind === 'too-large') {
      dropped.push(
        remaining < MAX_ZIP_ENTRY_BYTES ? `${base} (ZIP total size limit reached)` : `${base} (larger than 32 MiB)`,
      )
      continue
    }
    if (outcome.kind === 'error') {
      dropped.push(`${base} (could not be read)`)
      continue
    }
    total += outcome.bytes.length
    const xml = decodeXmlBytes(outcome.bytes)
    if (looksLikeESI(xml)) {
      seen.add(key)
      imported.push({ filename: base, xml })
    } else {
      dropped.push(`${base} (not an ESI file)`)
    }
  }

  return { imported, dropped }
}
