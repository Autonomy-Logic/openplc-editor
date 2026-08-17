// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Serialise Global Variable Lists — the object CODESYS calls a GVL.
 *
 * A GVL is presented to the user exactly as CODESYS presents it: a named
 * `VAR_GLOBAL … END_VAR` block, with members reached as `<name>.<variable>`. IEC
 * 61131-3 has no such object, so it is compiled as the one shape STruC++ resolves
 * qualified member access through:
 *
 *   TYPE GVL_TYPE : STRUCT        (* one struct per list, holding its members *)
 *     Output1 : BOOL;
 *   END_STRUCT; END_TYPE
 *
 *   VAR_GLOBAL GVL : GVL_TYPE; END_VAR   (* one global instance, named after the list *)
 *
 * A POU that says `GVL.Output1` then type-checks unchanged, which is the whole point:
 * code imported from CODESYS keeps compiling, and code written here stays portable
 * back to it.
 *
 * Two rules the emitted text has to respect, both learned from the compiler rather
 * than assumed:
 *
 *   - The struct type may NOT share the list's name. Types and variables occupy one
 *     namespace, so `TYPE GVL` alongside `GVL : GVL` is rejected with "Symbol 'GVL'
 *     already defined in scope 'global'". The type is suffixed; only the instance name
 *     is ever visible to the user.
 *   - Member addresses are NOT emitted. `AT %QX0.0` on a struct member compiles and is
 *     then silently discarded — no located mapping is produced — so emitting it would
 *     imply an I/O binding that does not exist. The address stays on the model for the
 *     round trip back to CODESYS; see `PLCGlobalVariableList`.
 */

import type { PLCGlobalVariableList, PLCVariable } from '../../../middleware/shared/ports/types'

/** Suffix that turns a list's name into its backing struct type name. */
const TYPE_SUFFIX = '_TYPE'

const DECL_INDENT = '  '

/**
 * Name of the struct type backing a list.
 *
 * This module is the ONE home of the suffix rule. Every path that emits a list —
 * the ST text here, the schema→IR projection in
 * `backend/shared/transpilers/st-transpiler/from-schema.ts`, and the port→IR
 * projection in `middleware/adapters/web/transpile-from-port.ts` — imports it
 * from here. A second copy would let the struct type stop matching its instance
 * and its `VAR_EXTERNAL` silently, which is the exact failure the module note
 * above warns about.
 */
export function globalVariableListTypeName(listName: string): string {
  return `${listName}${TYPE_SUFFIX}`
}

/**
 * True when `text` qualifies against the list — i.e. contains `<listName>.`.
 *
 * The other rule with no compiler diagnostic behind it, and so the other one
 * that lives here alone. Matching on `<name>.` keeps an unrelated POU from being
 * handed a name it never uses, and stops a list whose name merely prefixes
 * another (`GVL` vs `GVL_OTHER`) from being dragged in. The leading `[^\w.]`
 * guard is what excludes the prefix case *and* member access on something else
 * (`other.GVL.x`); IEC identifiers are case-insensitive, hence the `i` flag.
 *
 * Pass `referenceSearchText(pou)`, NOT `JSON.stringify(pou)` — see the note there.
 */
export function globalVariableListIsReferencedIn(listName: string, text: string): boolean {
  return new RegExp(`(^|[^\\w.])${escapeForRegExp(listName)}\\s*\\.`, 'i').test(text)
}

/**
 * Every string a POU holds, joined for the reference scan above.
 *
 * A ladder or FBD body is a node graph and the reference lives in a node's
 * variable name, not in any text the body exposes — so the scan has to see the
 * whole POU, not just `body.value`. The obvious way to get that is
 * `JSON.stringify(pou)`, and it is WRONG: JSON escapes a newline to the two
 * characters `\` and `n`, so a body of
 *
 *     x := 1;
 *     GVL.A := 2;
 *
 * serialises with `n` immediately before `GVL`. `n` is a word character, the
 * `[^\w.]` guard rejects the match, and the POU is judged not to reference the
 * list — no `VAR_EXTERNAL` is emitted and the build fails with "Undeclared
 * variable 'GVL'", which is precisely the error the external exists to prevent.
 * Every reference starting a line after the first is invisible that way.
 *
 * Walking to the string VALUES sidesteps the escaping entirely. They are joined
 * with a real newline: a non-word, non-dot separator, so no match can be
 * manufactured across two unrelated strings.
 */
