// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Parse a Global Variable List's text form — the `VAR_GLOBAL … END_VAR` block the code
 * view shows.
 *
 * Inverse of `serializeGlobalVariableListToText`; the pair must round-trip, including
 * the `AT` addresses and the header qualifier that are carried on the model but never
 * compiled (see `PLCGlobalVariableList`).
 *
 * A parse failure returns an error rather than a partial list. The code view keeps the
 * user on their text when that happens, so a typo costs a correction instead of the
 * silent loss of every declaration under it.
 *
 * What it accepts is set by what CODESYS writes, because the whole point of a GVL here
 * is that a declaration can be moved across unchanged. So beyond the shape this editor
 * itself emits, the following are read rather than rejected:
 *
 *   - header qualifiers — `VAR_GLOBAL CONSTANT`, `RETAIN`, `NON_RETAIN`, `PERSISTENT`
 *     and their combinations. Kept on the model; a struct type cannot express any of
 *     them, so none of them reaches the compiler.
 *   - several `VAR_GLOBAL … END_VAR` blocks in one list, merged into one member set.
 *     Two blocks disagreeing about the qualifier is the one case that errors: merging
 *     them would have to pick a winner, and picking one silently is how a `CONSTANT`
 *     stops being constant.
 *   - name lists — `A, B : INT;` declares two members of that type.
 *   - comment-only lines, `(* … *)` (including across lines) and `//`.
 *   - `{attribute '…'}` pragmas, which are dropped. `{attribute 'qualified_only'}` is
 *     the common one; STruC++ cannot lex a `{`, and compiling a list to a struct makes
 *     qualification mandatory anyway, so the rule it asks for is already in force.
 */

import { baseTypeSchema } from '../../../middleware/shared/ports/plc-schemas'
import type { PLCGlobalVariableList, PLCVariable, PLCVariableType } from '../../../middleware/shared/ports/types'
import { parseArrayType } from '../generate-iec-string-to-variables'
import { isLegalIdentifier } from '../keywords'

export interface ParseGlobalVariableListResult {
  globalVariableList?: PLCGlobalVariableList
  error?: string
}

const identifierRegex = /^[A-Za-z_]\w*$/

/** Qualifiers IEC allows on a `VAR_GLOBAL` header, in any order and combination. */
const QUALIFIERS = ['CONSTANT', 'RETAIN', 'NON_RETAIN', 'PERSISTENT']

const headerRegex = new RegExp(`^VAR_GLOBAL(?<qualifier>(?:\\s+(?:${QUALIFIERS.join('|')}))*)\\s*$`, 'i')
const endRegex = /^END_VAR\s*;?$/i

/** A line that is nothing but a `(* … *)` comment — documentation, not a declaration. */
const commentOnlyRegex = /^\(\*[\s\S]*\*\)$/

