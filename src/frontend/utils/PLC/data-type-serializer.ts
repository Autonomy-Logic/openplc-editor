// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Serialise the project's data-type definitions to a single ST
 * `TYPE…END_TYPE` block the STruC++ language server can ingest.
 *
 * The editor stores user-defined types (`PLCDataType`) in the
 * project's `dataTypes` slice — separate from POUs.  Strucpp needs
 * those declarations to type-check any POU that references them
 * (e.g. an enum used in a CASE statement, a STRUCT used as a
 * variable type).  This serializer turns each entry into the
 * standard IEC 61131-3 syntax strucpp's parser already accepts.
 *
 * Output shape:
 *
 *   TYPE
 *     Irrigation_State : (Stopped, Running, Manual);
 *     MyStruct : STRUCT
 *       field1 : INT;
 *       field2 : BOOL;
 *     END_STRUCT;
 *     MyArray : ARRAY [0..9] OF INT;
 *   END_TYPE
 *
 * Returns an empty string when the project has no data types — the
 * caller (project-sync) uses that to skip opening a document at all.
 *
 * For consumers that need to *navigate back* from an LSP line into
 * the data type that occupies it (Go-to-Definition), use
 * `serializeDataTypesToLines` and walk the spans — that single
 * source of truth keeps the line-mapping in lockstep with the
 * rendered text instead of duplicating the layout knowledge.
 */

import type { PLCDataType, PLCVariableType } from '../../../middleware/shared/ports/types'

function renderVariableType(type: PLCVariableType): string {
  return type.value
}

function renderEnumeratedLines(dt: Extract<PLCDataType, { derivation: 'enumerated' }>): string[] {
  const values = dt.values.map((v) => v.description).join(', ')
  const initial = dt.initialValue ? ` := ${dt.initialValue}` : ''
  return [`  ${dt.name} : (${values})${initial};`]
}

function renderStructureLines(dt: Extract<PLCDataType, { derivation: 'structure' }>): string[] {
  const fieldLines = dt.variable.map((v) => {
    const init = v.initialValue?.simpleValue?.value ? ` := ${v.initialValue.simpleValue.value}` : ''
    return `    ${v.name} : ${renderVariableType(v.type)}${init};`
  })
  return [`  ${dt.name} : STRUCT`, ...fieldLines, `  END_STRUCT;`]
}

function renderArrayLines(dt: Extract<PLCDataType, { derivation: 'array' }>): string[] {
  const dims = dt.dimensions.map((d) => `[${d.dimension}]`).join('')
  const initial = dt.initialValue ? ` := ${dt.initialValue}` : ''
  return [`  ${dt.name} : ARRAY ${dims} OF ${renderVariableType(dt.baseType)}${initial};`]
}

function renderDataTypeLines(dt: PLCDataType): string[] {
  if (dt.derivation === 'enumerated') return renderEnumeratedLines(dt)
  if (dt.derivation === 'structure') return renderStructureLines(dt)
  if (dt.derivation === 'array') return renderArrayLines(dt)
  // Future derivations: skip rather than throwing so a new type
  // shape doesn't take the whole LSP sync down with it.
  return []
}

/**
 * Entry shape returned by `serializeDataTypesToLines`.  Each entry
 * carries the data-type name plus the exact number of lines its
 * declaration occupies inside the rendered `TYPE…END_TYPE` block.
 *
 * `goto-definition-redirect` consumes this to translate an LSP-line
 * back into the owning data type — without re-implementing the
 * line-span rules, which would silently drift the moment the
 * serializer's layout changes (e.g. a blank line between fields).
 */
export interface SerializedDataTypeEntry {
  /** The data type's name as it appears on the declaration line. */
  name: string
  /** Rendered lines for this entry (no `TYPE` / `END_TYPE` framing). */
  lines: string[]
}

/**
 * Serialise every entry as the building block for both the flat
 * string (`serializeDataTypesToST`) and the line-aware redirect
 * map.  Entries that render to zero lines (unknown derivation) are
 * dropped — they contribute nothing to the LSP document and no
 * cursor can land inside them.
 */
export function serializeDataTypesToLines(dataTypes: PLCDataType[]): SerializedDataTypeEntry[] {
  const out: SerializedDataTypeEntry[] = []
  for (const dt of dataTypes) {
    const lines = renderDataTypeLines(dt)
    if (lines.length === 0) continue
    out.push({ name: dt.name, lines })
  }
  return out
}

/**
 * Serialise every entry in `dataTypes` to a single ST `TYPE` block.
 * Returns `''` when there's nothing to emit — the LSP sync layer
 * uses that to short-circuit document creation.
 *
 * Derives its output from `serializeDataTypesToLines` so the flat
 * text and the line map stay in lockstep.
 */
export function serializeDataTypesToST(dataTypes: PLCDataType[]): string {
  const entries = serializeDataTypesToLines(dataTypes)
  if (entries.length === 0) return ''
  const body = entries.flatMap((e) => e.lines).join('\n')
  return `TYPE\n${body}\nEND_TYPE\n`
}
