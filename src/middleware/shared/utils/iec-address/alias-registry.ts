/**
 * Alias registry — derived index over the address pool that lets the
 * editor answer: "Given an alias name, which address does it currently
 * point to?"
 *
 * Built from the pool, so it inherits the pool's target-scoping: only
 * aliases attached to active producers appear. No new storage, no new
 * mutations — pure function, rebuild on demand.
 *
 * Uniqueness rule: alias names are intended to be unique system-wide
 * (across all producers). When the same alias name is declared by two
 * sources, first-wins (matching pool encounter order) and the conflict
 * is recorded in `duplicateAliases`.
 */

import { isReadableAtOperand } from '../../../../frontend/utils/PLC/variable-declarations'
import type { AddressPool, SourceRef } from './address-pool'

export interface AliasEntry {
  alias: string
  address: string
  source: SourceRef
}

export interface AliasRegistry {
  /** Alias name -> the first claim that declared it. */
  byAlias: ReadonlyMap<string, AliasEntry>
  /** Alias names declared by more than one producer. First entry
   *  in `byAlias` wins; the rest were silently dropped from the
   *  primary index. Reported here so the caller can resync. */
  duplicateAliases: readonly string[]
}

export function buildAliasRegistry(pool: AddressPool): AliasRegistry {
  const byAlias = new Map<string, AliasEntry>()
  const duplicateAliases: string[] = []

  for (const claim of pool.byAddress.values()) {
    if (!claim.alias) continue
    const entry: AliasEntry = {
      alias: claim.alias,
      address: claim.address,
      source: claim.source,
    }

    if (byAlias.has(claim.alias)) {
      if (!duplicateAliases.includes(claim.alias)) {
        duplicateAliases.push(claim.alias)
      }
      continue
    }
    byAlias.set(claim.alias, entry)
  }

  return { byAlias, duplicateAliases }
}

/** Look up the canonical address for a given alias. Returns undefined
 *  when the alias is no longer declared by any active producer (the
 *  variable that referenced it is now orphaned). */
export function resolveAlias(registry: AliasRegistry, alias: string): string | undefined {
  return registry.byAlias.get(alias)?.address
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

/** Outcome of `validateAliasEdit`.  When `ok` is false, `conflict`
 *  carries the in-registry entry that already owns the alias, so
 *  callers can render a precise error message (e.g.  "alias 'relay_1'
 *  is already used by slot 2 channel O3").
 */
export type AliasEditValidation = { ok: true } | { ok: false; conflict: AliasEntry } | { ok: false; reason: string }

/** True when the rejection is a name collision rather than a malformed name. */
export function isAliasConflict(validation: AliasEditValidation): validation is { ok: false; conflict: AliasEntry } {
  return validation.ok === false && 'conflict' in validation
}

/**
 * Why an alias cannot be written after `AT`, for the message. The verdict
 * itself comes from the parser; this only says it in English.
 */
export function aliasRejectionReason(alias: string): string {
  if (alias.trim() === '') return 'is empty'
  if (alias.trim() !== alias) return 'has leading or trailing whitespace'
  if (alias.startsWith('%')) return 'is an address, not a name'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) return 'contains illegal characters'
  return 'is a reserved word'
}

/**
 * An alias has to be a plain IEC identifier — one word, no spaces, no
 * punctuation, not a word the parser reserves.
 *
 * It is not a label. A variable bound to an alias is written to disk as
 * `AT <alias>`, and that text is parsed by STruC++, which reads the operand as
 * an identifier. `AT Motor Start` cannot be read back as one thing, and
 * `AT relay-1` is an expression. Before this rule the editor accepted both and
 * then could not re-read its own file (DOPE-650).
 *
 * Which words are reserved is asked of the parser, not of a list kept here. The
 * list this used to consult — `isLegalIdentifier` — also holds every standard
 * function name, so `Max`, `Step`, `TP`, `Left`, `Time` and `Limit` were
 * refused although STruC++ reads every one of them as an `AT` operand, and an
 * existing pin called any of them was renamed on open for no reason at all.
 *
 * A `%` location is a legal operand but not an alias: the field holds one or
 * the other, and a producer names channels.
 */
export function validateAliasName(alias: string): { ok: true } | { ok: false; reason: string } {
  if (!alias.startsWith('%') && isReadableAtOperand(alias)) return { ok: true }
  return {
    ok: false,
    reason: `"${alias}" ${aliasRejectionReason(alias)}. An I/O alias must be a single word made of letters, digits and underscores, starting with a letter or underscore — it is used as a name in the generated code.`,
  }
}

