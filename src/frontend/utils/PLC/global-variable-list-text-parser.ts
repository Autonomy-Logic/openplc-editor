// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Parse a Global Variable List's text form — the `VAR_GLOBAL … END_VAR` block the code
 * view shows and the `.gvl` file stores.
 *
 * Inverse of `serializeGlobalVariableListToText`; the pair must round-trip, including
 * the `AT` addresses that are carried on the model but never compiled (see
 * `PLCGlobalVariableList`).
 *
 * A parse failure returns an error rather than a partial list. The code view keeps the
 * user on their text when that happens, so a typo costs a correction instead of the
 * silent loss of every declaration under it.
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

// Name : TYPE AT %QX0.0 := Initial ; (* documentation *)
const declarationRegex =
  /^(?<name>\w+)\s*:\s*(?<type>[\w\s[\],.]+?)\s*(?:AT\s+(?<location>%[\w.]+)\s*)?(?::=\s*(?<initial>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/i

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
 * Parse the block into a list named `name`.
 *
 * The name is supplied by the caller rather than read from the text: a GVL's identity
 * is its file name / tree entry, exactly as a data type's is, so there is nothing in
 * the block itself to rename.
 */
export function parseGlobalVariableListFromText(content: string, name: string): ParseGlobalVariableListResult {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (lines.length === 0) return { error: 'empty file — expected a VAR_GLOBAL…END_VAR declaration' }
  if (!/^VAR_GLOBAL$/i.test(lines[0])) return { error: 'the declaration must start with VAR_GLOBAL' }
  if (!/^END_VAR\s*;?$/i.test(lines[lines.length - 1])) return { error: 'the declaration must end with END_VAR' }

  const body = lines.slice(1, -1)
  const variables: PLCVariable[] = []
  const seen = new Set<string>()

  for (const line of body) {
    const match = declarationRegex.exec(line)
    const groups = match?.groups
    if (!groups?.name || !groups.type) {
      return { error: `cannot parse "${line}" — ${guessErrorReason(line)}` }
    }

    const [legal, reason] = isLegalIdentifier(groups.name)
    if (!legal) return { error: `invalid variable name: "${groups.name}" — ${reason}` }

    const key = groups.name.toLowerCase()
    if (seen.has(key)) return { error: `"${groups.name}" is declared more than once` }
    seen.add(key)

    const type = buildVariableType(groups.type.trim())
    if (!type) return { error: `unknown type "${groups.type.trim()}" on "${groups.name}"` }

    variables.push({
      name: groups.name,
      class: 'global',
      type,
      location: groups.location ?? '',
      initialValue: groups.initial?.trim() ?? '',
      documentation: groups.documentation ?? '',
    })
  }

  return { globalVariableList: { name, variables } }
}
