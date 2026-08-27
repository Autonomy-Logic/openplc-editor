import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PLCRemoteDevice } from '../../../../middleware/shared/ports/types'
import { isValidIecIdentifier } from '../../../../middleware/shared/utils/ethercat'
import { findAllReferencesToDataType } from '../../../utils/data-type-references'
import type { DataTypeReferenceImpactAnalysis } from '../../../utils/data-type-references/types'
import { parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
import { hasLegacyInOutOutputHandle } from '../../../utils/graphical/in-out-pin-rules'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../../../utils/graphical/sync-nodes-with-variables'
import { isLegalIdentifier } from '../../../utils/keywords'
import { findGlobalVariableListReferences } from '../../../utils/PLC/global-variable-list-references'
import { globalVariableListTypeName } from '../../../utils/PLC/global-variable-list-serializer'
import { restampFlowLibraryVariants } from '../../../utils/PLC/restamp-library-variants'
import { collectAllSlaveNames, generateUniqueSlaveName } from '../../../utils/unique-slave-name'
import type { FBDFlowType } from '../fbd'
import type { FileSliceDataObject } from '../file'
import type { LadderFlowType } from '../ladder'
import type { TabsProps } from '../tabs'
import {
  CreateEditorObjectFromTab,
  CreateGlobalVariableListEditor,
  CreateRemoteDeviceEditor,
  CreateServerEditor,
  LIBRARY_MANIFEST_TAB_NAME,
} from '../tabs/utils'
import { cancelFlowWriteBacks, flushFlowWriteBacks } from './flow-writeback'
import type { PouHistorySnapshot, SharedRootState, SharedSlice } from './types'
import {
  createDatatypeObject,
  createEditorObjectForDatatype,
  createEditorObjectForPou,
  createPouObject,
  guessDatatypeDerivation,
} from './utils'

const MAX_HISTORY_SIZE = 50

function deleteElement(
  state: SharedRootState,
  name: string,
  deleteFromProject: (name: string) => void,
  afterDelete?: (name: string) => void,
) {
  deleteFromProject(name)
  state.editorActions.removeModel(name)
  state.fileActions.removeFile({ name })
  state.tabsActions.removeTab(name)
  afterDelete?.(name)

  const currentEditor = state.editor
  if (currentEditor.type !== 'available' && currentEditor.meta.name === name) {
    state.editorActions.clearEditor()
  }

  // A delete is an unsaved structural change (the file removal is queued in
  // `pendingDeletions`). Flag the workspace dirty so it persists ONLY on the
  // next save — identical on web and desktop. The file entry is already gone,
  // so mark the workspace directly rather than via a file-scoped helper.
  state.workspaceActions.setEditingState('unsaved')

  return { ok: true as const }
}

/**
 * Reject element names that aren't valid IEC 61131-3 identifiers before they
 * reach the file-path / parser layer. A name containing a space, slash, or
 * backslash would otherwise be written straight into the on-disk POU path
 * (`pous/<folder>/<name>.st`) and — on any parse failure — read back as the
 * path itself, corrupting the name and orphaning files (the "deleting function"
 * bug). Reuses the same primitive as variable-name validation for consistency.
 */
function validateElementName(name: string): { ok: true } | { ok: false; message: string } {
  const [legal, reason] = isLegalIdentifier(name)
  return legal ? { ok: true } : { ok: false, message: `'${name}' ${reason}` }
}

/**
 * Data type names are compared case-insensitively: each one becomes a
 * `datatypes/<Name>.dt` path, and macOS/Windows fold filename case, so
 * `Foo` and `foo` would silently overwrite each other on save. IEC
 * identifiers are case-insensitive anyway.
 */
const nameMatches = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * A raw datatypes/<Name>.dt file that failed to parse still owns its
 * name: letting a new data type take it would make the save emit two
 * specs for one path (and the raw echo would win). Case-insensitive —
 * the file name is the identity and common filesystems fold case.
 */
function collidesWithUnparsedDataTypeFile(state: SharedRootState, name: string): { ok: boolean; message?: string } {
  const collides = state.unparsedDataTypeFiles.some(
    (f) => f.relativePath.split('/').pop()?.replace(/\.dt$/i, '').toLowerCase() === name.toLowerCase(),
  )
  return collides
    ? {
        ok: false,
        message: `A data type file named "${name}.dt" exists on disk but could not be read — fix or remove it first`,
      }
    : { ok: true }
}

/**
 * Post-propagation bookkeeping for a confirmed data type rename:
 *
 *   1. Flag every touched container's file dirty — single-file save and the
 *      close-project check read these flags, and the propagated content
 *      would otherwise be silently dropped on disk.
 *   2. Regenerate code-mode variable buffers of affected POUs. `sanitizePou`
 *      persists `editor.variable.code` as the authoritative variables block,
 *      so a stale buffer would resurrect the old type name on save.
 *   3. Regenerate the `.dt` code buffers of affected data types — committing
 *      a stale buffer (commitCode → updateDatatype) would do the same.
 *   4. Regenerate the code buffer of any affected Global Variable List, which
 *      is only ever edited as text and so is nothing but a buffer.
 */
function syncAfterDatatypePropagation(state: SharedRootState, impact: DataTypeReferenceImpactAnalysis): void {
  const dirtyFiles = new Set<string>()
  const affectedPous = new Set<string>()
  const affectedDatatypes = new Set<string>()
  const affectedLists = new Set<string>()
  for (const ref of impact.references) {
    // Global variables persist through the Resource entry in the file slice.
    dirtyFiles.add(ref.kind === 'global-variable' ? 'Resource' : ref.container)
    if (ref.kind === 'pou-variable') affectedPous.add(ref.container)
    if (ref.kind === 'data-type-field' || ref.kind === 'data-type-base-type') affectedDatatypes.add(ref.container)
    if (ref.kind === 'global-variable-list-member') affectedLists.add(ref.container)
  }
  for (const name of dirtyFiles) {
    state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)
  }

  // No-op for types whose code view isn't active.
  for (const datatypeName of affectedDatatypes) {
    state.projectActions.regenerateDatatypeText(datatypeName)
  }

  for (const listName of affectedLists) {
    state.projectActions.regenerateGlobalVariableListText(listName)
  }

  for (const pouName of affectedPous) {
    const model = state.editor.meta.name === pouName ? state.editor : state.editors.find((e) => e.meta.name === pouName)
    if (!model || (model.type !== 'plc-textual' && model.type !== 'plc-graphical')) continue
    if (model.variable.display !== 'code') continue
    const pou = state.project.data.pous.find((p) => p.name === pouName)
    /* istanbul ignore next -- defensive: a pou-variable reference implies the POU exists */
    if (!pou) continue
    state.editorActions.updateModelVariablesForName(pouName, {
      display: 'code',
      code: generateIecVariablesToString(pou.interface?.variables ?? []),
    })
  }
}

/**
 * Why a Global Variable List may not be called `name`, or `null` when it may.
 *
 * A list occupies TWO symbols, not one: the instance keeps the user's name, and the
 * struct backing it takes `<name>_TYPE`. Both land in the same global namespace as
 * every POU and data type — IEC gives types and variables one namespace — so a list
 * called after a POU, or one whose derived type name is already a data type, is a
 * duplicate symbol the compiler reports against a name the user never typed. Checking
 * only against other lists covered one half of a rule with two.
 *
 * `ignoring` is the list being renamed: a rename onto its own name, or a case-only
 * change, must not collide with itself.
 */
function globalVariableListNameCollision(state: SharedRootState, name: string, ignoring?: string): string | null {
  if (ignoring !== undefined && nameMatches(name, ignoring)) return null

  const derived = globalVariableListTypeName(name)
  const lists = state.project.data.globalVariableLists ?? []

  if (lists.some((list) => !nameMatches(list.name, ignoring ?? '') && nameMatches(list.name, name))) {
    return 'Global variable list name already exists'
  }
  if (state.project.data.pous.some((pou) => nameMatches(pou.name, name))) {
    return `"${name}" is already the name of a POU`
  }
  if (state.project.data.dataTypes.some((dataType) => nameMatches(dataType.name, name))) {
    return `"${name}" is already the name of a data type`
  }
  // A `.dt` that failed to parse still owns its `files[name]` entry — the registry is
  // keyed by raw name across every kind — so a list taking the same name would share
  // that entry and misroute its save. `datatypeActions` gates on this for the same
  // reason; the check belongs here too.
  const unparsedCollision = collidesWithUnparsedDataTypeFile(state, name)
  if (!unparsedCollision.ok) return unparsedCollision.message ?? `"${name}" is already taken by a data type file`
  if (state.project.data.dataTypes.some((dataType) => nameMatches(dataType.name, derived))) {
    return `"${name}" needs the type name "${derived}", which a data type already uses`
  }
  if (state.project.data.pous.some((pou) => nameMatches(pou.name, derived))) {
    return `"${name}" needs the type name "${derived}", which a POU already uses`
  }
  if (
    lists.some(
      (list) => !nameMatches(list.name, ignoring ?? '') && nameMatches(globalVariableListTypeName(list.name), derived),
    )
  ) {
    return `"${name}" needs the type name "${derived}", which another global variable list already uses`
  }
  return null
}

