/**
 * Editor metadata that a declaration text cannot carry.
 *
 * `debug` (the Debug tick) and `id` are the editor's own bookkeeping; IEC text
 * has nowhere to put them, so every re-parse of a POU's declarations comes back
 * with `debug: false` and no id. Anything that replaces a POU's variables from
 * its text therefore has to carry them across, or ticking two variables and
 * then touching the text silently empties the debugger (DOPE-650).
 *
 * Matched by name, case-insensitively, because that is the only identity the
 * two sides share — and because IEC identifiers are case-insensitive, so `Motor`
 * and `motor` are the same variable declared twice, not two variables.
 */

import type { PLCVariable } from '../../../middleware/shared/ports/types'

export function carryEditorMetadata(previous: PLCVariable[], parsed: PLCVariable[]): PLCVariable[] {
  const carried = new Map(previous.map((variable) => [variable.name.toLowerCase(), variable]))
  return parsed.map((variable) => {
    const before = carried.get(variable.name.toLowerCase())
    if (!before) return variable
    return {
      ...variable,
      debug: before.debug ?? false,
      ...(before.id !== undefined ? { id: before.id } : {}),
    }
  })
}