/**
 * Human-readable description of a `SourceRef`, for use inside error
 * toasts / inline validation messages.  Centralised here so every
 * producer's alias-edit screen renders the same wording when the
 * uniqueness check rejects an edit.
 *
 * Format examples:
 *   - `pin-mapping` ref="%QX0.0"            → "pin mapping (%QX0.0)"
 *   - `vpp-io` ref="slot-2:O3"              → "VPP slot 2 channel O3"
 *   - `modbus-tcp-remote` ref="d1:point17"  → "Modbus device d1 point point17"
 *   - `ethercat` ref="bus0:slave2:ch5"      → "EtherCAT bus0 slave2 channel ch5"
 *
 * Unknown formats fall back to a verbatim `${kind} ${ref}` rendering
 * so future producer kinds at least show something useful before this
 * helper is updated.
 */
export function describeSource(source: SourceRef): string {
  switch (source.kind) {
    case 'pin-mapping':
      return `pin mapping (${source.ref})`
    case 'vpp-io': {
      // ref shape "slot-<n>:<channelName>" — see address-pool.ts:218.
      const match = /^slot-(\d+):(.+)$/.exec(source.ref)
      if (match) return `VPP slot ${match[1]} channel ${match[2]}`
      return `VPP I/O (${source.ref})`
    }
    case 'modbus-tcp-remote': {
      // ref shape "<deviceName>:<pointId>" — see address-pool.ts:228.
      const idx = source.ref.indexOf(':')
      if (idx > 0) {
        const device = source.ref.slice(0, idx)
        const point = source.ref.slice(idx + 1)
        return `Modbus device ${device} point ${point}`
      }
      return `Modbus TCP (${source.ref})`
    }
    case 'ethercat': {
      // ref shape "<deviceName>:<slaveRef>:<channelId>" — see address-pool.ts:243.
      const parts = source.ref.split(':')
      if (parts.length === 3) return `EtherCAT ${parts[0]} slave ${parts[1]} channel ${parts[2]}`
      return `EtherCAT (${source.ref})`
    }
    default:
      // Exhaustive-fallback.  TypeScript narrows `source` to `never`
      // here when every `SourceKind` above is covered, so this branch
      // only executes when a future `SourceKind` lands without
      // updating this helper.  We stringify defensively rather than
      // dereferencing `source.kind` / `source.ref` (which TS would
      // reject on the narrowed `never`).
      return JSON.stringify(source)
  }
}

/**
 * Validate an alias-edit at write time.  Wraps `isAliasNameAvailable`
 * and returns the conflicting entry so the calling UI can produce a
 * helpful toast / inline error instead of a generic "already in use".
 *
 * Semantics:
 *   - Empty / whitespace-only `alias` is always OK (user clearing the
 *     alias is the normal way to detach a channel from its variables).
 *   - When the alias is already claimed by **the same channel** that's
 *     being edited (`ignoring` matches the in-registry source), the
 *     edit is OK — this lets the UI commit no-op writes without
 *     spuriously failing.
 *   - When the alias is already claimed by **a different channel**,
 *     the edit is rejected and `conflict` carries the surviving entry.
 *
 * Every IO-mapping screen / pin-mapping table / remote-device editor
 * MUST call this before persisting a new alias, otherwise the registry
 * silently first-wins on duplicates and the losing entry's alias becomes
 * unresolvable — every variable bound to it silently goes unlocated at
 * compile time.  See the architectural notes at the top of
 * `address-pool.ts` for the full reservation chain.
 */
export function validateAliasEdit(
  registry: AliasRegistry,
  alias: string | undefined,
  ignoring: SourceRef,
): AliasEditValidation {
  if (!alias || alias.trim().length === 0) return { ok: true }

  // Shape first: a malformed name is wrong whether or not it collides, and
  // "already in use" would be a confusing thing to say about `Motor Start`.
  const named = validateAliasName(alias)
  if (!named.ok) return named

  const entry = registry.byAlias.get(alias)
  if (!entry) return { ok: true }
  if (entry.source.kind === ignoring.kind && entry.source.ref === ignoring.ref) {
    return { ok: true }
  }
  return { ok: false, conflict: entry }
}

/**
 * Title and description for a rejected alias edit.
 *
 * Two different refusals reach the same place: a name that is not a legal IEC
 * identifier, and a legal name already taken by another channel. Saying "alias
 * already in use" about `Motor Start` would send the user looking for the
 * channel that has it.
 */
export function describeAliasRejection(
  validation: Exclude<AliasEditValidation, { ok: true }>,
  alias: string,
): { title: string; description: string } {
  if (isAliasConflict(validation)) {
    return {
      title: 'Alias already in use',
      description: `"${alias}" is already assigned to ${describeSource(validation.conflict.source)} (${validation.conflict.address}). Alias names must be unique across all I/O channels.`,
    }
  }
  return { title: 'Alias name is invalid', description: validation.reason }
}
