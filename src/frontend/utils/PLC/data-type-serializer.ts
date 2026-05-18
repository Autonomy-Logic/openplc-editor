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
 */

import type { PLCDataType, PLCVariableType } from '../../../middleware/shared/ports/types'

function renderVariableType(type: PLCVariableType): string {
  return type.value
}

function renderEnumerated(dt: Extract<PLCDataType, { derivation: 'enumerated' }>): string {
  const values = dt.values.map((v) => v.description).join(', ')
  const initial = dt.initialValue ? ` := ${dt.initialValue}` : ''
  return `  ${dt.name} : (${values})${initial};`
}

function renderStructure(dt: Extract<PLCDataType, { derivation: 'structure' }>): string {
  const fields = dt.variable
    .map((v) => {
      const init = v.initialValue?.simpleValue?.value ? ` := ${v.initialValue.simpleValue.value}` : ''
      return `    ${v.name} : ${renderVariableType(v.type)}${init};`
    })
    .join('\n')
  return `  ${dt.name} : STRUCT\n${fields}\n  END_STRUCT;`
}

function renderArray(dt: Extract<PLCDataType, { derivation: 'array' }>): string {
  const dims = dt.dimensions.map((d) => `[${d.dimension}]`).join('')
  const initial = dt.initialValue ? ` := ${dt.initialValue}` : ''
  return `  ${dt.name} : ARRAY ${dims} OF ${renderVariableType(dt.baseType)}${initial};`
}

/**
 * Serialise every entry in `dataTypes` to a single ST `TYPE` block.
 * Returns `''` when there's nothing to emit — the LSP sync layer
 * uses that to short-circuit document creation.
 */
export function serializeDataTypesToST(dataTypes: PLCDataType[]): string {
  if (dataTypes.length === 0) return ''
  const entries = dataTypes
    .map((dt) => {
      if (dt.derivation === 'enumerated') return renderEnumerated(dt)
      if (dt.derivation === 'structure') return renderStructure(dt)
      if (dt.derivation === 'array') return renderArray(dt)
      // Future derivations: skip rather than throwing so a new type
      // shape doesn't take the whole LSP sync down with it.
      return ''
    })
    .filter((line) => line.length > 0)
  if (entries.length === 0) return ''
  return `TYPE\n${entries.join('\n')}\nEND_TYPE\n`
}
