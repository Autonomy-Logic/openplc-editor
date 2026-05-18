/**
 * Browser-pure wrapper around strucpp's CODESYS V2.3 / V3 importer.
 *
 * Bytes-in / result-out — no filesystem, no path coupling, so the
 * same module compiles for the Electron main process AND for the
 * web backend's browser-bundled service.  Whichever caller has the
 * archive bytes in hand (Electron reads them off disk; web reads
 * them off an HTTP upload body) passes them straight through.
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

export async function importCodesysLibrary(bytes: Uint8Array): Promise<CodesysImportResult> {
  const strucpp = loadStrucpp()
  return strucpp.importCodesysLibraryFromBytes(bytes)
}
