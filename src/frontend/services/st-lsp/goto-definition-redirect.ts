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

import type { PLCDataType, PLCGlobalVariableList } from '../../../middleware/shared/ports/types'
import { sanitizeAxisName, softMotionAxisNames } from '../../../middleware/shared/utils/ethercat'
import { openPLCStoreBase } from '../../store'
import { CreateEditorObjectFromTab } from '../../store/slices/tabs/utils'
import { isDataTypeFilesEnabled } from '../../utils/feature-flags'
import { dataTypeLineSpans } from '../../utils/PLC/data-type-serializer'
import { serializeGlobalVariableListsToTypes } from '../../utils/PLC/global-variable-list-serializer'
import { getBodyLineOffset } from '../lsp-shared/body-offsets'
import { normaliseLocation, routeToPou, routeToPouBody, routeToPouPreamble } from '../lsp-shared/definition-redirect'
import {
  DATA_TYPES_URI,
  DT_VIEW_FRAME_LINE_COUNT,
  GLOBAL_VARIABLE_LISTS_URI,
  parsePouUri,
  RESOURCE_GLOBALS_URI,
  SOFTMOTION_GLOBALS_URI,
} from './types'

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
function findDataTypeAtLine(
  lspLine: number,
  dataTypes: PLCDataType[],
): { dataType: PLCDataType; lineInEntry: number } | null {
  // Synthesised doc: line 0 is `TYPE`, entries start at line 1.
  if (lspLine < 1) return null
  const byName = new Map(dataTypes.map((dt) => [dt.name, dt]))
  for (const [name, span] of dataTypeLineSpans(dataTypes)) {
    if (lspLine >= span.start && lspLine < span.start + span.length) {
      const dataType = byName.get(name)
      return dataType ? { dataType, lineInEntry: lspLine - span.start } : null
    }
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

/**
 * Open the type's tab in code mode at a Monaco position in its `.dt`
 * view. Falls back to the form tab when the code view isn't built into
 * this release.
 */
function routeToDataTypeCodeView(dataType: PLCDataType, monacoLine: number, monacoColumn: number): boolean {
  if (!openDataTypeEditor(dataType)) return false
  if (!isDataTypeFilesEnabled()) return true
  const {
    editorActions: { setEditorCursor, updateModelStructureForName },
  } = openPLCStoreBase.getState()
  updateModelStructureForName(dataType.name, { display: 'code' })
  setEditorCursor(dataType.name, {
    lineNumber: monacoLine,
    column: monacoColumn,
    offset: 0,
    target: 'data-type',
  })
  return true
}

/**
 * Open the EtherCAT device (drive) editor for `deviceId` on `busName`, mirroring
 * the project-tree click path. Used to redirect go-to-definition on a SoftMotion
 * axis to its drive configuration screen instead of the synthesised globals doc.
 */
function openDeviceEditor(name: string, busName: string, deviceId: string): boolean {
  const tabProps: Parameters<typeof CreateEditorObjectFromTab>[0] = {
    name,
    path: `/devices/remote/${busName}/devices/${deviceId}`,
    elementType: { type: 'ethercat-device', busName, deviceId },
  }
  const {
    editorActions: { setEditor, addModel, getEditorFromEditors },
    tabsActions: { updateTabs, setSelectedTab },
  } = openPLCStoreBase.getState()
  updateTabs(tabProps)
  const existing = getEditorFromEditors(name)
  if (existing) {
    addModel(existing)
    setEditor(existing)
  } else {
    const model = CreateEditorObjectFromTab(tabProps)
    addModel(model)
    setEditor(model)
  }
  setSelectedTab(name)
  return true
}

/**
 * Redirect a go-to-definition landing in the synthesised SoftMotion axis-globals
 * document to the drive that owns the axis. The document is a bare `VAR_GLOBAL`
 * block: line 0 is `VAR_GLOBAL`, line N (1-based) is axis N-1 — the same order
 * as `softMotionAxisNames`. Returns false when the line doesn't map to an axis
 * or no drive matches (caller falls back to Monaco's default).
 */
function redirectSoftMotionAxis(lspLine: number): boolean {
  if (lspLine < 1) return false
  const data = openPLCStoreBase.getState().project.data
  const axisName = softMotionAxisNames(data)[lspLine - 1]
  if (!axisName) return false
  for (const rd of data.remoteDevices ?? []) {
    if (rd.protocol !== 'ethercat') continue
    for (const dev of rd.ethercatConfig?.devices ?? []) {
      if (sanitizeAxisName(dev.name) === axisName) {
        return openDeviceEditor(dev.name, rd.name, dev.id)
      }
    }
  }
  return false
}

/**
 * Open the Resource editor (where configuration-level globals are declared),
 * mirroring the project-tree click path. Used to redirect go-to-definition on a
 * user global to the globals table instead of the synthesised globals doc.
 */
function openResourceEditor(): boolean {
  const tabProps: Parameters<typeof CreateEditorObjectFromTab>[0] = {
    name: 'Resource',
    path: '/data/configuration/resource',
    elementType: { type: 'resource' },
  }
  const {
    editorActions: { setEditor, addModel, getEditorFromEditors },
    tabsActions: { updateTabs, setSelectedTab },
  } = openPLCStoreBase.getState()
  updateTabs(tabProps)
  const existing = getEditorFromEditors('Resource')
  if (existing) {
    addModel(existing)
    setEditor(existing)
  } else {
    const model = CreateEditorObjectFromTab(tabProps)
    addModel(model)
    setEditor(model)
  }
  setSelectedTab('Resource')
  return true
}

/**
 * Open a Global Variable List's editor, mirroring the project-tree click path.
 */
function openGlobalVariableListEditor(name: string): boolean {
  const tabProps: Parameters<typeof CreateEditorObjectFromTab>[0] = {
    name,
    path: `/data/global-variables/${name}`,
    elementType: { type: 'global-variable-list' },
  }
  const {
    editorActions: { setEditor, addModel, getEditorFromEditors },
    tabsActions: { updateTabs, setSelectedTab },
  } = openPLCStoreBase.getState()
  updateTabs(tabProps)
  const existing = getEditorFromEditors(name)
  if (existing) {
    addModel(existing)
    setEditor(existing)
  } else {
    const model = CreateEditorObjectFromTab(tabProps)
    addModel(model)
    setEditor(model)
  }
  setSelectedTab(name)
  return true
}

/**
 * Which list owns each line of the synthesized Global-Variable-Lists document.
 *
 * Ownership is POSITIONAL, and derived from the same serializers that produce the document —
 * each list's own block is re-serialized to learn how many lines it takes — so the map cannot
 * drift from the text, and adding a list or a member cannot silently shift it.
 *
 * Positional is also the only correct reading. A member line (`Output1 : BOOL;`) and an
 * instance line (`GVL : GVL_TYPE;`) are the same shape, so resolving by name would send a
 * definition on a member that happens to be called `MyGlobalList` to the list of that name
 * instead of to the list the member is declared in. The frame lines — `TYPE`, `END_STRUCT;`,
 * `END_TYPE`, `VAR_GLOBAL`, `END_VAR` — belong to no list and map to `undefined`, so a
 * position on one is reported as unresolved rather than as the nearest list.
 */
function globalVariableListLineOwners(lists: PLCGlobalVariableList[]): (string | undefined)[] {
  const withMembers = lists.filter((list) => list.variables.length > 0)
  if (withMembers.length === 0) return []

  const owners: (string | undefined)[] = [undefined] // TYPE
  for (const list of withMembers) {
    // `TYPE`, the block, `END_STRUCT;`, `END_TYPE`, `''` — keep the block and its END_STRUCT.
    const block = serializeGlobalVariableListsToTypes([list]).split('\n').slice(1, -2)
    block.forEach((_line, index) => owners.push(index === block.length - 1 ? undefined : list.name))
  }
  owners.push(undefined) // END_TYPE

  owners.push(undefined) // VAR_GLOBAL
  // One instance line per list, in this order — the serializer filters the same way.
  for (const list of withMembers) owners.push(list.name)
  owners.push(undefined) // END_VAR

  return owners
}

/**
 * Global-Variable-Lists doc → open the list's own editor rather than the synthesised
 * (non-editable) STRUCT and instance declarations.
 *
 * Monaco has no editor host for that URI, so without this the redirect dead-ends silently —
 * the same trap the data-types branch documents.
 */
function redirectGlobalVariableList(lineLsp: number): boolean {
  const lists = openPLCStoreBase.getState().project.data.globalVariableLists ?? []
  const name = globalVariableListLineOwners(lists)[lineLsp]
  if (!name) return false
  return openGlobalVariableListEditor(name)
}

export function redirectDefinitionToStore(loc: Location | LocationLink): boolean {
  const target = normaliseLocation(loc)

  // Resource-globals doc → open the Resource editor (globals table) rather than
  // the synthesised (non-editable) CONFIGURATION declaration.
  if (target.uri === RESOURCE_GLOBALS_URI) {
    return openResourceEditor()
  }

  // SoftMotion axis globals doc → open the owning drive's config screen rather
  // than the synthesised (non-editable) global declaration.
  if (target.uri === SOFTMOTION_GLOBALS_URI) {
    return redirectSoftMotionAxis(target.lineLsp)
  }

  // Global-Variable-Lists doc → open the list's editor.
  if (target.uri === GLOBAL_VARIABLE_LISTS_URI) {
    return redirectGlobalVariableList(target.lineLsp)
  }

  // Datatypes URI → open the matching data-type editor tab.  The LSP
  // emits this URI for every reference into the synthesised
  // TYPE…END_TYPE block (enum members, struct fields, array element
  // types).  Monaco has no editor host for that URI, so without this
  // branch the redirect would dead-end silently.
  if (target.uri === DATA_TYPES_URI) {
    const dataTypes = openPLCStoreBase.getState().project.data.dataTypes
    const hit = findDataTypeAtLine(target.lineLsp, dataTypes)
    if (!hit) return false
    // Entry-relative line → `.dt` view line (its own `TYPE` frame sits
    // above the entry) → Monaco's 1-indexed frame.
    return routeToDataTypeCodeView(
      hit.dataType,
      hit.lineInEntry + DT_VIEW_FRAME_LINE_COUNT + 1,
      target.characterLsp + 1,
    )
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