/**
 * Give a duplicated remote device its own identity.
 *
 * A remote device is an IEC address producer, so a plain copy is not a duplicate — it is
 * a second claim on everything the original already owns:
 *
 *   - `id` on every Modbus IO group / point and every EtherCAT slave is what the editors,
 *     the file registry and `ethercatDeviceActions` key on. Two devices sharing one would
 *     have edits to the copy land on the original.
 *   - `alias` is intended to be unique system-wide, and the registry reports a repeat as
 *     a duplicate (first wins). The copy starts unaliased, so the user names what they
 *     actually intend to bind.
 *   - `iecLocation` is editor-allocated from the address pool. Clearing it lets the next
 *     recalculation hand the copy its own addresses instead of double-booking the
 *     original's.
 *
 * Everything else — host, port, cycle times, PDO layouts, SDO startup parameters, CiA 402
 * axis config — is what the user duplicated the device for, and is copied verbatim.
 */
function duplicateRemoteDeviceIdentity(device: PLCRemoteDevice, takenSlaveNames: Set<string>): PLCRemoteDevice {
  const next: PLCRemoteDevice = { ...device }

  if (next.modbusTcpConfig) {
    next.modbusTcpConfig = {
      ...next.modbusTcpConfig,
      ioGroups: (next.modbusTcpConfig.ioGroups ?? []).map((group) => ({
        ...group,
        id: crypto.randomUUID(),
        ioPoints: (group.ioPoints ?? []).map((point) => ({
          ...point,
          id: crypto.randomUUID(),
          iecLocation: '',
          alias: undefined,
        })),
      })),
    }
  }

  if (next.ethercatConfig) {
    // A slave's NAME is its key in tabs, editor models and the file registry — not its
    // id — so two slaves sharing one means the second silently takes over the first's
    // entries. `generateUniqueSlaveName` is the same `_01`, `_02`… strategy the add
    // path uses; `taken` grows as we go so the copies do not collide with each other
    // either.
    const taken = new Set(takenSlaveNames)
    next.ethercatConfig = {
      ...next.ethercatConfig,
      devices: (next.ethercatConfig.devices ?? []).map((slave) => {
        const name = generateUniqueSlaveName(slave.name, taken)
        taken.add(name)
        return {
          ...slave,
          id: crypto.randomUUID(),
          name,
          channelMappings: (slave.channelMappings ?? []).map((mapping) => ({
            ...mapping,
            iecLocation: '',
            alias: undefined,
          })),
        }
      }),
    }
  }

  return next
}

function renameElement(
  state: SharedRootState,
  oldName: string,
  newName: string,
  updateInProject: (oldName: string, newName: string) => { ok: boolean; message?: string } | void,
  afterRename?: (oldName: string, newName: string) => void,
) {
  const nameCheck = validateElementName(newName)
  if (!nameCheck.ok) return { ok: false as const, message: nameCheck.message }

  const result = updateInProject(oldName, newName)
  if (result && !result.ok) return { ok: false as const, message: result.message }

  state.editorActions.updateEditorName(oldName, newName)
  state.fileActions.updateFile({ name: oldName, newName })
  state.tabsActions.updateTabName(oldName, newName)

  // Rekey the per-language graphical-flow slices.  Ladder + FBD store
  // their canvas state (rungs, nodes, edges) in a separate Zustand
  // slice keyed by POU name; without this rekey, a renamed LD/FBD POU
  // would render an empty canvas in the editor and a subsequent save
  // would overwrite the on-disk body with the empty in-memory state
  // (data loss).  The rename actions are no-ops when no entry
  // matches `oldName`, so it's safe to fire unconditionally — only
  // LD/FBD POUs will have a flow entry to rekey.
  state.ladderFlowActions.renameLadderFlow(oldName, newName)
  state.fbdFlowActions.renameFBDFlow(oldName, newName)

  // Follow the undo/redo stacks to the new key — otherwise the history is
  // orphaned under the old name and undo becomes a silent no-op after rename.
  state.snapshotActions.renameHistory(oldName, newName)

  afterRename?.(oldName, newName)

  // A rename is an unsaved structural change — flag it dirty (the renamed file
  // now lives under `newName`) so it persists ONLY on the next save, identical
  // on web and desktop.
  state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(newName)

  return { ok: true as const }
}

