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

/** One declaration of an output address: which POU, and what it is called. */
export interface OutputWriter {
  /** The POU, or `'Global Variables'` for a configuration global. */
  scope: string
  name: string
}

/** `'%QX0.0'` -> every declaration of exactly that address.
 *
 * SCOPE AND NAME, not the name alone. The whole point of the warning is that
 * the two declarations are usually in DIFFERENT POUs, where the same name is
 * entirely ordinary -- `run`, `motor_on`, `out`. Keyed by name only, a cell
 * excluding itself removed the other writer too and the tooltip rendered with
 * an empty list while the glyph still showed. The scope is also the thing the
 * user needs in order to go and fix it. */
export type DuplicateOutputMap = ReadonlyMap<string, readonly OutputWriter[]>

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

  const map = new Map<string, OutputWriter[]>()
  const collect = (scope: string, variables: PLCVariable[] | undefined): void => {
    for (const variable of variables ?? []) {
      const location = variable.location ?? ''
      if (!isOutputLocation(location)) continue
      const writers = map.get(location)
      if (writers) writers.push({ scope, name: variable.name })
      else map.set(location, [{ scope, name: variable.name }])
    }
  }
  for (const pou of pous) collect(pou.name, pou.interface?.variables)
  collect('Global Variables', globals)

  cache = { pous, globals, map }
  return map
}
