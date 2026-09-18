// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Find and rewrite qualified references to a Global Variable List — `GVL.Output1`.
 *
 * A list is renamed from the tree, the tab, or the editor, and every reference to it
 * lives somewhere else: in a POU's ST or IL text, or in a graphical node's variable name.
 * Renaming the list alone leaves each of them pointing at a name that no longer exists,
 * and nothing complains until the compiler does — the `VAR_EXTERNAL` is only emitted for
 * lists a POU actually mentions, so the reference simply stops resolving.
 *
 * Both halves work on the POU's string VALUES, reached by walking it, which is the same
 * text the compiler scans (`referenceSearchText`). Scanning what the compiler scans is
 * what keeps "we rewrote every reference" and "the compiler still finds none" from
 * disagreeing. It is also why neither half serialises the POU to JSON first: JSON escapes
 * a newline to `\` + `n`, and the word character that leaves in front of a reference
 * hides every one that starts a line.
 */

import type { PLCPou } from '../../../middleware/shared/ports/types'
import { globalVariableListIsReferencedIn, referenceSearchText } from './global-variable-list-serializer'

export type GlobalVariableListImpact = {
  totalReferences: number
  /** POU name → number of qualified references in it. Only POUs with at least one. */
  byPou: Map<string, number>
}

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every `<listName>.` occurrence, as a global matcher.
 *
 * Same shape as `globalVariableListIsReferencedIn`, with the name captured so a
 * replacement can put a different one back and leave the separator and the dot alone.
 * Built fresh per call: a global regex carries `lastIndex`, and a shared one would skip
 * matches on its second use.
 */
const referencePattern = (listName: string): RegExp =>
  new RegExp(`(^|[^\\w.])(${escapeForRegExp(listName)})(\\s*\\.)`, 'gi')

/**
 * Rewrite `<oldName>.` to `<newName>.` throughout one string.
 *
 * `replace` with a function rather than `$1$2$3`, because the replacement name is user
 * input and a `$` in it would be read as a group reference.
 */
function rewriteInString(text: string, oldName: string, newName: string): string {
  return text.replace(referencePattern(oldName), (_match, before: string, _name: string, dot: string) => {
    return `${before}${newName}${dot}`
  })
}

/**
 * Map every string inside `value`, rebuilding arrays and plain objects around them.
 *
 * The one assertion in this file, and it is structural rather than a claim about
 * unknown data: each key is copied to the same key and only `string` leaves are
 * replaced by another `string`, so the result has the shape it came in with. TypeScript
 * has no way to express "same shape, strings mapped", so it has to be stated.
 */
function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === 'string') return map(value) as T
  if (Array.isArray(value)) return value.map((entry: unknown) => mapStrings(entry, map)) as T
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      result[key] = mapStrings(entry, map)
    }
    return result as T
  }
  return value
}

/**
 * Which POUs reference `listName`, and how often.
 *
 * Reported so a rename knows what it is about to touch, and so the POUs it rewrites can
 * be flagged unsaved. A count of zero is the common case — a list is usually referenced
 * from one or two POUs, not from all of them.
 */
export function findGlobalVariableListReferences(listName: string, pous: PLCPou[]): GlobalVariableListImpact {
  const byPou = new Map<string, number>()
  let totalReferences = 0

  for (const pou of pous) {
    const searchText = referenceSearchText(pou)
    if (!globalVariableListIsReferencedIn(listName, searchText)) continue
    const count = searchText.match(referencePattern(listName))?.length ?? 0
    byPou.set(pou.name, count)
    totalReferences += count
  }

  return { totalReferences, byPou }
}

/**
 * Rewrite every `<oldName>.` in `pou` to `<newName>.`, or return `null` when the POU does
 * not reference the list.
 *
 * Walking to the strings reaches the reference wherever the language keeps it — a
 * statement in an ST body, a `data.variable.name` on a ladder contact — with no
 * per-language walker to keep in step with the editors. Only string CONTENT changes.
 */
export function renameGlobalVariableListInPou(pou: PLCPou, oldName: string, newName: string): PLCPou | null {
  if (!globalVariableListIsReferencedIn(oldName, referenceSearchText(pou))) return null

  let changed = false
  const rewritten = mapStrings(pou, (text) => {
    const next = rewriteInString(text, oldName, newName)
    if (next !== text) changed = true
    return next
  })

  return changed ? rewritten : null
}
