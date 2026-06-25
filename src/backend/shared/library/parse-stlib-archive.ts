/**
 * Browser-pure wrapper around strucpp's `.stlib` archive parser.
 *
 * Text-in / result-out — `.stlib` archives are UTF-8 JSON, so the
 * cross-platform interchange shape is a string the caller has
 * already read (off disk in Electron, off an HTTP body in web).
 * Strucpp's `loadStlibFromString` validates the archive shape
 * beyond what raw `JSON.parse` does; consumers that need the
 * stricter check should route through here.
 */

import { loadStrucpp } from './strucpp-runtime'

export function parseStlibArchive(text: string): unknown {
  const strucpp = loadStrucpp()
  return strucpp.loadStlibFromString(text)
}
