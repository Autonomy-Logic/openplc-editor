// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Parse a single data-type declaration from its on-disk `.dt` text
 * (an ST `TYPE…END_TYPE` block) back into a `PLCDataType`.
 *
 * Inverse of `serializeDataTypeToText` in `data-type-serializer.ts`.
 * The parser accepts exactly the shapes the serializer emits —
 * tolerant to whitespace and keyword case — so `parse(serialize(x))`
 * round-trips.  Anything the visual editor cannot represent is a
 * parse error, never a silent drop: the code view keeps the user on
 * the text until it is valid, and the project loader falls back to
 * preserving the raw file content.
 *
 * When `expectedName` is given, the declared name must match it
 * (case-insensitive) — the file name is the type's identity, so
 * renaming happens through the project tree, not by editing text.
 */
import { baseTypeSchema } from '../../../middleware/shared/ports/plc-schemas'
import type { PLCDataType, PLCStructureVariable, PLCVariableType } from '../../../middleware/shared/ports/types'
import { parseArrayType } from '../generate-iec-string-to-variables'

export interface ParseDataTypeResult {
  dataType?: PLCDataType
  error?: string
}

const identifierRegex = /^[A-Za-z_]\w*$/

const structStartRegex = /^(?<name>\w+)\s*:\s*STRUCT$/i

const structEndRegex = /^END_STRUCT\s*;$/i

// Name : (Value1, Value2) := Initial ;
const enumRegex = /^(?<name>\w+)\s*:\s*\((?<values>[^)]*)\)\s*(?::=\s*(?<initial>[^;]+?))?\s*;$/

// Name : ARRAY [d1, d2] OF Base := Initial ;
const arrayRegex =
  /^(?<name>\w+)\s*:\s*(?<type>ARRAY\s*\[[^\]]+\]\s+OF\s+[A-Za-z_][\w.]*)\s*(?::=\s*(?<initial>[^;]+?))?\s*;$/i

// FieldName : Type := Initial ; (* documentation *)
const fieldRegex =
  /^(?<name>\w+)\s*:\s*(?<type>[\w\s[\],.]+?)\s*(?::=\s*(?<initial>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

const guessErrorReason = (line: string): string => {
  if (!line.includes(';')) return 'missing semicolon (;) at the end of the declaration'
  if (!line.includes(':')) return 'missing colon (:) between name and type'
  return 'unrecognized declaration format'
}

function buildFieldType(typeStr: string): PLCVariableType | null {
  const arrayType = parseArrayType(typeStr)
  if (arrayType) return arrayType
  const baseCheck = baseTypeSchema.safeParse(typeStr)
  if (baseCheck.success) return { definition: 'base-type', value: baseCheck.data }
  if (identifierRegex.test(typeStr)) return { definition: 'user-data-type', value: typeStr }
  return null
}

function parseStructure(name: string, body: string[]): ParseDataTypeResult {
  const endIndex = body.findIndex((line) => structEndRegex.test(line))
  if (endIndex === -1) return { error: 'missing END_STRUCT; to close the structure' }
  if (endIndex !== body.length - 1) return { error: 'a .dt file must declare exactly one data type' }

  const variable: PLCStructureVariable[] = []
  for (const line of body.slice(1, endIndex)) {
    const match = fieldRegex.exec(line)
    const groups = match?.groups
    const type = groups?.type !== undefined ? buildFieldType(groups.type) : null
    if (groups?.name === undefined || type === null) {
      return { error: `invalid structure field: "${line}". Possible cause: ${guessErrorReason(line)}` }
    }
    variable.push({
      name: groups.name,
      type,
      ...(groups.initial !== undefined ? { initialValue: { simpleValue: { value: groups.initial.trim() } } } : {}),
      ...(groups.documentation !== undefined && groups.documentation !== ''
        ? { documentation: groups.documentation }
        : {}),
    })
  }
  return { dataType: { name, derivation: 'structure', variable } }
}

function parseSingleLine(line: string): ParseDataTypeResult {
  const enumMatch = enumRegex.exec(line)
  if (enumMatch?.groups?.name !== undefined) {
    const raw = enumMatch.groups.values.trim()
    const values = raw === '' ? [] : raw.split(',').map((v) => v.trim())
    const invalid = values.find((v) => !identifierRegex.test(v))
    if (invalid !== undefined) return { error: `invalid enumeration value: "${invalid}"` }
    return {
      dataType: {
        name: enumMatch.groups.name,
        derivation: 'enumerated',
        values: values.map((description) => ({ description })),
        initialValue: enumMatch.groups.initial?.trim() ?? '',
      },
    }
  }

  const arrayMatch = arrayRegex.exec(line)
  if (arrayMatch?.groups?.name !== undefined) {
    const arrayType = parseArrayType(arrayMatch.groups.type)
    if (arrayType?.data) {
      return {
        dataType: {
          name: arrayMatch.groups.name,
          derivation: 'array',
          baseType: arrayType.data.baseType,
          initialValue: arrayMatch.groups.initial?.trim() ?? '',
          dimensions: arrayType.data.dimensions,
        },
      }
    }
  }

  return { error: `invalid declaration: "${line}". Possible cause: ${guessErrorReason(line)}` }
}

export function parseDataTypeFromText(content: string, expectedName?: string): ParseDataTypeResult {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (lines.length === 0) return { error: 'empty file — expected a TYPE…END_TYPE declaration' }
  if (!/^TYPE$/i.test(lines[0])) return { error: 'the declaration must start with a TYPE block' }
  if (!/^END_TYPE$/i.test(lines[lines.length - 1])) return { error: 'the declaration must end with END_TYPE' }

  const body = lines.slice(1, -1)
  if (body.length === 0) return { error: 'the TYPE block declares no data type' }

  const structMatch = structStartRegex.exec(body[0])
  const structName = structMatch?.groups?.name
  const result =
    structName !== undefined
      ? parseStructure(structName, body)
      : body.length > 1
        ? { error: 'a .dt file must declare exactly one data type' }
        : parseSingleLine(body[0])

  if (result.dataType === undefined) return result
  if (!identifierRegex.test(result.dataType.name)) {
    return { error: `invalid type name: "${result.dataType.name}"` }
  }

  if (expectedName !== undefined) {
    if (result.dataType.name.toLowerCase() !== expectedName.toLowerCase()) {
      return {
        error: `declared type name "${result.dataType.name}" does not match the expected name "${expectedName}" — rename the data type via the project tree instead`,
      }
    }
    result.dataType.name = expectedName
  }
  return result
}
