/**
 * What a spec may not ask of a Library Project.
 *
 * A library is not deployed to a board, so its save writes no `devices/`
 * folder: `iterateProjectFiles` skips the device configuration, the pin
 * mapping, the servers and the remote devices for `plc-library`, and
 * `library.json` is the only manifest. A spec that set a board on one used to
 * apply to the store, report "saved", and lose the board on exit — the store is
 * discarded and nothing on disk changed.
 *
 * The target a library builds for is a core, not a board, and it lives in
 * `library.json` (`"build": { "verify": "arduino", "core": "esp32:esp32" }`) —
 * which is what library verification reads. So these are refused rather than
 * translated: guessing a core from a board name would write a target nobody
 * asked for into the manifest.
 *
 * Empty `servers` / `remoteDevices` lists pass — they ask for nothing, and
 * `describe` of any project carries them.
 */

import type { ApplySpec } from './schema'

const LIBRARY_TARGET_HINT =
  'A library targets a core, not a board — set it as "build": { "verify": "arduino", "core": "<vendor>:<arch>" } in library.json.'

export function libraryScopeErrors(spec: ApplySpec): string[] {
  const errors: string[] = []
  if (spec.device) {
    const fields = Object.keys(spec.device).join(', ')
    errors.push(
      `device (${fields}): a library project has no device, and its save writes no devices/ folder, so this would be dropped. ${LIBRARY_TARGET_HINT}`,
    )
  }
  if ((spec.servers ?? []).length > 0) {
    errors.push('servers: a library project has no protocol servers — its save writes no devices/ folder.')
  }
  if ((spec.remoteDevices ?? []).length > 0) {
    errors.push('remoteDevices: a library project has no remote devices — its save writes no devices/ folder.')
  }
  return errors
}
