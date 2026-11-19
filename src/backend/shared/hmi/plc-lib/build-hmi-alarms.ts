/**
 * Compiles the HmiAlarms PLC library into a STruC++ archive, once per session for a given source and compiler version,
 * and adds it to the archives a PLC or HMI build compiles against.
 */
import type { StlibArchive, StlibCompileResult } from 'strucpp'

import { loadStrucpp, type StrucppRuntime } from '../../library/strucpp-runtime'
import { ContentHash } from '../../wasm-toolchain/content-hash'
import { HMI_ALARMS_DISPLAY_NAME, HMI_ALARMS_LIBRARY, HMI_ALARMS_ST } from './hmi-alarms'

export type HmiAlarmsBuild =
  | { ok: true; key: string; archive: StlibArchive; archiveJson: string }
  | { ok: false; key: string; errors: StlibCompileResult['errors'] }

/** What the build needs of STruC++; a platform whose module loader cannot reach it passes its own import. */
export type HmiAlarmsCompiler = Pick<StrucppRuntime, 'compileStlib' | 'loadStlibFromString' | 'getVersion'>

let cached: HmiAlarmsBuild | null = null

/** Cache key of the library: its source, identity and the compiler version. */
export function hmiAlarmsKey(compilerVersion: string): string {
  const { name, version, namespace } = HMI_ALARMS_LIBRARY
  return new ContentHash()
    .update(compilerVersion)
    .update(name)
    .update(version)
    .update(namespace)
    .update(HMI_ALARMS_ST)
    .digest()
}

/** The HmiAlarms archive, compiled on first use and reused while the key is unchanged. */
export function buildHmiAlarms(strucpp: HmiAlarmsCompiler = loadStrucpp()): HmiAlarmsBuild {
  const key = hmiAlarmsKey(strucpp.getVersion())
  if (cached?.key === key) return cached
  const { name, version, namespace, headers } = HMI_ALARMS_LIBRARY
  const result = strucpp.compileStlib([{ fileName: 'hmi_alarms.st', source: HMI_ALARMS_ST }], {
    name,
    version,
    namespace,
    headers: [...headers],
  })
  if (result.errors.length > 0) {
    cached = { ok: false, key, errors: result.errors }
  } else {
    const named = { ...result.archive, manifest: { ...result.archive.manifest, displayName: HMI_ALARMS_DISPLAY_NAME } }
    const archiveJson = JSON.stringify(named)
    cached = { ok: true, key, archive: strucpp.loadStlibFromString(archiveJson, name), archiveJson }
  }
  return cached
}

const isNamed = (archive: unknown, name: string): boolean =>
  typeof archive === 'object' &&
  archive !== null &&
  'manifest' in archive &&
  typeof archive.manifest === 'object' &&
  archive.manifest !== null &&
  'name' in archive.manifest &&
  archive.manifest.name === name

/**
 * `archives` with the HmiAlarms archive added when it is not among them; unchanged when the library does not build or
 * the compiler cannot be reached.
 */
export function withHmiAlarmsArchive<T>(archives: readonly T[], strucpp?: HmiAlarmsCompiler): Array<T | StlibArchive> {
  if (archives.some((a) => isNamed(a, HMI_ALARMS_LIBRARY.name))) return [...archives]
  let built: HmiAlarmsBuild
  try {
    built = buildHmiAlarms(strucpp)
  } catch {
    return [...archives]
  }
  return built.ok ? [...archives, built.archive] : [...archives]
}

/** Drops the cached build; for tests. */
export function clearHmiAlarmsCache(): void {
  cached = null
}
