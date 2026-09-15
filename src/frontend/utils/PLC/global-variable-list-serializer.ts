// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/** Serialises a Global Variable List as a `TYPE ... STRUCT` plus one `VAR_GLOBAL` instance; the struct must not share the list's name. */

import type { PLCGlobalVariableList, PLCVariable } from '../../../middleware/shared/ports/types'

/** Suffix that turns a list's name into its backing struct type name. */
const TYPE_SUFFIX = '_TYPE'

const DECL_INDENT = '  '

/** Name of the struct type backing a list. The one home of this suffix rule — every emitter imports it from here to avoid a silent instance/type name mismatch. */
export function globalVariableListTypeName(listName: string): string {
  return `${listName}${TYPE_SUFFIX}`
}

/** True when `text` contains `<listName>.`; pass `referenceSearchText(pou)`, not `JSON.stringify(pou)` (see below). */
export function globalVariableListIsReferencedIn(listName: string, text: string): boolean {
  return new RegExp(`(^|[^\\w.])${escapeForRegExp(listName)}\\s*\\.`, 'i').test(text)
}

/** Every string a POU holds, joined with a real newline; NOT `JSON.stringify(pou)`, which would defeat the reference-scan guard. */
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

/** The list as the user reads and edits it — the on-disk format. Addresses ARE written here, unlike the compiler-facing serializers. */
export function serializeGlobalVariableListToText(list: PLCGlobalVariableList): string {
  const lines = list.variables.map((variable) => {
    // The address binds the NAME, so `AT` precedes the colon, not the type.
    const location = variable.location ? ` AT ${variable.location}` : ''
    const initialValue =
      variable.initialValue !== undefined && variable.initialValue !== null && variable.initialValue !== ''
        ? ` := ${variable.initialValue}`
        : ''
    return `${DECL_INDENT}${variable.name}${location} : ${variable.type.value}${initialValue};`
  })
  // Never compiled (a struct type can't express CONSTANT/RETAIN); this text is the only place it survives.
  const qualifier = list.qualifier ? ` ${list.qualifier}` : ''
  return `VAR_GLOBAL${qualifier}\n${lines.join('\n')}\nEND_VAR\n`
}

/** The `TYPE…END_TYPE` block declaring one struct per list, for the compiler. Returns `''` when there are none. */
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

/** The `VAR_GLOBAL` block declaring one instance per list. A list with no members yields no instance — an empty STRUCT is not a legal type. */
export function serializeGlobalVariableListInstances(lists: PLCGlobalVariableList[]): string {
  const lines = lists
    .filter((list) => list.variables.length > 0)
    .map((list) => `${DECL_INDENT}${list.name} : ${globalVariableListTypeName(list.name)};`)
  if (lines.length === 0) return ''
  return `VAR_GLOBAL\n${lines.join('\n')}\nEND_VAR\n`
}

/** The `VAR_EXTERNAL` block a POU needs to reach the lists it references; only referenced lists are declared. */
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