// Name [, Name…] AT %QX0.0 : TYPE := Initial ; (* documentation *)
// The address binds the NAME and so precedes the colon, which is also the order the
// CODESYS converter writes a GVL declaration in — expecting it after the type made
// this parser reject the very declarations the importer produces.
const declarationRegex =
  /^(?<names>\w+(?:\s*,\s*\w+)*)\s*(?:AT\s+(?<location>%[\w.]+)\s*)?:\s*(?<type>[\w\s[\],.]+?)\s*(?::=\s*(?<initial>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/i

function buildVariableType(typeStr: string): PLCVariableType | null {
  const arrayType = parseArrayType(typeStr)
  if (arrayType) return arrayType
  const baseCheck = baseTypeSchema.safeParse(typeStr)
  if (baseCheck.success) return { definition: 'base-type', value: baseCheck.data }
  if (identifierRegex.test(typeStr)) return { definition: 'user-data-type', value: typeStr }
  return null
}

const guessErrorReason = (line: string): string => {
  if (!line.includes(';')) return 'missing semicolon (;) at the end of the declaration'
  if (!line.includes(':')) return 'missing colon (:) between name and type'
  return 'unrecognized declaration format'
}

/**
 * Strip pragmas and comments, then split into trimmed, non-empty lines.
 *
 * A `(* … *)` spanning lines is removed before the split: CODESYS wraps one freely, and
 * half a comment reaching the declaration matcher reads as a syntax error in text that
 * is perfectly valid. A same-line `(* … *)` is left in place — it is the member's
 * documentation, and the declaration matcher captures it.
 */
function toSignificantLines(content: string): string[] {
  const withoutSpannedComments = content.replace(/\(\*[\s\S]*?\*\)/g, (match) => (match.includes('\n') ? ' ' : match))
  return withoutSpannedComments
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('{') && !commentOnlyRegex.test(line))
}

/**
 * Parse the block into a list named `name`.
 *
 * The name is supplied by the caller rather than read from the text: a GVL's identity
 * is its tree entry, exactly as a data type's is, so there is nothing in the block
 * itself to rename.
 */
export function parseGlobalVariableListFromText(content: string, name: string): ParseGlobalVariableListResult {
  const lines = toSignificantLines(content)

  if (lines.length === 0) return { error: 'empty declaration — expected a VAR_GLOBAL…END_VAR block' }

  const variables: PLCVariable[] = []
  const seen = new Set<string>()
  let qualifier: string | undefined
  let sawHeader = false
  let inside = false
  let closed = false

  for (const line of lines) {
    const header = headerRegex.exec(line)
    if (header) {
      if (inside) return { error: 'VAR_GLOBAL opened again before END_VAR closed the previous block' }
      const next = header.groups?.qualifier?.trim().toUpperCase().replace(/\s+/g, ' ') || undefined
      // Merging blocks has to settle on one qualifier for the list; refusing beats
      // choosing silently, because the discarded one changes what its members are.
      if (sawHeader && next !== qualifier) {
        return {
          error: `conflicting VAR_GLOBAL qualifiers in one list ("${qualifier ?? 'none'}" and "${next ?? 'none'}") — split them into separate lists`,
        }
      }
      qualifier = next
      sawHeader = true
      inside = true
      continue
    }

    if (endRegex.test(line)) {
      if (!inside) return { error: 'END_VAR without a matching VAR_GLOBAL' }
      inside = false
      closed = true
      continue
    }

    if (!inside) {
      return sawHeader
        ? { error: `"${line}" is outside a VAR_GLOBAL…END_VAR block` }
        : { error: 'the declaration must start with VAR_GLOBAL' }
    }

    const groups = declarationRegex.exec(line)?.groups
    if (!groups?.names || !groups.type) {
      return { error: `cannot parse "${line}" — ${guessErrorReason(line)}` }
    }

    const type = buildVariableType(groups.type.trim())
    if (!type) return { error: `unknown type "${groups.type.trim()}" on "${groups.names.trim()}"` }

    // `A, B : INT;` is one declaration of two members — ordinary in CODESYS, and the
    // single-name pattern used to send it to "unrecognized declaration format".
    const names = groups.names.split(',').map((entry) => entry.trim())

    // An address binds ONE name, so a list of them carrying one would claim the same
    // address for every member. The declaration is legal; the address on it is not.
    if (names.length > 1 && groups.location) {
      return { error: `"${groups.names.trim()}" declares several names, so it cannot carry a single AT address` }
    }

    for (const variableName of names) {
      const [legal, reason] = isLegalIdentifier(variableName)
      if (!legal) return { error: `invalid variable name: "${variableName}" — ${reason}` }

      const key = variableName.toLowerCase()
      if (seen.has(key)) return { error: `"${variableName}" is declared more than once` }
      seen.add(key)

      variables.push({
        name: variableName,
        class: 'global',
        type,
        location: groups.location ?? '',
        initialValue: groups.initial?.trim() ?? '',
        documentation: groups.documentation ?? '',
      })
    }
  }

  if (!sawHeader) return { error: 'the declaration must start with VAR_GLOBAL' }
  if (!closed || inside) return { error: 'the declaration must end with END_VAR' }

  return { globalVariableList: { name, variables, ...(qualifier ? { qualifier } : {}) } }
}
