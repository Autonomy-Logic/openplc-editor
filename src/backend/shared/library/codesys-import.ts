/**
 * Thin wrapper around strucpp's CODESYS V2.3 / V3 library importer.
 *
 * Strucpp does the heavy lifting (parsing the `.lib` / `.library`
 * binary, extracting the ST sources, building global-constants
 * tables).  This shim keeps the call surface stable so editor
 * consumers don't bind to strucpp's exact signature, and so the
 * web editor can call into the same logic without re-implementing
 * the importer.
 *
 * NOTE: strucpp's importer takes a filesystem PATH today, not a
 * buffer.  That's a platform-coupled choice on strucpp's side —
 * for the web editor the backend service will need to materialise
 * the upload to a temp file before calling this.  Worth tracking
 * as a follow-up but out of scope here.
 */

import { loadStrucpp } from './strucpp-runtime'

export interface CodesysImportSource {
  fileName: string
  source: string
  category?: string
}

export interface CodesysImportResult {
  success: boolean
  sources?: CodesysImportSource[]
  globalConstants?: Record<string, number>
  errors?: string[]
}

export function importCodesysLibrary(filePath: string): CodesysImportResult {
  const strucpp = loadStrucpp()
  return strucpp.importCodesysLibrary(filePath)
}
