/**
 * Alias registry — derived index over the address pool that lets the
 * editor answer two questions:
 *
 *   - "Given an alias name, which address does it currently point to?"
 *   - "Given an address, does it have an alias the user gave it?"
 *
 * Built from the pool, so it inherits the pool's target-scoping: only
 * aliases attached to active producers appear. No new storage, no new
 * mutations — pure function, rebuild on demand.
 *
 * Uniqueness rule: alias names are intended to be unique system-wide
 * (across all producers). When the same alias name is declared by two
 * sources, first-wins (matching pool encounter order) and the conflict
 * is recorded in `duplicateAliases`. The expected response is for the
 * caller to invoke the address-sync flow to reassign whichever
 * variable is now orphaned — see Phase 4 of the alias-source-of-truth
 * work for the sync engine.
 */

import type { AddressPool, SourceRef } from './address-pool'

export interface AliasEntry {
  alias: string
  address: string
  source: SourceRef
}

export interface AliasRegistry {
  /** Alias name -> the first claim that declared it. */
  byAlias: ReadonlyMap<string, AliasEntry>
  /** Address -> the alias attached to its claim, when present. Every
   *  address that has an alias appears here; addresses without an
   *  alias are simply absent. */
  byAddress: ReadonlyMap<string, AliasEntry>
  /** Alias names declared by more than one producer. First entry
   *  in `byAlias` wins; the rest were silently dropped from the
   *  primary index. Reported here so the caller can resync. */
  duplicateAliases: readonly string[]
}

export function buildAliasRegistry(pool: AddressPool): AliasRegistry {
  const byAlias = new Map<string, AliasEntry>()
  const byAddress = new Map<string, AliasEntry>()
  const duplicateAliases: string[] = []

  for (const claim of pool.byAddress.values()) {
    if (!claim.alias) continue
    const entry: AliasEntry = {
      alias: claim.alias,
      address: claim.address,
      source: claim.source,
    }
    // Pool guarantees per-address uniqueness, so this is safe.
    byAddress.set(claim.address, entry)

    if (byAlias.has(claim.alias)) {
      if (!duplicateAliases.includes(claim.alias)) {
        duplicateAliases.push(claim.alias)
      }
      continue
    }
    byAlias.set(claim.alias, entry)
  }

  return { byAlias, byAddress, duplicateAliases }
}

/** Look up the canonical address for a given alias. Returns undefined
 *  when the alias is no longer declared by any active producer (the
 *  variable that referenced it is now orphaned). */
export function resolveAlias(registry: AliasRegistry, alias: string): string | undefined {
  return registry.byAlias.get(alias)?.address
}

/** Look up the alias attached to a given address. Used by the
 *  variable cell's auto-adopt path: if a variable's raw `location`
 *  matches a current alias, the variable cell promotes the alias
 *  name onto its display. */
export function aliasForAddress(registry: AliasRegistry, address: string): string | undefined {
  return registry.byAddress.get(address)?.alias
}

/** True when the alias name is not currently in use by any producer.
 *  Used by the system-wide uniqueness validator (Phase 5) — newly
 *  typed alias names go through this check before being committed. */
export function isAliasNameAvailable(registry: AliasRegistry, alias: string, ignoring?: SourceRef): boolean {
  const entry = registry.byAlias.get(alias)
  if (!entry) return true
  if (!ignoring) return false
  return entry.source.kind === ignoring.kind && entry.source.ref === ignoring.ref
}
