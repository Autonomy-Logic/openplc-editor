/**
 * What the debugger may do with a leaf: read it, force it, or force something
 * else in its place.
 *
 * STruC++ marks two kinds of leaf in debug-map.json:
 *
 *  - `readOnly` — an IEC CONSTANT. Watched, never forced or written; the
 *    runtime refuses either (LEAF_FLAG_READONLY).
 *  - `indirect` — a leaf inside a function block's VAR_IN_OUT. The in-out IS
 *    the caller's variable (IEC 61131-3 §3.48), bound by each call, so the leaf
 *    is a live, read-only view of that variable. It is always `readOnly` too.
 *    When every call binds the in-out to one plain variable, `target` names it,
 *    and forcing the in-out forces that variable — at its own name, where the
 *    runtime keeps the force. Without a target the in-out cannot be forced at
 *    all: the variable it shows is whatever the last call passed.
 *
 * Built once per debug session from the map (`registerDebugLeafAccess`), and
 * read synchronously by the force paths and the menus. A plain module-level
 * table rather than store state: it changes only when a session starts, and
 * nothing re-renders on it.
 */

import { buildLeafPathMap, type DebugMap } from './debug-parser'

export interface DebugLeafAccess {
  /** The leaf itself is never forced or written. */
  readOnly: boolean
  /** A view of a function block in-out's bound variable. */
  indirect: boolean
  /** The variable an `indirect` leaf shows, by debug path, when known. */
  target?: string
  /** That variable's packed debug index, when it is in the map. */
  targetIndex?: number
  /** That variable's composite key — where its force is recorded and shown. */
  targetKey?: string
}

let byIndex = new Map<number, DebugLeafAccess>()

/**
 * Index the read-only and in-out leaves of a session's debug map. `keys` is the
 * session's composite-key → packed-index map (`deriveVariableIndexMap`), used
 * to name an in-out's target the way the watch panel names it.
 */
export function registerDebugLeafAccess(map: DebugMap, keys?: Map<string, number>): void {
  const paths = buildLeafPathMap(map)
  const keyOfIndex = new Map<number, string>()
  for (const [key, index] of keys ?? []) if (!keyOfIndex.has(index)) keyOfIndex.set(index, key)
  const next = new Map<number, DebugLeafAccess>()
  for (const leaf of map.leaves) {
    if (!leaf.readOnly && !leaf.indirect) continue
    const index = paths.get(leaf.path.toUpperCase())
    if (index === undefined) continue
    const targetIndex = leaf.target !== undefined ? paths.get(leaf.target.toUpperCase()) : undefined
    next.set(index, {
      readOnly: true,
      indirect: leaf.indirect === true,
      ...(leaf.target !== undefined ? { target: leaf.target } : {}),
      ...(targetIndex !== undefined ? { targetIndex } : {}),
      ...(targetIndex !== undefined && keyOfIndex.has(targetIndex) ? { targetKey: keyOfIndex.get(targetIndex) } : {}),
    })
  }
  byIndex = next
}

/** Forget the previous session's leaves. */
export function clearDebugLeafAccess(): void {
  byIndex = new Map()
}

/** The access rule for a packed debug index; undefined for an ordinary leaf. */
export function getDebugLeafAccess(index: number | undefined): DebugLeafAccess | undefined {
  return index === undefined ? undefined : byIndex.get(index)
}

/**
 * The index a force (or a release) of `index` goes to: the index itself for an
 * ordinary leaf, the bound variable's for an in-out with a known target, and
 * undefined when the leaf cannot be forced (a CONSTANT, or an in-out whose
 * variable cannot be named).
 */
export function resolveForceIndex(index: number | undefined): number | undefined {
  if (index === undefined) return undefined
  const access = byIndex.get(index)
  if (!access) return index
  if (access.indirect && access.targetIndex !== undefined) return access.targetIndex
  return undefined
}

/**
 * The key a force of `index` is recorded under in `debugForcedVariables`: the
 * target's own key for an in-out whose target the session can name — the force
 * lives on that variable, so that is where [FORCED] shows and where releasing
 * it clears — and `compositeKey` otherwise.
 */
export function forcedKeyFor(compositeKey: string, index: number | undefined): string {
  const access = getDebugLeafAccess(index)
  return access?.indirect && access.targetKey !== undefined ? access.targetKey : compositeKey
}

/** Whether a force control should be offered for this leaf at all. */
export function canForceDebugLeaf(index: number | undefined): boolean {
  return index === undefined || !byIndex.has(index) || resolveForceIndex(index) !== undefined
}

/** One line for a menu or a tooltip explaining an in-out leaf; undefined otherwise. */
export function describeInOutLeaf(index: number | undefined): string | undefined {
  const access = getDebugLeafAccess(index)
  if (!access?.indirect) return undefined
  const target = access.targetKey ?? access.target
  return target !== undefined
    ? `In-out: shows ${target}. Forcing it forces ${target}.`
    : 'In-out: shows the variable passed to it (read-only). Force that variable.'
}