const createSharedSlice: StateCreator<SharedRootState, [], [], SharedSlice> = (setState, getState) => ({
  undoRedo: {},
  pendingDatatypeRename: null,

  pouActions: {
    create: ({ type, name, language }) => {
      const state = getState()
      const existing = state.project.data.pous.find((p) => p.name === name)
      if (existing) return { ok: false, message: 'POU already exists' }

      const nameCheck = validateElementName(name)
      if (!nameCheck.ok) return nameCheck

      const pouDto = createPouObject({ type, name, language })
      const result = state.projectActions.createPou(pouDto)
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      // Seed the graphical-flow slice for new LD/FBD POUs. The project
      // slice owns the persisted body (rungs/nodes/edges); the per-
      // language flow slice is what the editor reads to render. Without
      // this, the FBD editor falls through to "No rung found for editor"
      // and ladder shows a bare canvas. handleOpenProjectResponse does
      // the same on project load — this matches it for create.
      if (language === 'ld') {
        state.ladderFlowActions.addLadderFlow(pouDto.data.body.value as LadderFlowType)
      } else if (language === 'fbd') {
        state.fbdFlowActions.addFBDFlow(pouDto.data.body.value as FBDFlowType)
      }

      const editorModel = createEditorObjectForPou(name, type, language)
      state.editorActions.addModel(editorModel)

      state.fileActions.addFile({ name, type, filePath: name, isNew: true })

      state.tabsActions.updateTabs({
        name,
        elementType: { type, language },
      })
      state.tabsActions.setSelectedTab(name)
      state.editorActions.setEditor(editorModel)

      state.libraryActions.addLibrary(name, type === 'program' ? 'function' : type)

      // Mark project as unsaved
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'pou' })
    },

    delete: (name) =>
      deleteElement(
        getState(),
        name,
        (n) => getState().projectActions.deletePou(n),
        (n) => getState().libraryActions.removeUserLibrary(n),
      ),

    rename: (oldName, newName) => {
      const state = getState()
      const existing = state.project.data.pous.find((p) => p.name === newName)
      if (existing) return { ok: false, message: 'POU name already exists' }

      return renameElement(
        state,
        oldName,
        newName,
        (o, n) => {
          state.projectActions.updatePouName(o, n)
        },
        (o, n) => state.libraryActions.updateLibraryName(o, n),
      )
    },

    duplicate: (sourceName, newName) => {
      const state = getState()
      const sourcePou = state.project.data.pous.find((p) => p.name === sourceName)
      if (!sourcePou) return { ok: false, message: 'Source POU not found' }

      const existing = state.project.data.pous.find((p) => p.name === newName)
      if (existing) return { ok: false, message: 'POU name already exists' }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      // Create a copy of the POU with the new name
      const language = sourcePou.body.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
      const pouDto = createPouObject({ type: sourcePou.pouType, name: newName, language })

      // Copy the source POU's content into the new DTO
      pouDto.data.body = { ...sourcePou.body }
      pouDto.data.variables = sourcePou.interface?.variables ? [...sourcePou.interface.variables] : []
      pouDto.data.documentation = sourcePou.documentation ?? ''
      if (sourcePou.pouType === 'function' && 'returnType' in pouDto.data) {
        pouDto.data.returnType = sourcePou.interface?.returnType ?? 'BOOL'
      }

      const result = state.projectActions.createPou(pouDto)
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      // Seed the graphical-flow slice for the duplicated POU. Mirrors
      // the create-path so a duplicated LD/FBD POU's editor finds its
      // rungs/nodes immediately instead of rendering empty.  The body
      // value was shallow-copied from the source, so its `name` field
      // still refers to `sourceName` — override it so the flow lands
      // under the new POU's name (the editor's lookup key).
      if (language === 'ld') {
        state.ladderFlowActions.addLadderFlow({
          ...(pouDto.data.body.value as LadderFlowType),
          name: newName,
        })
      } else if (language === 'fbd') {
        state.fbdFlowActions.addFBDFlow({
          ...(pouDto.data.body.value as FBDFlowType),
          name: newName,
        })
      }

      const editorModel = createEditorObjectForPou(newName, sourcePou.pouType, language)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name: newName, type: sourcePou.pouType, filePath: newName, isNew: true })

      // Persist only on save: flag the new POU dirty instead of auto-saving.
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(newName)

      return { ok: true }
    },
  },

  globalVariableListActions: {
    /**
     * Create a list and open it, which is what every other element on the + button does —
     * the user's next action is always to fill it in.
     */
    create: (name) => {
      const state = getState()
      // Collision before validation, matching `datatypeActions` above: the more
      // specific message is the more useful one when a name fails both.
      const collision = globalVariableListNameCollision(state, name)
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(name)
      if (!nameCheck.ok) return nameCheck

      const result = state.projectActions.createGlobalVariableList(name)
      /* istanbul ignore next -- defensive: the collision gate above already ran */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = CreateGlobalVariableListEditor(name)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name, type: 'global-variable-list', filePath: name, isNew: true })
      state.tabsActions.updateTabs({ name, elementType: { type: 'global-variable-list' } })
      state.tabsActions.setSelectedTab(name)
      state.editorActions.setEditor(editorModel)
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', {
        name,
        elementType: 'global-variable-list',
      })
    },

    delete: (name) => deleteElement(getState(), name, (n) => getState().projectActions.deleteGlobalVariableList(n)),

    /**
     * Rename the list AND every `<oldName>.member` that qualifies against it.
     *
     * Renaming the list alone used to leave each reference pointing at a name that no
     * longer existed, with nothing said at rename time: the `VAR_EXTERNAL` is only
     * emitted for lists a POU actually mentions, so the reference just stopped
     * resolving and the failure landed much later, in the compiler.
     */
    rename: (oldName, newName) => {
      const state = getState()
      const collision = globalVariableListNameCollision(state, newName, oldName)
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      // Fold the code view's pending buffer in first, exactly as the data type rename
      // does — otherwise the regenerate at the end writes the pre-edit declaration
      // back over whatever the user had just typed.
      const reconcile = state.projectActions.reconcileGlobalVariableListText(oldName)
      if (!reconcile.ok) return { ok: false, message: reconcile.message }

      if (newName !== oldName) {
        // Land any debounced graphical write-back BEFORE the scan. A pending one
        // means `pou.body.value` is momentarily stale, so the rewrite would miss
        // references the user has already drawn — and the timer would then fire
        // over the rewritten body with the pre-rename flow.
        //
        // A write-back that FAILS validation leaves the body stale for good, so the
        // scan and the re-seed would both run on pre-edit content and the re-seed
        // would overwrite the newer flow. Refuse, as undo and redo already do,
        // rather than rename against a body that is known to be wrong.
        const staleFlows = flushFlowWriteBacks(getState)
        if (staleFlows.length > 0) {
          return {
            ok: false,
            message: `The graphical body of ${staleFlows.join(', ')} is invalid, so references to "${oldName}" could not be rewritten. Fix it and rename again.`,
          }
        }

        const fresh = getState()
        const impact = findGlobalVariableListReferences(oldName, fresh.project.data.pous)
        if (impact.totalReferences > 0) {
          fresh.projectActions.propagateGlobalVariableListRename(oldName, newName)

          for (const pouName of impact.byPou.keys()) {
            // Dirty, or the propagated body never reaches disk.
            getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState(pouName)

            // Re-seed the live flow from the rewritten body. The graphical editors
            // read the flow slice, not `pou.body.value`, so without this the old
            // name stays on screen and the next write-back copies it back over the
            // rename — undoing it silently.
            const pou = getState().project.data.pous.find((p) => p.name === pouName)
            if (pou?.body.language === 'ld') {
              const flow = structuredClone(pou.body.value) as LadderFlowType
              getState().ladderFlowActions.addLadderFlow({ ...flow, name: pouName })
            }
            if (pou?.body.language === 'fbd') {
              const flow = structuredClone(pou.body.value) as FBDFlowType
              getState().fbdFlowActions.addFBDFlow({ ...flow, name: pouName })
            }
          }
        }
      }

      const result = renameElement(state, oldName, newName, (o, n) => {
        state.projectActions.updateGlobalVariableListName(o, n)
      })
      // Only now are the list and its model both keyed by newName.
      if (result.ok) getState().projectActions.regenerateGlobalVariableListText(newName)
      return result
    },

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = (state.project.data.globalVariableLists ?? []).find((l) => nameMatches(l.name, sourceName))
      if (!source) return { ok: false, message: 'Global variable list not found' }

      const collision = globalVariableListNameCollision(state, newName)
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      // Fold any pending code-view buffer in first, or the copy is taken from the
      // declaration as it stood before the user's last edits.
      const reconcile = state.projectActions.reconcileGlobalVariableListText(sourceName)
      if (!reconcile.ok) return { ok: false, message: reconcile.message }

      // One action that clones the whole record, rather than create-then-patch each
      // field. Copying field by field is how `documentation` and a preserved,
      // unparsed `text` got dropped — the same omission this PR already fixed once
      // in `reconcileGlobalVariableListText`. A list carries no ids or addresses, so
      // a clone under a new name is the entire duplicate.
      const created = getState().projectActions.duplicateGlobalVariableList(sourceName, newName)
      /* istanbul ignore next -- defensive: the collision gate above already ran */
      if (!created.ok) return { ok: false, message: created.message }

      const editorModel = CreateGlobalVariableListEditor(newName)
      getState().editorActions.addModel(editorModel)
      getState().fileActions.addFile({ name: newName, type: 'global-variable-list', filePath: newName, isNew: true })
      getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState(newName)

      return { ok: true }
    },
  },

  datatypeActions: {
    create: ({ name, derivation }) => {
      const state = getState()
      const existing = state.project.data.dataTypes.find((d) => nameMatches(d.name, name))
      if (existing) return { ok: false, message: 'Data type already exists' }

      const fileCollision = collidesWithUnparsedDataTypeFile(state, name)
      if (!fileCollision.ok) return fileCollision

      const nameCheck = validateElementName(name)
      if (!nameCheck.ok) return nameCheck

      const datatype = createDatatypeObject({ name, derivation })
      const result = state.projectActions.createDatatype({ data: datatype })
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = createEditorObjectForDatatype(name, derivation)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name, type: 'data-type', filePath: name, isNew: true })

      state.tabsActions.updateTabs({
        name,
        elementType: { type: 'data-type', derivation },
      })
      state.tabsActions.setSelectedTab(name)
      state.editorActions.setEditor(editorModel)

      // Mark project as unsaved
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'datatype' })
    },

    delete: (name) => deleteElement(getState(), name, (n) => getState().projectActions.deleteDatatype(n)),

    rename: async (oldName, newName) => {
      const state = getState()
      // Includes the type being renamed: a case-only change writes the
      // new file and then deletes the old path — the same file where
      // the filesystem folds case.
      const collides = newName !== oldName && state.project.data.dataTypes.some((d) => nameMatches(d.name, newName))
      if (collides) return { ok: false, message: 'Data type name already exists' }

      const fileCollision = collidesWithUnparsedDataTypeFile(state, newName)
      if (!fileCollision.ok) return fileCollision

      const datatype = state.project.data.dataTypes.find((d) => d.name === oldName)
      if (!datatype) return { ok: false, message: 'Data type not found' }

      // renameElement validates too, but checked up front so the impact
      // modal never opens for a rename that would fail afterwards.
      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      // Fold pending code-view edits in first, so the rename doesn't
      // regenerate over them — and so the reference scan sees them.
      const reconcile = state.projectActions.reconcileDatatypeText(oldName)
      if (!reconcile.ok) return { ok: false, message: reconcile.message }

      if (newName !== oldName) {
        const freshState = getState()
        const impact = findAllReferencesToDataType(
          oldName,
          freshState.project.data.pous,
          freshState.project.data.configurations.resource.globalVariables,
          freshState.project.data.dataTypes,
          freshState.project.data.globalVariableLists ?? [],
        )
        if (impact.totalReferences > 0) {
          // Overwriting a pending request would drop its resolver and strand
          // the first caller's await forever (e.g. Enter + blur double-fire).
          if (getState().pendingDatatypeRename) {
            return { ok: false, message: 'Another data type rename is awaiting confirmation' }
          }
          const confirmed = await new Promise<boolean>((resolve) => {
            setState({ pendingDatatypeRename: { oldName, newName, impact, resolve } })
          })
          if (!confirmed) return { ok: false, cancelled: true, message: 'Rename cancelled' }
          getState().projectActions.propagateDatatypeRename(oldName, newName)
          syncAfterDatatypePropagation(getState(), impact)
        }
      }

      const result = renameElement(getState(), oldName, newName, () => {
        // Renames via the dedicated action so the old .dt path gets
        // queued for deletion — a plain updateDatatype would strand
        // the old file on disk.
        getState().projectActions.updateDatatypeName(oldName, newName)
      })
      // Only after renameElement are the type and its model both keyed by newName.
      if (result.ok) getState().projectActions.regenerateDatatypeText(newName)
      return result
    },

    respondToPendingRename: (confirmed) => {
      const pending = getState().pendingDatatypeRename
      if (!pending) return
      setState({ pendingDatatypeRename: null })
      pending.resolve(confirmed)
    },

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = state.project.data.dataTypes.find((d) => d.name === sourceName)
      if (!source) return { ok: false, message: 'Data type not found' }

      const existing = state.project.data.dataTypes.find((d) => nameMatches(d.name, newName))
      if (existing) return { ok: false, message: 'Data type name already exists' }

      const fileCollision = collidesWithUnparsedDataTypeFile(state, newName)
      if (!fileCollision.ok) return fileCollision

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      const copy = { ...source, name: newName }
      const result = state.projectActions.createDatatype({ data: copy })
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = createEditorObjectForDatatype(newName, source.derivation)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name: newName, type: 'data-type', filePath: newName, isNew: true })

      // Persist only on save: flag the new datatype dirty instead of auto-saving.
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(newName)

      return { ok: true }
    },
  },

  serverActions: {
    create: ({ name, protocol }) => {
      const state = getState()
      /* istanbul ignore next -- defensive: servers is always initialized as [] */
      const servers = state.project.data.servers ?? []
      if (servers.some((s) => s.name === name)) return { ok: false, message: 'Server already exists' }

      const nameCheck = validateElementName(name)
      if (!nameCheck.ok) return nameCheck

      const result = state.projectActions.createServer({ data: { name, protocol } })
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = CreateServerEditor(name, protocol)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name, type: 'server', filePath: name, isNew: true })
      state.tabsActions.updateTabs({ name, elementType: { type: 'server', protocol } })
      state.tabsActions.setSelectedTab(name)
      state.editorActions.setEditor(editorModel)

      // Mark project as unsaved
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'server' })
    },

    delete: (name) => deleteElement(getState(), name, (n) => getState().projectActions.deleteServer(n)),

    rename: (oldName, newName) =>
      renameElement(getState(), oldName, newName, (o, n) => getState().projectActions.updateServerName(o, n)),

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = (state.project.data.servers ?? []).find((s) => s.name === sourceName)
      if (!source) return { ok: false, message: 'Server not found' }

      if ((state.project.data.servers ?? []).some((s) => nameMatches(s.name, newName))) {
        return { ok: false, message: 'Server name already exists' }
      }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      // Deep-cloned: the protocol config is nested, and a shallow copy would leave the
      // two servers sharing it, so editing one would silently edit the other.
      const copy = { ...structuredClone(source), name: newName }
      const result = state.projectActions.createServer({ data: copy })
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = CreateServerEditor(newName, source.protocol)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name: newName, type: 'server', filePath: newName, isNew: true })

      // Persist only on save, exactly as the data type duplicate does.
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(newName)

      return { ok: true }
    },
  },

  remoteDeviceActions: {
    create: ({ name, protocol }) => {
      const state = getState()
      /* istanbul ignore next -- defensive: remoteDevices is always initialized as [] */
      const devices = state.project.data.remoteDevices ?? []
      if (devices.some((d) => d.name === name)) return { ok: false, message: 'Remote device already exists' }

      const nameCheck = validateElementName(name)
      if (!nameCheck.ok) return nameCheck

      const result = state.projectActions.createRemoteDevice({ data: { name, protocol } })
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = CreateRemoteDeviceEditor(name, protocol)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name, type: 'remote-device', filePath: name, isNew: true })
      state.tabsActions.updateTabs({ name, elementType: { type: 'remote-device', protocol } })
      state.tabsActions.setSelectedTab(name)
      state.editorActions.setEditor(editorModel)

      // Mark project as unsaved
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'remote-device' })
    },

    delete: (name) => {
      // Cascade: purge EtherCAT children first so their tabs, editor
      // models, and file entries are cleaned up before the bus vanishes
      // from the tree. Without this step the children survive the
      // parent delete as orphan state.
      const state = getState()
      const bus = state.project.data.remoteDevices?.find((d) => d.name === name)
      const children = bus?.protocol === 'ethercat' ? (bus.ethercatConfig?.devices ?? []) : []
      // Snapshot ids — ethercatDeviceActions.delete mutates the same
      // array via updateEthercatConfig, so iterating the live array
      // would skip every second child.
      for (const childId of children.map((d) => d.id)) {
        state.ethercatDeviceActions.delete(name, childId)
      }
      return deleteElement(getState(), name, (n) => getState().projectActions.deleteRemoteDevice(n))
    },

    rename: (oldName, newName) =>
      renameElement(getState(), oldName, newName, (o, n) => getState().projectActions.updateRemoteDeviceName(o, n)),

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = (state.project.data.remoteDevices ?? []).find((d) => d.name === sourceName)
      if (!source) return { ok: false, message: 'Remote device not found' }

      if ((state.project.data.remoteDevices ?? []).some((d) => nameMatches(d.name, newName))) {
        return { ok: false, message: 'Remote device name already exists' }
      }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      const copy = {
        ...duplicateRemoteDeviceIdentity(
          structuredClone(source),
          collectAllSlaveNames(state.project.data.remoteDevices),
        ),
        name: newName,
      }
      const result = state.projectActions.createRemoteDevice({ data: copy })
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = CreateRemoteDeviceEditor(newName, source.protocol)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name: newName, type: 'remote-device', filePath: newName, isNew: true })

      // Persist only on save, exactly as the data type duplicate does.
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(newName)

      return { ok: true }
    },
  },

  ethercatDeviceActions: {
    delete: (busName, deviceId) => {
      const state = getState()
      const remoteDevice = state.project.data.remoteDevices?.find((d) => d.name === busName)
      if (!remoteDevice) return { ok: false, message: 'Bus not found' }

      const device = remoteDevice.ethercatConfig?.devices?.find((d) => d.id === deviceId)
      if (!device) return { ok: false, message: 'EtherCAT device not found' }

      const deviceName = device.name
      state.projectActions.updateEthercatConfig(busName, {
        masterConfig: remoteDevice.ethercatConfig?.masterConfig ?? {
          networkInterface: 'eth0',
          cycleTimeUs: 1000,
          watchdogTimeoutCycles: 3,
        },
        devices: (remoteDevice.ethercatConfig?.devices ?? []).filter((d) => d.id !== deviceId),
      })
      state.editorActions.removeModel(deviceName)
      state.tabsActions.removeTab(deviceName)
      // EtherCAT children are registered in the file slice on project
      // load (see register files for save-state tracking). Drop the
      // entry here so it doesn't linger when the child is removed
      // directly or via a bus cascade.
      state.fileActions.removeFile({ name: deviceName })

      const currentEditor = state.editor
      if (currentEditor.type !== 'available' && currentEditor.meta.name === deviceName) {
        state.editorActions.clearEditor()
      }

      return { ok: true }
    },

    rename: (busName, deviceId, newName) => {
      const state = getState()
      const remoteDevice = state.project.data.remoteDevices?.find((d) => d.name === busName)
      if (!remoteDevice) return { ok: false, message: 'Bus not found' }

      const devices = remoteDevice.ethercatConfig?.devices ?? []
      const device = devices.find((d) => d.id === deviceId)
      if (!device) return { ok: false, message: 'EtherCAT device not found' }

      const oldName = device.name
      // A SoftMotion drive's name IS the axis variable name emitted into
      // generated code, so it must be a valid IEC identifier (no spaces,
      // hyphens, or leading digits).
      if (device.cia402?.enabled && !isValidIecIdentifier(newName)) {
        return {
          ok: false,
          message: `"${newName}" is not a valid axis name. Use letters, digits, and underscores, starting with a letter or underscore.`,
        }
      }
      // Only *rejecting* enforcement of slave-name uniqueness — scan-bus add
      // auto-suffixes instead. Tabs/editor/file slices are name-keyed and break
      // silently on duplicates, so new write paths must replicate one strategy.
      // Same-name rename is allowed (the action stays idempotent).
      if (newName !== oldName && collectAllSlaveNames(state.project.data.remoteDevices).has(newName)) {
        return { ok: false, message: `An EtherCAT slave named "${newName}" already exists in this project` }
      }
      const updatedDevices = devices.map((d) => (d.id === deviceId ? { ...d, name: newName } : d))
      state.projectActions.updateEthercatConfig(busName, {
        masterConfig: remoteDevice.ethercatConfig?.masterConfig ?? {
          networkInterface: 'eth0',
          cycleTimeUs: 1000,
          watchdogTimeoutCycles: 3,
        },
        devices: updatedDevices,
      })
      state.editorActions.updateEditorName(oldName, newName)
      state.tabsActions.updateTabName(oldName, newName)
      // Rekey the file slice entry so save-state tracking follows the rename
      // instead of orphaning the old name when the slave is first-class.
      state.fileActions.updateFile({ name: oldName, newName })

      return { ok: true }
    },
  },

  sharedWorkspaceActions: {
    handleFileAndWorkspaceSavedState: (name) => {
      const { file } = getState().fileActions.getFile({ name })
      if (!file) {
        console.warn(`File with name ${name} does not exist.`)
        return
      }

      if (file.saved) {
        getState().fileActions.updateFile({ name, saved: false })
      }

      if (getState().workspace.editingState !== 'unsaved') {
        getState().workspaceActions.setEditingState('unsaved')
      }
    },

    closeFile: (name) => {
      // Tabs that don't persist any project data (Package Manager,
      // Library Manager browsing view, ...) never register a file
      // entry. Treat their absence from the file slice as "nothing
      // to save" — otherwise getSavedState's `?? false` default
      // would route them through the save-changes modal, and the
      // subsequent "Save" path would fail with "File not found"
      // because executeSaveFile has nothing to write.
      const fileExists = getState().files[name] !== undefined
      if (fileExists) {
        const isSaved = getState().fileActions.getSavedState({ name })
        if (!isSaved) {
          getState().modalActions.openModal('save-changes-file', { fileName: name })
          return { success: false }
        }
      }

      return getState().sharedWorkspaceActions.forceCloseFile(name)
    },

    forceCloseFile: (name) => {
      getState().tabsActions.removeTab(name)
      // Drop the editor model from `state.editors[]` so the workspace's
      // multi-mount loop doesn't keep rendering a hidden editor for a
      // closed tab.  `tabs[]` is the open-tabs list; `editors[]` is
      // expected to mirror it.  `removeModel` is idempotent for names
      // that aren't registered.
      getState().editorActions.removeModel(name)

      const filteredTabs = getState().tabs
      const nextTab = filteredTabs[filteredTabs.length - 1]
      if (!nextTab) {
        getState().editorActions.setEditor({ type: 'available', meta: { name: '' } })
        getState().tabsActions.setSelectedTab('')
        getState().workspaceActions.setSelectedProjectTreeLeaf({ label: '', type: null })
        return { success: true }
      }

      const editor = getState().editorActions.getEditorFromEditors(nextTab.name) || CreateEditorObjectFromTab(nextTab)
      getState().editorActions.setEditor(editor)
      getState().tabsActions.setSelectedTab(nextTab.name)
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: nextTab.name,
        // A diff-viewer tab has no corresponding project-tree leaf to
        // highlight, so it maps to `null` rather than a tree leaf type.
        type: nextTab.elementType.type === 'diff-viewer' ? null : nextTab.elementType.type,
      })

      return { success: true }
    },

    closeProject: () => {
      const editingState = getState().workspace.editingState
      const isFilesSaved = getState().fileActions.checkIfAllFilesAreSaved()

      if (!isFilesSaved || editingState === 'unsaved') {
        getState().modalActions.openModal('save-changes-project', {
          validationContext: 'close-project',
        })
        return { pendingConfirmation: true }
      }
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
      return { pendingConfirmation: false }
    },

    clearStatesOnCloseProject: () => {
      getState().editorActions.clearEditor()
      getState().tabsActions.clearTabs()
      getState().libraryActions.clearUserLibraries()
      getState().fbdFlowActions.clearFBDFlows()
      getState().ladderFlowActions.clearLadderFlows()
      getState().projectActions.clearProjects()
      getState().deviceActions.clearDeviceDefinitions()
      getState().workspaceActions.clearWorkspace()
      getState().fileActions.clearFiles()
      getState().consoleActions.clearLogs()
      getState().historyActions.clearHistory()
      getState().searchActions.clearSearch()
      getState().modalActions.closeModal()
      getState().versionControlActions.clearVersionControlState()
      // Drop the active conversation pointer + its loaded messages so the
      // chat doesn't bleed across project switches. The project-scoped
      // conversation list is refetched separately on project_id change
      // (see IndexPage's effect).
      getState().aiActions.clearConversation()
    },

    handleOpenProjectResponse: (data) => {
      // A write-back scheduled against the previous project must not fire
      // into the one being opened (project load flips `updated` flags as a
      // side effect, which would let a stale timer persist a fresh flow).
      cancelFlowWriteBacks()
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
      getState().workspaceActions.setEditingState('saved')
      // Any in-place reload (branch switch, restore, discard, stash) can move
      // HEAD, so drop the cached HEAD snapshot used by source-control diffs;
      // it refetches lazily on the next diff open.
      getState().versionControlActions.setHeadContent(null)
      // Apply the persist-permission flag from the backend.  `canEdit ===
      // false` ⇒ the viewer can't push changes back (e.g. a public project
      // they don't own), so backend writes (save/commit/branch) are gated;
      // `true` or `undefined` ⇒ full write access.  Only persistence is
      // affected — in-memory editing, simulation, and compilation stay on.
      getState().workspaceActions.setCanEdit(data.canEdit !== false)

      // Log any parsing warnings to the app console (after clear so they aren't wiped)
      if (data.warnings) {
        for (const message of data.warnings) {
          getState().consoleActions.addLog({ id: crypto.randomUUID(), level: 'warning', message })
        }
      }

      // Set project data (setting meta.path triggers navigation from start to workspace)
      getState().projectActions.setProject({
        meta: data.meta,
        data: data.projectData,
      })
      // Raw .dt files that failed to parse — stashed so saves echo
      // them back verbatim; always set so a reopen clears stale ones.
      getState().projectActions.setUnparsedDataTypeFiles(data.unparsedDataTypeFiles ?? [])
      // The bytes as loaded, for the save flow to echo back for files the user does not
      // touch. Always set, for the same reason as the line above: a reopen must not inherit
      // the previous project's map. Empty for a reader with no separate notion of "as
      // loaded" — a project on disk — which reads the same as nothing to echo.
      getState().versionControlActions.setRawLoadedContent(data.rawLoadedFiles ?? {})

      // Unreadable files have no PLCDataType, so no tree leaf to click.
      const unparsedDataTypes = (data.unparsedDataTypeFiles ?? []).flatMap((file) => {
        const name = file.relativePath.split('/').pop()?.replace(/\.dt$/i, '')
        if (!name) return []
        // The file registry is keyed by raw name across every kind: a colliding
        // file would retype the real element and misroute its save. Global
        // variable lists are registered there too, so they exclude a name as
        // much as a POU or a data type does.
        const taken = [
          ...data.projectData.pous,
          ...data.projectData.dataTypes,
          ...(data.projectData.globalVariableLists ?? []),
        ].some((element) => element.name.toLowerCase() === name.toLowerCase())
        if (taken) return []
        return [{ name, content: file.content, derivation: guessDatatypeDerivation(file.content) }]
      })

      // Add ladder and FBD flows for graphical POUs.
      //
      // The flow object embeds its own `name` field — historically the
      // load path trusted that name verbatim, but a rename bug in the
      // editor (since fixed) could leave a project on disk where the
      // POU header says one name and the body's `name` field still
      // holds the pre-rename value.  When that drift exists, the
      // ladder editor's `find(f => f.name === pou.name)` lookup
      // misses and the canvas renders empty even though the rungs
      // are on disk.
      //
      // Defend against it here by always keying the flow under
      // `pou.name`.  Projects saved with the new (consistent) rename
      // path see no change in behaviour; projects with the legacy
      // drift auto-recover on first open.
      const pous = data.projectData.pous

      // Refresh placed library-block variant types from the current libraries
      // before the flows enter the store, so existing projects pick up library
      // type changes (e.g. ADR: ULINT -> __XWORD). Blocks backed by a
      // user-defined POU are skipped — the project owns their interface. A
      // no-op when the libraries haven't loaded yet or nothing is stale.
      const systemLibraries = getState().libraries.system
      const userPouNames = pous.filter((pou) => pou.pouType !== 'program').map((pou) => pou.name)
      let restampedCount = 0
      // POUs holding a block still drawn with the old two-sided VAR_IN_OUT pin. Counted, never
      // converted: the fix rewires the diagram, so it belongs to the block's update badge and
      // not to project load. Reporting it here is the only signal the user would otherwise get,
      // since the badge itself needs a hover to appear.
      //
      // Split by whether the block is backed by a POU in this project, because only those can
      // actually be converted: the update badge resolves a block's interface through
      // `libraries.user`, so a block provided by a library (oscat-basic's LIST_*, softmotion's
      // MC_* Axis pins) has no badge and stays as it is. Promising a badge that will not appear
      // would be worse than saying nothing.
      const convertibleInOutPous = new Set<string>()
      const libraryInOutBlocks = new Set<string>()

      const scanLegacyInOut = (nodes: unknown[] | undefined, pouName: string): void => {
        for (const node of nodes ?? []) {
          if (!hasLegacyInOutOutputHandle(node as Parameters<typeof hasLegacyInOutOutputHandle>[0])) continue
          const name = (node as { data?: { variant?: { name?: string } } }).data?.variant?.name
          if (name !== undefined && userPouNames.includes(name)) convertibleInOutPous.add(pouName)
          else if (name !== undefined) libraryInOutBlocks.add(name)
        }
      }

      pous.forEach((pou) => {
        if (pou.body.language === 'ld') {
          // The loaded project data is frozen, so clone before re-stamping
          // (which mutates variant types in place) and hand the store the copy.
          const bodyValue = structuredClone(pou.body.value) as LadderFlowType
          restampedCount += restampFlowLibraryVariants([bodyValue], systemLibraries, userPouNames)
          for (const rung of bodyValue.rungs ?? []) scanLegacyInOut(rung.nodes, pou.name)
          getState().ladderFlowActions.addLadderFlow({ ...bodyValue, name: pou.name })
        }
        if (pou.body.language === 'fbd') {
          const bodyValue = structuredClone(pou.body.value) as FBDFlowType
          restampedCount += restampFlowLibraryVariants([bodyValue], systemLibraries, userPouNames)
          scanLegacyInOut(bodyValue.rung?.nodes, pou.name)
          getState().fbdFlowActions.addFBDFlow({ ...bodyValue, name: pou.name })
        }
      })

      if (restampedCount > 0) {
        getState().consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Refreshed ${restampedCount} library block pin type(s) from the current library definitions.`,
        })
      }

      if (convertibleInOutPous.size > 0) {
        getState().consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message:
            `A VAR_IN_OUT parameter is now drawn as a single input-side pin. ` +
            `${convertibleInOutPous.size === 1 ? 'POU' : 'POUs'} ${[...convertibleInOutPous].join(', ')} ` +
            `still ${convertibleInOutPous.size === 1 ? 'contains' : 'contain'} blocks drawn the old way, ` +
            `with a pin on both sides. Hover such a block and click its update badge to convert it — ` +
            `nothing is changed until you do.`,
        })
      }

      if (libraryInOutBlocks.size > 0) {
        getState().consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message:
            `${[...libraryInOutBlocks].sort().join(', ')}: this project places library blocks with a ` +
            `VAR_IN_OUT parameter that were drawn with a pin on both sides. They keep the extra pin, ` +
            `which no longer accepts new connections; existing connections and the generated code are ` +
            `unaffected.`,
        })
      }

      // Register user-defined functions/function-blocks in the library
      pous.forEach((pou) => {
        if (pou.pouType !== 'program') {
          getState().libraryActions.addLibrary(pou.name, pou.pouType)
        }
      })

      // Hydrate the library slice's project view from the durable
      // `project.libraries` field (if any).  Bundled / canonical
      // libs are always-on regardless and don't appear here; only
      // opt-in libraries flow through this path.  Drives the
      // missing-libraries modal post-open.
      const projectLibraryRefs = (data.projectData.libraries ?? []).map((ref) => ({
        name: ref.name,
        version: ref.version,
      }))
      getState().libraryActions.setProjectLibraries(projectLibraryRefs)

      // If the project references libraries the system pool can't
      // currently resolve, surface the missing-libraries modal so
      // the user can route through the Library Manager.  Project
      // load itself is non-blocking — compile will fail later with
      // a clear error if they don't install the missing pieces.
      if (getState().missingLibraries.length > 0) {
        getState().modalActions.openModal('missing-libraries')
      }

      // Reclassify ALL POUs' variables with full context.
      // The text parser can't determine type definitions accurately since it doesn't have
      // the full project context. Re-parse with pous, dataTypes, and libraries to correctly
      // classify FB instances as 'derived' vs structs as 'user-data-type'.
      {
        const reclassState = getState()
        const {
          project: {
            data: { dataTypes: reclassDataTypes },
          },
          libraries: reclassLibraries,
        } = reclassState

        pous.forEach((pou) => {
          try {
            /* istanbul ignore next -- defensive: interface may be undefined */
            const vars = pou.interface?.variables ?? []
            const iecString = generateIecVariablesToString(vars)
            const reparsedVariables = parseIecStringToVariables(iecString, pous, reclassDataTypes, reclassLibraries)
            getState().projectActions.setPouVariables({
              pouName: pou.name,
              variables: reparsedVariables,
            })
          } catch (err) {
            /* istanbul ignore next -- defensive: reclassify errors should not break project open */
            console.error(`[Reclassify] Failed to reclassify variables for POU "${pou.name}":`, err)
          }
        })
      }

      // Sync graphical POU nodes with reclassified variables
      {
        const ladderPous = pous.filter((pou) => pou.body.language === 'ld')
        const fbdPous = pous.filter((pou) => pou.body.language === 'fbd')
        const graphicalPous = [...ladderPous, ...fbdPous]
        if (graphicalPous.length) {
          const freshState = getState()
          const freshLadderFlows = freshState.ladderFlows
          const freshFBDFlows = freshState.fbdFlows
          const freshPous = freshState.project.data.pous
          const updateLadderNodes = freshState.ladderFlowActions.updateNodes
          const updateFBDNodes = freshState.fbdFlowActions.updateNodes

          try {
            ladderPous.forEach((pou) => {
              const freshPou = freshPous.find((p) => p.name === pou.name)
              /* istanbul ignore next -- defensive: freshPou always exists since we just loaded it */
              if (freshPou) {
                const pouFlow = freshLadderFlows.filter((flow) => flow.name === pou.name)
                /* istanbul ignore next -- defensive: flow always exists since we just added it */
                if (pouFlow.length > 0) {
                  syncNodesWithVariables(freshPou.interface?.variables ?? [], pouFlow, updateLadderNodes)
                }
              }
            })

            fbdPous.forEach((pou) => {
              const freshPou = freshPous.find((p) => p.name === pou.name)
              /* istanbul ignore next -- defensive: freshPou always exists since we just loaded it */
              if (freshPou) {
                const pouFlow = freshFBDFlows.filter((flow) => flow.name === pou.name)
                /* istanbul ignore next -- defensive: flow always exists since we just added it */
                if (pouFlow.length > 0) {
                  syncNodesWithVariablesFBD(freshPou.interface?.variables ?? [], pouFlow, updateFBDNodes)
                }
              }
            })
          } catch (err) {
            /* istanbul ignore next -- defensive: sync errors should not break project open */
            console.error('[SYNC] Error during node sync:', err)
          }
        }
      }

      // Set device definitions
      if (data.deviceConfiguration || data.devicePinMapping) {
        getState().deviceActions.setDeviceDefinitions({
          configuration: data.deviceConfiguration,
          pinMapping: data.devicePinMapping,
        })
      }

      // Restore debug flags from debugVariables
      // Since POU variables are saved as text files, debug flags are stored separately in project.json
      const debugVariables = data.projectData.debugVariables
      if (debugVariables) {
        // Restore global variable debug flags
        if (debugVariables.global && debugVariables.global.length > 0) {
          const globalVars = getState().project.data.configurations.resource.globalVariables
          debugVariables.global.forEach((varName) => {
            const varIndex = globalVars.findIndex((v) => v.name === varName)
            if (varIndex !== -1) {
              getState().projectActions.updateVariable({
                scope: 'global',
                rowId: varIndex,
                data: { debug: true },
              })
            }
          })
        }

        // Restore POU variable debug flags
        if (debugVariables.pous) {
          for (const [pouName, varNames] of Object.entries(debugVariables.pous)) {
            const pou = getState().project.data.pous.find((p) => p.name === pouName)
            if (pou) {
              /* istanbul ignore next -- defensive: interface may be undefined */
              const pouVars = pou.interface?.variables ?? []
              varNames.forEach((varName) => {
                const varIndex = pouVars.findIndex((v) => v.name === varName)
                if (varIndex !== -1) {
                  getState().projectActions.updateVariable({
                    scope: 'local',
                    associatedPou: pouName,
                    rowId: varIndex,
                    data: { debug: true },
                  })
                }
              })
            }
          }
        }
      }

      // Register files for save-state tracking
      const files: FileSliceDataObject = {}
      pous.forEach((pou) => {
        files[pou.name] = { type: pou.pouType, filePath: pou.name, saved: true }
      })
      data.projectData.dataTypes.forEach((dt) => {
        files[dt.name] = { type: 'data-type', filePath: dt.name, saved: true }
      })
      unparsedDataTypes.forEach(({ name }) => {
        files[name] = { type: 'data-type', filePath: name, saved: true }
      })
      // A loaded list needs its entry like anything else in the tree: dirty
      // tracking, the close-project check and the single-file save all read this
      // registry, so a list missing from it can be edited and never look unsaved.
      ;(data.projectData.globalVariableLists ?? []).forEach((list) => {
        files[list.name] = { type: 'global-variable-list', filePath: list.name, saved: true }
      })
      const servers = data.projectData.servers
      if (servers) {
        servers.forEach((s) => {
          files[s.name] = { type: 'server', filePath: s.name, saved: true }
        })
      }
      const remoteDevices = data.projectData.remoteDevices
      if (remoteDevices) {
        remoteDevices.forEach((d) => {
          files[d.name] = { type: 'remote-device', filePath: d.name, saved: true }
          // Register file entries for EtherCAT slave devices (children of the bus).
          // Keyed by slave.name to match how the rest of the file registry, tabs,
          // and editor models identify slaves. Rename flows in
          // `ethercatDeviceActions.rename` call `fileActions.updateFile({ name, newName })`
          // to rekey this entry so it never orphans.
          if (d.protocol === 'ethercat' && d.ethercatConfig?.devices) {
            for (const slave of d.ethercatConfig.devices) {
              files[slave.name] = { type: 'ethercat-device', filePath: d.name, saved: true }
            }
          }
        })
      }
      files['Resource'] = { type: 'resource', filePath: 'Resource', saved: true }
      files['Configuration'] = { type: 'device', filePath: 'Configuration', saved: true }
      getState().fileActions.setFiles({ files })

      // Open the default tab for the project type:
      //   - Library projects: the manifest (`library.json`) — it's
      //     mandatory for the build and there's no main POU to fall
      //     back to.
      //   - PLC projects: the `main` program if present (existing
      //     behaviour).
      if (data.meta.type === 'plc-library') {
        const tabToBeCreated: TabsProps = {
          name: LIBRARY_MANIFEST_TAB_NAME,
          path: '/library.json',
          elementType: { type: 'library-manifest' },
        }
        const model = CreateEditorObjectFromTab(tabToBeCreated)
        getState().editorActions.addModel(model)
        getState().editorActions.setEditor(model)
        getState().tabsActions.updateTabs(tabToBeCreated)
        getState().tabsActions.setSelectedTab(LIBRARY_MANIFEST_TAB_NAME)
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: LIBRARY_MANIFEST_TAB_NAME,
          type: 'library-manifest',
        })
      } else {
        // Auto-open a program POU on project load so the user lands on
        // an editable tab instead of an empty workspace.  Prefer one
        // named "main" (template default) when present, otherwise fall
        // back to the first program POU — users are free to rename or
        // delete "main", and the editor must not break for projects
        // that don't have it.
        const programPou =
          pous.find((p) => p.name === 'main' && p.pouType === 'program') ?? pous.find((p) => p.pouType === 'program')
        if (programPou) {
          const language = programPou.body.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
          const tabToBeCreated: TabsProps = {
            name: programPou.name,
            path: `/data/pous/program/${programPou.name}`,
            elementType: { type: 'program', language },
          }
          const model = CreateEditorObjectFromTab(tabToBeCreated)
          getState().editorActions.addModel(model)
          getState().editorActions.setEditor(model)
          getState().tabsActions.updateTabs(tabToBeCreated)
          getState().tabsActions.setSelectedTab(programPou.name)
          getState().workspaceActions.setSelectedProjectTreeLeaf({ label: programPou.name, type: 'program' })
        }
      }

      // For POUs with unparseable variables (variablesText present, variables empty),
      // pre-create editor models in code mode so the raw text is displayed when opened.
      pous.forEach((pou) => {
        const pouWithText = pou as typeof pou & { variablesText?: string }
        if (pouWithText.variablesText && (!pou.interface?.variables || pou.interface.variables.length === 0)) {
          const language = pou.body.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
          const model = createEditorObjectForPou(pou.name, pou.pouType, language)
          // Switch to code mode with the raw variable text
          /* istanbul ignore next -- defensive: model type may not include variable property */
          if ('variable' in model) {
            model.variable = { display: 'code', code: pouWithText.variablesText }
          }
          getState().editorActions.addModel(model)
          // The auto-open block above may already have added and activated a
          // default table-mode model for this POU (it prefers "main" — exactly
          // the POU most likely to carry the unparseable variables). `addModel`
          // no-ops on duplicates and `setEditor` early-returns when the name
          // matches the active editor, so neither can deliver the raw text to
          // an existing model — the code view would show an empty skeleton
          // instead of the preserved declarations. `updateModelVariablesForName`
          // updates whichever object holds the POU: the active editor or the
          // stored model.
          getState().editorActions.updateModelVariablesForName(pou.name, {
            display: 'code',
            code: pouWithText.variablesText,
          })
        }
      })

      // Same for a Global Variable List whose declaration did not parse when it was
      // last saved: open its tab on the preserved text, so the user lands on the thing
      // that needs fixing rather than on a re-serialisation of the members that
      // happened to parse before they broke it.
      ;(data.projectData.globalVariableLists ?? []).forEach((list) => {
        if (list.text === undefined) return
        getState().tabsActions.updateTabs({
          name: list.name,
          path: `/data/global-variables/${list.name}`,
          elementType: { type: 'global-variable-list' },
        })
        getState().editorActions.addModel(CreateGlobalVariableListEditor(list.name))
        getState().editorActions.updateModelStructureForName(list.name, { display: 'code', code: list.text })
      })

      // Tab included, and focus stays on the auto-opened POU above.
      unparsedDataTypes.forEach(({ name, content, derivation }) => {
        const tabToBeCreated: TabsProps = {
          name,
          path: `/data/data-types/${derivation}/${name}`,
          elementType: { type: 'data-type', derivation },
        }
        getState().tabsActions.updateTabs(tabToBeCreated)
        getState().editorActions.addModel(createEditorObjectForDatatype(name, derivation))
        getState().editorActions.updateModelStructureForName(name, { display: 'code', code: content })
      })

      // Reset all graphical flow updated flags at the very end of project open.
      // Various operations during load (syncNodesWithVariables, debug flag restoration,
      // tab opening) call updateNode which sets flow.updated = true as a side effect.
      // Since these are internal syncs (not user edits), reset all flags.
      for (const flow of getState().ladderFlows) {
        getState().ladderFlowActions.setFlowUpdated({ editorName: flow.name, updated: false })
      }
      for (const flow of getState().fbdFlows) {
        getState().fbdFlowActions.setFlowUpdated({ editorName: flow.name, updated: false })
      }

      // Alias self-upgrade pass runs in `deviceActions.setAvailableOptions`
      // once the workspace screen finishes board discovery — capabilities
      // depend on the active board info, which isn't loaded here yet.
    },
  },

  snapshotActions: {
    pushToHistory: (pouName, snapshot) => {
      setState(
        produce((state: SharedRootState) => {
          if (!state.undoRedo[pouName]) {
            state.undoRedo[pouName] = { past: [], future: [], savedAtDepth: 0 }
          }
          const history = state.undoRedo[pouName]
          // If the saved state was in the future (ahead of current), it's being discarded
          if (history.savedAtDepth !== null && history.savedAtDepth > history.past.length) {
            history.savedAtDepth = null
          }
          history.past.push(snapshot)
          if (history.past.length > MAX_HISTORY_SIZE) {
            history.past.shift()
            // Adjust savedAtDepth since we shifted the stack
            if (history.savedAtDepth !== null) {
              history.savedAtDepth--
              if (history.savedAtDepth < 0) history.savedAtDepth = null
            }
          }
          history.future = []
        }),
      )
    },

    renameHistory: (oldName, newName) => {
      setState(
        produce((state: SharedRootState) => {
          const history = state.undoRedo[oldName]
          if (!history) return
          delete state.undoRedo[oldName]
          state.undoRedo[newName] = history
        }),
      )
    },

    markSaved: (pouName) => {
      setState(
        produce((state: SharedRootState) => {
          const history = state.undoRedo[pouName]
          if (history) {
            history.savedAtDepth = history.past.length
          }
        }),
      )
    },

    markAllSaved: (except) => {
      setState(
        produce((state: SharedRootState) => {
          for (const [pouName, history] of Object.entries(state.undoRedo)) {
            if (except?.includes(pouName)) continue
            history.savedAtDepth = history.past.length
          }
        }),
      )
    },

    undo: (pouName) => {
      // A debounced graphical write-back may still be pending — flush it so
      // the redo snapshot below can't pair a stale body with a fresh flow.
      // A failed flush leaves the body stale, and capturing it would restore
      // the file to "saved" over content that never reached disk (DOPE-495).
      if (flushFlowWriteBacks(getState, pouName).length > 0) return false
      const state = getState()
      const history = state.undoRedo[pouName]
      if (!history || history.past.length === 0) return true

      const snapshot = history.past[history.past.length - 1]
      const pou = state.project.data.pous.find((p) => p.name === pouName)
      const dataType = pou ? undefined : state.project.data.dataTypes.find((d) => d.name === pouName)

      // Save current state to future. Plain references — the store is
      // immer-managed (frozen, copy-on-write), so later edits can never
      // reach a captured snapshot.
      let currentSnapshot: PouHistorySnapshot
      if (pou) {
        currentSnapshot = {
          variables: pou.interface?.variables ?? [],
          body: pou.body.value,
          ladderFlow: state.ladderFlows.find((f) => f.name === pouName),
          fbdFlow: state.fbdFlows.find((f) => f.name === pouName),
          globalVariables: state.project.data.configurations.resource.globalVariables,
        }
      } else if (dataType) {
        currentSnapshot = { variables: [], body: null, dataTypes: [dataType] }
      } else {
        return true
      }

      setState(
        produce((s: SharedRootState) => {
          const h = s.undoRedo[pouName]
          /* istanbul ignore next -- defensive: history verified above before produce */
          if (!h) return
          h.past.pop()
          h.future.push(currentSnapshot)
        }),
      )

      if (pou) {
        state.projectActions.applyPouSnapshot(pouName, snapshot.variables, {
          language: pou.body.language,
          value: snapshot.body,
        })
        if (snapshot.globalVariables) {
          state.projectActions.setGlobalVariables({ variables: snapshot.globalVariables })
        }
        // Restore graphical flow state (nodes, edges, positions)
        if (snapshot.ladderFlow) {
          state.ladderFlowActions.applyLadderFlowSnapshot({
            editorName: pouName,
            snapshot: snapshot.ladderFlow as LadderFlowType,
          })
        }
        if (snapshot.fbdFlow) {
          state.fbdFlowActions.applyFBDFlowSnapshot({ editorName: pouName, snapshot: snapshot.fbdFlow as FBDFlowType })
        }
      } else {
        const restoredDataType = snapshot.dataTypes?.[0]
        // Pin the name to the current key: snapshots taken before a rename
        // carry the old name, and restoring it would desync tabs/files/editors.
        if (restoredDataType) {
          state.projectActions.applyDatatypeSnapshot(pouName, { ...restoredDataType, name: pouName })
        }
      }

      // Check if we've returned to the saved state
      const afterUndo = getState().undoRedo[pouName]
      if (afterUndo?.savedAtDepth !== null && afterUndo?.savedAtDepth === afterUndo?.past.length) {
        getState().fileActions.updateFile({ name: pouName, saved: true })
      } else {
        // Diverged from the on-disk state — flag it or the next save-all skips the revert.
        getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState(pouName)
      }
      return true
    },

    redo: (pouName) => {
      // See undo — same pending write-back consistency requirement.
      if (flushFlowWriteBacks(getState, pouName).length > 0) return false
      const state = getState()
      const history = state.undoRedo[pouName]
      if (!history || history.future.length === 0) return true

      const snapshot = history.future[history.future.length - 1]
      const pou = state.project.data.pous.find((p) => p.name === pouName)
      const dataType = pou ? undefined : state.project.data.dataTypes.find((d) => d.name === pouName)

      // Save current state to past. Plain references — see undo.
      let currentSnapshot: PouHistorySnapshot
      if (pou) {
        currentSnapshot = {
          variables: pou.interface?.variables ?? [],
          body: pou.body.value,
          ladderFlow: state.ladderFlows.find((f) => f.name === pouName),
          fbdFlow: state.fbdFlows.find((f) => f.name === pouName),
          globalVariables: state.project.data.configurations.resource.globalVariables,
        }
      } else if (dataType) {
        currentSnapshot = { variables: [], body: null, dataTypes: [dataType] }
      } else {
        return true
      }

      setState(
        produce((s: SharedRootState) => {
          const h = s.undoRedo[pouName]
          /* istanbul ignore next -- defensive: history verified above before produce */
          if (!h) return
          h.future.pop()
          h.past.push(currentSnapshot)
        }),
      )

      if (pou) {
        state.projectActions.applyPouSnapshot(pouName, snapshot.variables, {
          language: pou.body.language,
          value: snapshot.body,
        })
        if (snapshot.globalVariables) {
          state.projectActions.setGlobalVariables({ variables: snapshot.globalVariables })
        }
        // Restore graphical flow state (nodes, edges, positions)
        if (snapshot.ladderFlow) {
          state.ladderFlowActions.applyLadderFlowSnapshot({
            editorName: pouName,
            snapshot: snapshot.ladderFlow as LadderFlowType,
          })
        }
        if (snapshot.fbdFlow) {
          state.fbdFlowActions.applyFBDFlowSnapshot({ editorName: pouName, snapshot: snapshot.fbdFlow as FBDFlowType })
        }
      } else {
        const restoredDataType = snapshot.dataTypes?.[0]
        // Pin the name to the current key: snapshots taken before a rename
        // carry the old name, and restoring it would desync tabs/files/editors.
        if (restoredDataType) {
          state.projectActions.applyDatatypeSnapshot(pouName, { ...restoredDataType, name: pouName })
        }
      }

      // Check if we've returned to the saved state
      const afterRedo = getState().undoRedo[pouName]
      if (afterRedo?.savedAtDepth !== null && afterRedo?.savedAtDepth === afterRedo?.past.length) {
        getState().fileActions.updateFile({ name: pouName, saved: true })
      } else {
        // Diverged from the on-disk state — flag it or the next save-all skips the revert.
        getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState(pouName)
      }
      return true
    },
  },
})

export { createSharedSlice }