export function referenceSearchText(value: unknown): string {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      parts.push(node)
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node !== null && typeof node === 'object') {
      Object.values(node).forEach(walk)
    }
  }
  walk(value)
  return parts.join('\n')
}

/** One `name : TYPE := init;` line. Addresses are deliberately omitted — see the module note. */
function declarationLine(variable: PLCVariable): string {
  const initialValue =
    variable.initialValue !== undefined && variable.initialValue !== null && variable.initialValue !== ''
      ? ` := ${variable.initialValue}`
      : ''
  return `${DECL_INDENT}${variable.name} : ${variable.type.value}${initialValue};`
}

/**
 * The list as the user reads and edits it — the CODESYS shape, and the on-disk format.
 *
 * Addresses ARE written here: this text is the list's own persistence, so it has to
 * carry everything the model holds, including an `AT` that the compiler cannot yet act
 * on. Its inverse is `parseGlobalVariableListFromText`.
 */
export function serializeGlobalVariableListToText(list: PLCGlobalVariableList): string {
  const lines = list.variables.map((variable) => {
    // `name AT %QX0.0 : TYPE` — the address binds the NAME, so it precedes the colon.
    // Writing it after the type reads as valid until something else has to parse it.
    const location = variable.location ? ` AT ${variable.location}` : ''
    const initialValue =
      variable.initialValue !== undefined && variable.initialValue !== null && variable.initialValue !== ''
        ? ` := ${variable.initialValue}`
        : ''
    return `${DECL_INDENT}${variable.name}${location} : ${variable.type.value}${initialValue};`
  })
  // The qualifier goes back on the header it was read from. It is never compiled — a
  // struct type cannot express CONSTANT or RETAIN — so this text is the only place it
  // survives, and omitting it would quietly rewrite the user's declaration.
  const qualifier = list.qualifier ? ` ${list.qualifier}` : ''
  return `VAR_GLOBAL${qualifier}\n${lines.join('\n')}\nEND_VAR\n`
}

/**
 * The `TYPE…END_TYPE` block declaring one struct per list, for the compiler.
 *
 * Returns `''` when there are no lists, so the caller can skip the document entirely
 * rather than feed the language server an empty block.
 */
export function serializeGlobalVariableListsToTypes(lists: PLCGlobalVariableList[]): string {
  const blocks = lists
    .filter((list) => list.variables.length > 0)
    .map((list) => {
      const body = list.variables.map(declarationLine).join('\n')
      return `${globalVariableListTypeName(list.name)} : STRUCT\n${body}\nEND_STRUCT;`
    })
  if (blocks.length === 0) return ''
  return `TYPE\n${blocks.join('\n')}\nEND_TYPE\n`
}

/**
 * The `VAR_GLOBAL` block declaring one instance per list, for the CONFIGURATION.
 *
 * A list with no members yields no instance: an empty STRUCT is not a legal type, so
 * there is nothing to be an instance of.
 */
export function serializeGlobalVariableListInstances(lists: PLCGlobalVariableList[]): string {
  const lines = lists
    .filter((list) => list.variables.length > 0)
    .map((list) => `${DECL_INDENT}${list.name} : ${globalVariableListTypeName(list.name)};`)
  if (lines.length === 0) return ''
  return `VAR_GLOBAL\n${lines.join('\n')}\nEND_VAR\n`
}

/**
 * The `VAR_EXTERNAL` block a POU needs to reach the lists it references.
 *
 * STruC++ resolves a configuration-level global only through a matching
 * `VAR_EXTERNAL`; without one, `GVL.Output1` fails with "Undeclared variable 'GVL'".
 * Only the lists the body actually mentions are declared, so an unrelated POU is not
 * given a name it never uses.
 *
 * Matching is on `<name>.` as a whole word, which is how the reference is always
 * written — a bare `GVL` with no member cannot be a use of the list, since the list
 * itself has no value.
 */
export function globalVariableListExternals(lists: PLCGlobalVariableList[], body: string): string {
  const referenced = lists.filter(
    (list) => list.variables.length > 0 && globalVariableListIsReferencedIn(list.name, body),
  )
  if (referenced.length === 0) return ''
  const lines = referenced.map((list) => `${DECL_INDENT}${list.name} : ${globalVariableListTypeName(list.name)};`)
  return `VAR_EXTERNAL\n${lines.join('\n')}\nEND_VAR\n`
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
