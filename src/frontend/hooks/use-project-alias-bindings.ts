/**
 * Selector hook returning every project variable that is bound to an alias
 * which currently resolves to a concrete address, as
 * `{ variableName, aliasName, address }` rows.
 *
 * IEC located addresses are GLOBAL, so a manually located variable can
 * collide with an alias-bound variable in ANY POU or the global scope. The
 * variable cell uses this list to flag a literal `%addr` that lands on an
 * address an alias is already assigned to (see the manual-conflict warning in
 * `variables-table` / `global-variables-table` editable cells).
 *
 * Backed by a module-level single-entry cache — every location cell calls
 * this, and the scan is O(project variables); the cache keeps a table full of
 * cells from re-scanning the whole project on each row.
 */

import { useOpenPLCStore } from '@root/frontend/store'
import type { PLCPou, PLCVariable } from '@root/middleware/shared/ports/types'
import type { AliasRegistry } from '@root/middleware/shared/utils/iec-address'
import { isLiteralLocation } from '@root/middleware/shared/utils/iec-address/registry'

import { useAliasRegistry } from './use-alias-registry'

export interface AliasBinding {
  /** Name of the variable bound to the alias. */
  variableName: string
  /** The alias the variable's `location` holds. */
  aliasName: string
  /** The address the alias currently resolves to. */
  address: string
}

interface BindingsCache {
  pous: PLCPou[]
  globals: PLCVariable[] | undefined
  registry: AliasRegistry
  bindings: AliasBinding[]
}

let cache: BindingsCache | null = null

export function useProjectAliasBindings(): AliasBinding[] {
  const pous = useOpenPLCStore((s) => s.project.data.pous)
  const globals = useOpenPLCStore((s) => s.project.data.configurations.resource.globalVariables)
  const registry = useAliasRegistry()

  if (cache && cache.pous === pous && cache.globals === globals && cache.registry === registry) {
    return cache.bindings
  }

  const bindings: AliasBinding[] = []
  const collect = (variables: PLCVariable[] | undefined): void => {
    for (const variable of variables ?? []) {
      // Only alias bindings resolve to an address here; literal `%…` locations
      // and empty locations are not aliases.
      if (!variable.location || isLiteralLocation(variable.location)) continue
      const address = registry.byAlias.get(variable.location)?.address
      if (address) bindings.push({ variableName: variable.name, aliasName: variable.location, address })
    }
  }
  for (const pou of pous) collect(pou.interface?.variables)
  collect(globals)

  cache = { pous, globals, registry, bindings }
  return bindings
}
