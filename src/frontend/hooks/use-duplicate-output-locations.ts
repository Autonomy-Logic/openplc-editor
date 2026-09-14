/**
 * Literal output addresses declared more than once in the project
 * (DOPE-615, B6).
 *
 * IEC located addresses are GLOBAL. The variables table's own duplicate check
 * reads one variable list at a time, so two POUs can each declare `AT %QX0.0`
 * and both pass; the compiler refuses it (`computeIoImage`), but only once the
 * user has finished and pressed build.
 *
 * This is the same fact answered while editing. It is the literal-against-
 * literal counterpart of the alias scan `useProjectAliasBindings` already
 * does, and it is project-wide for the same reason that one is.
 *
 * OUTPUTS ONLY, matching the compile-time rule: two POUs reading one input is
 * ordinary, and sharing a memory address is what memory is for. An output is
 * the one direction where two writers contradict each other and the last write
 * in the scan wins.
 *
 * Exact addresses only. A located array overlapping another one is a real
 * clash and the compiler reports it, but expanding every declaration into its
 * slots on each keystroke would cost far more than the warning is worth here.
 */

import { useOpenPLCStore } from '@root/frontend/store'
import type { PLCVariable } from '@root/middleware/shared/ports/types'
import { isLiteralLocation } from '@root/middleware/shared/utils/iec-address/registry'

/** `'%QX0.0'` -> the names of every variable declaring exactly that address. */
export type DuplicateOutputMap = ReadonlyMap<string, readonly string[]>

interface Cache {
  pous: unknown
  globals: unknown
  map: DuplicateOutputMap
}

let cache: Cache | null = null

/** `%Q…` — the only direction where a second declaration is a contradiction. */
function isOutputLocation(location: string): boolean {
  return isLiteralLocation(location) && location.charAt(1) === 'Q'
}

export function useDuplicateOutputLocations(): DuplicateOutputMap {
  const pous = useOpenPLCStore((s) => s.project.data.pous)
  const globals = useOpenPLCStore((s) => s.project.data.configurations.resource.globalVariables)

  // Same single-entry cache as the alias scan next door: dozens of cells ask
  // for this in one render pass, and Zustand keeps identity stable when
  // nothing changed.
  if (cache && cache.pous === pous && cache.globals === globals) return cache.map

  const map = new Map<string, string[]>()
  const collect = (variables: PLCVariable[] | undefined): void => {
    for (const variable of variables ?? []) {
      const location = variable.location ?? ''
      if (!isOutputLocation(location)) continue
      const names = map.get(location)
      if (names) names.push(variable.name)
      else map.set(location, [variable.name])
    }
  }
  for (const pou of pous) collect(pou.interface?.variables)
  collect(globals)

  cache = { pous, globals, map }
  return map
}
