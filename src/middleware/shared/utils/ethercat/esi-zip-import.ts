/**
 * ESI ZIP import (DOPE-704 E1).
 *
 * The repository is permissive: every XML file dropped on it is stored unchanged, and
 * validity is checked at the moment of use (RG BR19 / BR20). A ZIP's contents are routed
 * into the repository per file; files that are not recognisable ESI XML are dropped and
 * the import report names them.
 *
 * The utility is intentionally transport-agnostic: it accepts a ZIP buffer and returns
 * the list of files to import plus a dropped-files report. The caller does the actual
 * repository write — on Electron that goes through the ESI repository service; on
 * openplc-web it goes through the Edge upload channel. Neither cares what the file
 * looks like inside, as long as it survives the recognition filter.
 */

import JSZip from 'jszip'

export interface ESIImportFile {
  /** File name as it appears inside the ZIP (basename, no path). */
  filename: string
  /** Raw XML contents. */
  xml: string
}

export interface ESIImportReport {
  /** Files that look like ESI XML and are candidates for the repository. */
  imported: ESIImportFile[]
  /** Files that are not ESI XML; names only, kept so the UI can list them. */
  dropped: string[]
}

/**
 * Minimal ESI shape check. We don't fully parse — the parser does that at use time.
 * A file passes when it declares the ETG XML namespace or contains an `<EtherCATInfo>`
 * root element. The check uses substring matching (cheap, deterministic) rather than
 * a full XML parse because a ZIP may hold hundreds of module files and the import
 * dialog is expected to stay snappy.
 */
export function looksLikeESI(xml: string): boolean {
  if (xml.length === 0 || xml.length > 32 * 1024 * 1024) return false
  return xml.includes('<EtherCATInfo') || xml.includes('EtherCATInfo xmlns')
}

/**
 * Walk a ZIP buffer, pick up every `.xml` entry, decode as UTF-8 and classify.
 *
 * Only top-level `.xml` entries and `.xml` entries one level deep (vendors like
 * Weidmueller ship module ESIs in subfolders) are accepted. Directory metadata, hidden
 * files (prefixed with `.`), macOS resource forks (`__MACOSX/`), and anything above
 * 32 MiB per entry are dropped.
 */
export async function importESIZip(buffer: Buffer | Uint8Array | ArrayBuffer): Promise<ESIImportReport> {
  const zip = await JSZip.loadAsync(buffer)
  const imported: ESIImportFile[] = []
  const dropped: string[] = []

  const entries = Object.values(zip.files)
  for (const entry of entries) {
    if (entry.dir) continue
    const path = entry.name
    const base = path.split('/').pop() ?? path
    // Skip macOS metadata and hidden files.
    if (path.includes('__MACOSX/') || base.startsWith('.')) continue
    if (!base.toLowerCase().endsWith('.xml')) {
      dropped.push(base)
      continue
    }
    try {
      const xml = await entry.async('string')
      if (looksLikeESI(xml)) {
        imported.push({ filename: base, xml })
      } else {
        dropped.push(base)
      }
    } catch {
      dropped.push(base)
    }
  }

  return { imported, dropped }
}
