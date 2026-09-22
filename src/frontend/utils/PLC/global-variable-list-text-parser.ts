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
 * The block is read by STruC++, through the same `parseVariableDeclarations` the
 * variables table uses (DOPE-650). This file used to carry a parser of its own — a
 * line splitter, a header regex, a declaration regex and a hand-rolled string-aware
 * comment stripper — which is the arrangement that produced every defect that change
 * exists to remove: a `//` mentioning `(*`, a comment between declarations, a name list
 * sharing a line. Whatever the compiler accepts here is what the editor accepts, and
 * there is one implementation of that rather than two.
 *
 * What is still done here is what a GVL has and a POU's VAR block does not:
 *
 *   - the header qualifier — `VAR_GLOBAL CONSTANT`, `RETAIN`, `NON_RETAIN`,
 *     `PERSISTENT` and combinations. Read verbatim out of the block's header span,
 *     because the model round-trips the user's own text and STruC++ reduces the
 *     qualifiers to flags (`PERSISTENT` folds into retain).
 *   - several `VAR_GLOBAL … END_VAR` blocks in one list, merged into one member set.
 *     Two blocks disagreeing about the qualifier is the one case that errors: merging
 *     them would have to pick a winner, and picking one silently is how a `CONSTANT`
 *     stops being constant.
 *   - `{attribute '…'}` pragmas, which are dropped. `{attribute 'qualified_only'}` is
 *     the common one; STruC++ cannot lex a `{`, and compiling a list to a struct makes
 *     qualification mandatory anyway, so the rule it asks for is already in force.
 */

import type { PLCGlobalVariableList, PLCVariable } from '../../../middleware/shared/ports/types'
import { duplicateVariableNameMessage, findDuplicateVariableName } from '../generate-iec-string-to-variables'
import type { ParsedBlock, TypeContext } from './variable-declarations'
import { blockCommentEnd, ELEMENTARY_TYPE_CONTEXT, parseVariableDeclarations } from './variable-declarations'

export interface ParseGlobalVariableListResult {
  globalVariableList?: PLCGlobalVariableList
  error?: string
}

/**
 * Blank out `{…}` pragmas, keeping the text's length.
 *
 * STruC++ cannot lex a `{`, and a GVL written by the CODESYS converter carries them.
 * Replaced with spaces rather than removed so every span the parser reports still
 * addresses the caller's own string.
 */
const blankPragmas = (content: string): string => content.replace(/\{[^}]*\}/g, (match) => ' '.repeat(match.length))

/**
 * The qualifier as the user wrote it, read out of the block's own header line.
 *
 * Comments come off first — CODESYS writes `VAR_GLOBAL CONSTANT // shared limits`
 * freely, and the qualifier is what the model round-trips, not the note beside it.
 */
const qualifierOf = (source: string, block: ParsedBlock): string | undefined => {
  let header = source.slice(block.headerSpan.start, block.headerSpan.end)

  for (let opener = header.indexOf('(*'); opener !== -1; opener = header.indexOf('(*')) {
    const close = blockCommentEnd(header, opener)
    if (close === -1) {
      header = header.slice(0, opener)
      break
    }
    header = header.slice(0, opener) + ' ' + header.slice(close)
  }

  const line = header.indexOf('//')
  if (line !== -1) header = header.slice(0, line)

  const qualifier = header.replace(/^\s*VAR_GLOBAL/i, '').trim()
  return qualifier === '' ? undefined : qualifier.toUpperCase().replace(/\s+/g, ' ')
}

/**
 * Parse the block into a list named `name`.
 *
 * The name is supplied by the caller rather than read from the text: a GVL's identity
 * is its tree entry, exactly as a data type's is, so there is nothing in the block
 * itself to rename.
 */
export function parseGlobalVariableListFromText(
  content: string,
  name: string,
  context: TypeContext = ELEMENTARY_TYPE_CONTEXT,
): ParseGlobalVariableListResult {
  const source = blankPragmas(content)
  if (source.trim() === '') return { error: 'empty declaration — expected a VAR_GLOBAL…END_VAR block' }

  const parsed = parseVariableDeclarations(source, context)
  if (parsed.errors.length > 0) return { error: parsed.errors[0].message }
  if (parsed.blocks.length === 0) return { error: 'the declaration must start with VAR_GLOBAL' }

  const foreign = parsed.blocks.find((block) => block.class !== 'global')
  if (foreign) return { error: 'a global variable list holds VAR_GLOBAL blocks only' }

  let qualifier: string | undefined
  for (const [index, block] of parsed.blocks.entries()) {
    const next = qualifierOf(source, block)
    if (index > 0 && next !== qualifier) {
      return {
        error: `conflicting VAR_GLOBAL qualifiers in one list ("${qualifier ?? 'none'}" and "${next ?? 'none'}") — split them into separate lists`,
      }
    }
    qualifier = next
  }

  // An address binds ONE name, so a list of them carrying one would claim the same
  // address for every member. The declaration is legal; the address on it is not.
  // A declaration is reported once per name, so several sharing a span is the list.
  for (const block of parsed.blocks) {
    const perDeclaration = new Map<number, number>()
    for (const declaration of block.declarations) {
      if (!declaration.fields.location) continue
      const count = (perDeclaration.get(declaration.span.start) ?? 0) + 1
      perDeclaration.set(declaration.span.start, count)
      if (count > 1) {
        const text = source.slice(declaration.span.start, declaration.fields.type.start).trim()
        return { error: `"${text}" declares several names, so it cannot carry a single AT address` }
      }
    }
  }

  // The model stores an absent initial value as the empty string, where the parser
  // reports `null`; everything else carries across untouched.
  const variables: PLCVariable[] = parsed.variables.map((variable) => ({
    ...variable,
    initialValue: variable.initialValue ?? '',
  }))

  const duplicate = findDuplicateVariableName(variables)
  if (duplicate) return { error: duplicateVariableNameMessage(duplicate) }

  return { globalVariableList: { name, variables, ...(qualifier ? { qualifier } : {}) } }
}
