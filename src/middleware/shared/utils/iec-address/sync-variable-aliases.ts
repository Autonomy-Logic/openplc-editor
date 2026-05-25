/**
 * Sync variables against the current alias registry.
 *
 * Three outcomes per variable:
 *   - **adopted**:   variable had no alias bound but its `location`
 *                    matches an aliased address in the registry.
 *                    Sets `alias` to the registry entry's name.
 *                    Self-upgrade path for older projects on load.
 *   - **refreshed**: variable already has an alias that the registry
 *                    still knows, but the alias now points to a
 *                    different address than the variable's
 *                    `location`. Rewrites `location` to follow the
 *                    alias — this is what keeps variables coherent
 *                    when a producer reorders, shifts, or
 *                    reallocates its addresses.
 *   - **orphaned**:  variable has an alias the registry no longer
 *                    knows about (its producer was removed, or
 *                    target-switched away). Keeps `location` and
 *                    `alias` so the user can decide; reported so
 *                    the UI can flag the cell.
 *
 * Pure function: same inputs always produce the same outputs.
 * Safe to call from any context — store actions, the pre-compile
 * hook, etc. The caller is responsible for applying the returned
 * `variables` array back to the project state.
 */

import type { AliasRegistry } from './alias-registry'

/** Minimal PLCVariable shape the sync function reads. Lives in this
 *  module so backend/shared callers don't need to import from
 *  `backend/shared/types/PLC/open-plc.ts` (which carries Zod
 *  baggage). Compatible with `PLCVariable` via structural typing —
 *  the function preserves every field a concrete subtype carries. */
export interface SyncableVariable {
  name: string
  location: string
  alias?: string
}

export interface SyncReport {
  adopted: Array<{ varName: string; alias: string; address: string }>
  refreshed: Array<{ varName: string; alias: string; oldAddress: string; newAddress: string }>
  orphaned: Array<{ varName: string; alias: string; lastKnownAddress: string }>
}

export interface SyncResult<V extends SyncableVariable> {
  variables: V[]
  report: SyncReport
}

export function syncVariableAliases<V extends SyncableVariable>(
  variables: readonly V[],
  registry: AliasRegistry,
): SyncResult<V> {
  const report: SyncReport = { adopted: [], refreshed: [], orphaned: [] }
  const next: V[] = []

  for (const variable of variables) {
    if (variable.alias) {
      const entry = registry.byAlias.get(variable.alias)
      if (!entry) {
        report.orphaned.push({
          varName: variable.name,
          alias: variable.alias,
          lastKnownAddress: variable.location,
        })
        next.push(variable)
        continue
      }
      if (entry.address !== variable.location) {
        report.refreshed.push({
          varName: variable.name,
          alias: variable.alias,
          oldAddress: variable.location,
          newAddress: entry.address,
        })
        next.push({ ...variable, location: entry.address })
        continue
      }
      // Alias still bound to the same address — no change.
      next.push(variable)
      continue
    }

    // No alias bound: try to auto-adopt by the variable's current
    // `location`. This is the self-upgrade path — applied on project
    // load so older projects pick up the aliases their producers
    // already declare without any user action.
    const aliasEntry = registry.byAddress.get(variable.location)
    if (aliasEntry) {
      report.adopted.push({
        varName: variable.name,
        alias: aliasEntry.alias,
        address: aliasEntry.address,
      })
      next.push({ ...variable, alias: aliasEntry.alias })
      continue
    }

    next.push(variable)
  }

  return { variables: next, report }
}

/** True when the sync produced any change. Callers that don't care
 *  about diagnostics can use this to skip a no-op state write. */
export function syncMadeChanges(report: SyncReport): boolean {
  return report.adopted.length > 0 || report.refreshed.length > 0
}
