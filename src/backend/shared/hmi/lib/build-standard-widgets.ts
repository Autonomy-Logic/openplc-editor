/**
 * Compiles StandardWidgets into a STruC++ library archive, once per session for a given library source and compiler
 * version. The archive is loaded back through the archive parser, as every consumer loads it.
 */
import type { StlibArchive, StlibCompileResult } from 'strucpp'

import { loadStrucpp } from '../../library/strucpp-runtime'
import { ContentHash } from '../../wasm-toolchain/content-hash'
import { STANDARD_WIDGETS_LIBRARY, STANDARD_WIDGETS_SOURCES } from './standard-widgets'

export type StandardWidgetsError = StlibCompileResult['errors'][number]

export type StandardWidgetsBuild =
  | { ok: true; key: string; archive: StlibArchive; archiveJson: string }
  | { ok: false; key: string; errors: StandardWidgetsError[] }

let cached: StandardWidgetsBuild | null = null

/** Cache key of the library: its sources, identity and the compiler version. */
export function standardWidgetsKey(compilerVersion: string): string {
  const hash = new ContentHash().update(compilerVersion)
  const { name, version, namespace, headers } = STANDARD_WIDGETS_LIBRARY
  hash.update(name).update(version).update(namespace)
  for (const header of headers) hash.update(header)
  for (const { fileName, source } of STANDARD_WIDGETS_SOURCES) hash.update(fileName).update(source)
  return hash.digest()
}

/** The StandardWidgets archive, compiled on first use and reused while the key is unchanged. */
export function buildStandardWidgets(): StandardWidgetsBuild {
  const strucpp = loadStrucpp()
  const key = standardWidgetsKey(strucpp.getVersion())
  if (cached?.key === key) return cached
  const { name, version, namespace, headers } = STANDARD_WIDGETS_LIBRARY
  const result = strucpp.compileStlib(
    STANDARD_WIDGETS_SOURCES.map((s) => ({ fileName: s.fileName, source: s.source })),
    { name, version, namespace, headers: [...headers] },
  )
  if (result.errors.length > 0) {
    cached = { ok: false, key, errors: result.errors }
  } else {
    const archiveJson = JSON.stringify(result.archive)
    cached = { ok: true, key, archive: strucpp.loadStlibFromString(archiveJson, name), archiveJson }
  }
  return cached
}

/** Drops the cached build; for tests. */
export function clearStandardWidgetsCache(): void {
  cached = null
}
