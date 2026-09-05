/**
 * Author the `retain.conf` a runtime-v4 upload carries.
 *
 * Persistent storage is a PROJECT property. The user configures it on the
 * Persistent Storage screen with no device attached, it is saved with the
 * project, and it reaches the device inside the program upload — the same route
 * VPP plugin configuration takes (`vpp_plugins.conf` + `conf/<plugin>.json`).
 * The runtime installs what arrives and removes its copy when nothing does.
 *
 * WHY `null` IS A REAL ANSWER
 * --------------------------
 * Returning `null` means "emit no file", and the runtime then DELETES any
 * `retain.conf` the device still has. That absent case is load-bearing rather
 * than tidiness: it is how a target whose VPP owns retention switches the
 * runtime's built-in file store off. Such a VPP declares
 * `hidesNativeScreens: ['persistent-storage']`, the editor emits nothing, the
 * built-in store finds no config and declines the role, and the vendor's driver
 * is left as the only store on the box. Two live stores writing the same
 * retained values — a configuration nobody would choose and nobody would
 * notice, because both appear to work — becomes unrepresentable at upload time.
 *
 * The body is byte-compatible with the flat `key=value` list the runtime core
 * parses in C++ during startup (`plc_retain_file_store.cpp`), before anything
 * else is available. A dependency-free parser for three keys is a better trade
 * there than pulling a JSON library into the PLC application.
 *
 * Pure function: no fs I/O, no platform coupling. The caller writes the returned
 * string into the upload folder (editor: beside `vpp_plugins.conf`; web: into
 * the in-memory file set), or writes nothing when it is `null`.
 */

import type { PersistentStorageSettings } from '../../../../middleware/shared/ports/types'
import { RETAIN_MAX_FLUSH_SECONDS, RETAIN_MIN_FLUSH_SECONDS } from '../../../../middleware/shared/ports/types'

export interface GenerateRetainConfInput {
  /** The project's settings, or `undefined` for a project that never opened the
   *  screen. Both mean the same thing here. */
  settings?: PersistentStorageSettings | undefined
  /** True when the selected target's VPP declares that it handles retention
   *  itself (`hidesNativeScreens` includes `'persistent-storage'`). Such a
   *  target emits no file whatever the project says, so the vendor's driver is
   *  the only store — see the note above. */
  targetHidesPersistentStorage?: boolean
}

/**
 * Clamp rather than reject.
 *
 * The screen already constrains the input and the runtime refuses an
 * out-of-range period at install, so a value outside the bounds here means a
 * hand-edited project file. Clamping keeps the upload working with the closest
 * setting the runtime would accept; refusing would fail a build over a field
 * whose worst case is "commits more or less often than asked".
 */
function clampFlushSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return RETAIN_MIN_FLUSH_SECONDS
  const whole = Math.round(seconds)
  if (whole < RETAIN_MIN_FLUSH_SECONDS) return RETAIN_MIN_FLUSH_SECONDS
  if (whole > RETAIN_MAX_FLUSH_SECONDS) return RETAIN_MAX_FLUSH_SECONDS
  return whole
}

/**
 * The `retain.conf` body for this project, or `null` to emit no file at all.
 *
 * `null` when the target handles retention itself, when the project has no
 * settings, or when the project has settings with storage turned off — all
 * three mean "the runtime's built-in store must not run for this program", and
 * saying that by the file's absence is what makes the runtime remove a stale
 * copy left by a previous project.
 */
export function generateRetainConf({
  settings,
  targetHidesPersistentStorage = false,
}: GenerateRetainConfInput): string | null {
  if (targetHidesPersistentStorage) return null
  if (!settings || !settings.enabled) return null

  const path = settings.path.trim()
  const flushSeconds = clampFlushSeconds(settings.flushSeconds)

  // An empty `path` is emitted as an empty value on purpose: the runtime reads
  // it as "use your default" and fills in its own location. The editor does not
  // know the device's filesystem layout and should not guess at one.
  return (
    '# Persistent storage for RETAIN variables.\n' +
    "# Emitted by the OpenPLC editor from the project's Persistent Storage\n" +
    '# settings and installed by the program upload; read by the PLC\n' +
    '# application at program load. Edits here are overwritten on the next\n' +
    '# upload — change the setting in the project instead.\n' +
    'enabled=1\n' +
    `path=${path}\n` +
    `flush_seconds=${flushSeconds}\n`
  )
}
