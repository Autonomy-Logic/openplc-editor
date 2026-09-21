/**
 * Bring a project's I/O aliases up to the identifier rule.
 *
 * An alias is written to disk as `AT <alias>` and read back by STruC++, which
 * reads that operand as an identifier. Before the rule existed the editor
 * accepted anything — `Motor Start`, `relay-1` — and then could not re-read its
 * own file (DOPE-650). Projects saved in that state are real and must keep
 * working, so they are repaired on load rather than refused.
 *
 * Repair, not deletion: `Motor Start` becomes `Motor_Start`, and every variable
 * bound to the old name follows. Dropping the alias instead would leave those
 * variables unlocated, which is a silent wrong answer at compile time — the
 * exact failure the alias machinery exists to prevent.
 *
 * Pure: it reports the renames it wants and leaves applying them to the caller,
 * so the same plan drives the producer rewrites, the variable cascade and the
 * console report without any of them going out of step.
 */

import { isLegalIdentifier } from '../../../../frontend/utils/keywords'

/** One alias that has to change, and what it has to change to. */
export interface AliasRename {
  from: string
  to: string
  /** Why the original was rejected, for the console. */
  reason: string
}

/**
 * Turn an arbitrary label into an IEC identifier.
 *
 * Every character an identifier cannot hold becomes `_`, a leading digit gets a
 * `_` in front, and an empty result falls back to `Alias`. Collisions with
 * names already in use (or produced earlier in the same pass) get a numeric
 * suffix, because two producers sharing an alias is exactly the ambiguity the
 * registry refuses.
 */
export function normalizeAliasName(alias: string, taken: ReadonlySet<string>): string {
  let candidate = alias.trim().replace(/[^A-Za-z0-9_]/g, '_')
  if (candidate === '' || /^[0-9]/.test(candidate)) candidate = `_${candidate}`
  // A reserved word is a legal-looking identifier the compiler will not accept,
  // so it needs the same treatment as an illegal character.
  if (!isLegalIdentifier(candidate)[0]) candidate = `${candidate}_alias`

  if (!taken.has(candidate.toLowerCase())) return candidate
  for (let suffix = 2; ; suffix++) {
    const numbered = `${candidate}${suffix}`
    if (!taken.has(numbered.toLowerCase())) return numbered
  }
}

/**
 * Plan the renames needed to make every alias in `aliases` legal.
 *
 * `aliases` is every alias the project declares, in any order. The returned
 * list holds only the ones that have to change; a project that is already
 * legal produces an empty list and the caller can skip the whole repair.
 */
export function planAliasNormalization(aliases: readonly string[]): AliasRename[] {
  const renames: AliasRename[] = []
  // Legal aliases are reserved up front so a repaired one cannot collide with
  // a name that was already fine and is staying put.
  const taken = new Set(aliases.filter((alias) => isLegalIdentifier(alias)[0]).map((a) => a.toLowerCase()))

  for (const alias of aliases) {
    if (alias.trim() === '') continue
    const [legal, reason] = isLegalIdentifier(alias)
    if (legal) continue
    const to = normalizeAliasName(alias, taken)
    taken.add(to.toLowerCase())
    renames.push({ from: alias, to, reason })
  }

  return renames
}

/** Human-readable console line for one repair. */
export function describeAliasRename(rename: AliasRename): string {
  return `I/O alias "${rename.from}" ${rename.reason} and was renamed to "${rename.to}". Variables bound to it were updated.`
}
