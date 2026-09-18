/**
 * Compile-time alias resolution for a WHOLE project.
 *
 * A variable's `location` holds EITHER an alias name OR a literal `%addr`
 * (the single-field model — see `registry/resolve.ts`). The compiler and the
 * runtime never see aliases, so the editor hands the compiler a snapshot in
 * which every `location` has been resolved to a concrete address.
 *
 * This lives here, next to the registry it depends on, rather than in the
 * Zustand store, because the snapshot is needed by every caller that compiles
 * a project — the desktop GUI, openplc-web, and the headless CLI, which has no
 * store at all. Keeping it as a pure function is what stops the CLI from
 * growing a second, silently diverging copy of the resolution rules: a project
 * compiled from the terminal must resolve identically to the same project
 * compiled from the GUI, or automated tests are no longer testing the editor.
 *
 * Byte-identical with openplc-web.
 */

import type { PLCProjectData, PLCVariable } from '../../ports/types'
import { resolveLocation } from './registry/resolve'

/**
 * Return a COPY of `data` with every bindable variable's `location` resolved:
 * an alias name → its current IEC address, a literal `%addr` → verbatim, an
 * orphaned alias → `''` (the variable becomes unlocated and the emitters drop
 * the `AT %…`).
 *
 * The input is never mutated — callers hold the alias-name form for display
 * and only the returned snapshot is resolved.
 *
 * The two collections walked here are POU interface variables and the resource
 * global variables. That is the complete alias-binding surface, and it matches
 * `projectActions.renameAlias`, which cascades over exactly the same two.
 * `globalVariableLists` (CODESYS-style GVLs) are deliberately NOT included:
 * they sit outside the alias system on both the rename and the resolve side,
 * and adding them to one without the other would let a GVL variable resolve to
 * an address that a later rename never updates.
 */
export function resolveProjectAliases(data: PLCProjectData, aliasIndex: ReadonlyMap<string, string>): PLCProjectData {
  const resolved = structuredClone(data)

  const resolveAll = (variables: PLCVariable[] | undefined): void => {
    if (!variables) return
    for (const variable of variables) variable.location = resolveLocation(variable.location, aliasIndex)
  }

  for (const pou of resolved.pous) resolveAll(pou.interface?.variables)
  resolveAll(resolved.configurations?.resource?.globalVariables)

  return resolved
}
