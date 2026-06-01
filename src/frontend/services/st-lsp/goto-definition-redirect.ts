// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Go-to-definition redirect for ST's variable declarations and
 * cross-POU targets.
 *
 * The ST LSP returns positions in the *full* serialised document
 * — the synthesised POU declaration line + VAR blocks + body —
 * but Monaco's body editor only displays the body, and the VAR
 * blocks live in the variables panel.  Letting Monaco navigate
 * to a preamble position clamps the cursor to body line 1.
 *
 * What this file owns:
 *
 *   - ST-only URI parsing.  `pou://`, `stub://`, and the
 *     synthesised datatypes URI all live here; the shared layer
 *     never has to know about ST's URI schemes.
 *   - The datatypes-URI redirect (clicking on a struct field or
 *     enum member, which strucpp resolves into the synthesised
 *     `TYPE … END_TYPE` doc).  Python has no analogue.
 *
 * What it delegates to `lsp-shared/definition-redirect`:
 *
 *   - `routeToPou(name)` — open the POU's tab.
 *   - `routeToPouPreamble(name, line, col)` — open + switch
 *     variables panel to code mode + place the cursor.
 *   - `routeToPouBody(name, line, col)` — open + place body
 *     cursor.
 *
 * Returns `true` when navigation was handled here (caller cancels
 * Monaco's default).  Returns `false` for URIs this file can't
 * resolve (unknown scheme, missing POU, datatypes line out of
 * range) so the caller can fall back to Monaco's default.
 */

import type { Location, LocationLink } from 'vscode-languageserver-protocol'

import type { PLCDataType } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import { CreateEditorObjectFromTab } from '../../store/slices/tabs/utils'
import { serializeDataTypesToLines } from '../../utils/PLC/data-type-serializer'
import { getBodyLineOffset } from '../lsp-shared/body-offsets'
import { normaliseLocation, routeToPou, routeToPouBody, routeToPouPreamble } from '../lsp-shared/definition-redirect'
import { DATA_TYPES_URI, parsePouUri } from './types'

/**
 * Map an LSP line in the synthesised datatypes document to the
 * `PLCDataType` whose entry occupies that line.  Returns null when
 * the line falls on the `TYPE` / `END_TYPE` framing lines or beyond
 * the last entry — caller treats that as "not navigable".
 *
 * The line spans are sourced directly from
 * `serializeDataTypesToLines` so this stays in lockstep with the
 * serialiser's actual layout — no more hand-maintained per-shape
 * line counts that drift the moment a new field separator or
 * derivation lands on disk.
 */
function findDataTypeAtLine(lspLine: number, dataTypes: PLCDataType[]): PLCDataType | null {
  // Synthesised doc: line 0 is `TYPE`, entries start at line 1.
  if (lspLine < 1) return null
  const entries = serializeDataTypesToLines(dataTypes)
  const byName = new Map(dataTypes.map((dt) => [dt.name, dt]))
  let cursor = 1
  for (const entry of entries) {
    const span = entry.lines.length
    if (lspLine >= cursor && lspLine < cursor + span) {
      return byName.get(entry.name) ?? null
    }
    cursor += span
  }
  return null
}

/**
 * Open the Data Type editor for `dataType`, mirroring the
 * project-tree click path (updateTabs + addModel + setEditor +
 * setSelectedTab).  Lives here rather than in the shared layer
 * because Python has no datatype concept and the shape (`type:
 * 'data-type'` tab + `derivation`) is ST-specific.
 */
function openDataTypeEditor(dataType: PLCDataType): boolean {
  const tabProps: Parameters<typeof CreateEditorObjectFromTab>[0] = {
    name: dataType.name,
    path: '',
    elementType: { type: 'data-type', derivation: dataType.derivation },
  }
  const {
    editorActions: { setEditor, addModel, getEditorFromEditors },
    tabsActions: { updateTabs, setSelectedTab },
  } = openPLCStoreBase.getState()
  updateTabs(tabProps)
  const existing = getEditorFromEditors(dataType.name)
  if (existing) {
    addModel(existing)
    setEditor(existing)
  } else {
    const model = CreateEditorObjectFromTab(tabProps)
    addModel(model)
    setEditor(model)
  }
  setSelectedTab(dataType.name)
  return true
}

export function redirectDefinitionToStore(loc: Location | LocationLink): boolean {
  const target = normaliseLocation(loc)

  // Datatypes URI → open the matching data-type editor tab.  The LSP
  // emits this URI for every reference into the synthesised
  // TYPE…END_TYPE block (enum members, struct fields, array element
  // types).  Monaco has no editor host for that URI, so without this
  // branch the redirect would dead-end silently.
  if (target.uri === DATA_TYPES_URI) {
    const dataTypes = openPLCStoreBase.getState().project.data.dataTypes
    const dt = findDataTypeAtLine(target.lineLsp, dataTypes)
    if (!dt) return false
    openDataTypeEditor(dt)
    return true
  }

  const parsed = parsePouUri(target.uri)
  if (!parsed) return false

  const bodyOffset = getBodyLineOffset(target.uri)
  // LSP line 0 of any POU's synthesised doc is the `PROGRAM` /
  // `FUNCTION` / `FUNCTION_BLOCK` declaration — that's where strucpp
  // points "Go to Definition" for a POU type name reference (e.g.
  // clicking on `Manual_Override` in `inst : Manual_Override;`).
  // Variable declarations sit on LSP lines 1..bodyOffset-1.  Treating
  // line 0 the same as a variable would force the target POU's
  // variables panel into text mode with no useful position to land
  // on — and on first open the panel renders empty because the
  // VariablesEditor state initialises from an empty `tableData`.
  // Open the tab and let the editor settle into its natural default
  // (variables in table mode, cursor at body line 1).
  if (target.lineLsp === 0) return routeToPou(parsed.name)

  if (target.lineLsp < bodyOffset) {
    // Preamble target.  The variables-code-editor renders only the
    // VAR blocks (the synthesised declaration line is not part of
    // its model).  Subtract 1 (the declaration's single line) to
    // translate LSP 0-indexed line → variables editor LSP frame,
    // then +1 to get Monaco's 1-indexed line.  Net: lspLine - 1 + 1
    // = lspLine.
    return routeToPouPreamble(parsed.name, target.lineLsp, target.characterLsp + 1)
  }

  // Body target — shift the LSP line into Monaco's body-relative
  // frame.
  return routeToPouBody(parsed.name, target.lineLsp - bodyOffset + 1, target.characterLsp + 1)
}
