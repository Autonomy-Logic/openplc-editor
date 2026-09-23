import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PLCRemoteDevice } from '../../../../middleware/shared/ports/types'
import { isValidIecIdentifier } from '../../../../middleware/shared/utils/ethercat'
import { describeAliasRename } from '../../../../middleware/shared/utils/iec-address/normalize-aliases'
import { findAllReferencesToDataType } from '../../../utils/data-type-references'
import type { DataTypeReferenceImpactAnalysis } from '../../../utils/data-type-references/types'
import { buildTypeContext, parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
import { hasLegacyInOutOutputHandle } from '../../../utils/graphical/in-out-pin-rules'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../../../utils/graphical/sync-nodes-with-variables'
import { isLegalIdentifier } from '../../../utils/keywords'
import { newUuid } from '../../../utils/new-uuid'
import { findGlobalVariableListReferences } from '../../../utils/PLC/global-variable-list-references'
import { restampFlowBlockVariants } from '../../../utils/PLC/restamp-block-variants'
import { normalizeOneVariablePerLine } from '../../../utils/PLC/variable-declarations'
import { carryEditorMetadata } from '../../../utils/PLC/variable-metadata'
import { generateUniqueSlaveName, type NameTaken } from '../../../utils/unique-slave-name'
import type { FBDFlowType } from '../fbd'
import type { FileSliceDataObject } from '../file'
import type { LadderFlowType } from '../ladder'
import { validateVariableSet } from '../project/validation/variables'
import type { TabsProps } from '../tabs'
import {
  CreateEditorObjectFromTab,
  CreateGlobalVariableListEditor,
  CreateRemoteDeviceEditor,
  CreateServerEditor,
  LIBRARY_MANIFEST_TAB_NAME,
} from '../tabs/utils'
import { cancelFlowWriteBacks, flushFlowWriteBacks } from './flow-writeback'
import { elementNameCollision, nameMatches } from './name-collision'
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

  // The file entry is already gone, so flag the workspace dirty directly.
  state.workspaceActions.setEditingState('unsaved')

  return { ok: true as const }
}

function validateElementName(name: string): { ok: true } | { ok: false; message: string } {
  const [legal, reason] = isLegalIdentifier(name)
  return legal ? { ok: true } : { ok: false, message: `'${name}' ${reason}` }
}

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

  // `regenerateVariablesText` patches the POU's declaration text in place and
  // carries the result into an open code buffer. It is called rather than
  // serialising the model over the top, which was two defects at once: the
  // stored `variablesText` kept the OLD type name, so a toggle to code view and
  // back brought it straight back and the compile failed, and the buffer was
  // replaced with `generateIecVariablesToString(...)`, which is precisely the
  // comment loss this change exists to remove.
  for (const pouName of affectedPous) {
    state.projectActions.regeneratePouVariablesText(pouName)
  }
}

/** Fresh `id`s, no `alias` and no `iecLocation` — the address pool re-allocates those for the copy. */
function duplicateRemoteDeviceIdentity(device: PLCRemoteDevice, slaveNameTaken: NameTaken): PLCRemoteDevice {
  const next: PLCRemoteDevice = { ...device }

  if (next.modbusTcpConfig) {
    next.modbusTcpConfig = {
      ...next.modbusTcpConfig,
      ioGroups: (next.modbusTcpConfig.ioGroups ?? []).map((group) => ({
        ...group,
        id: newUuid(),
        ioPoints: (group.ioPoints ?? []).map((point) => ({
          ...point,
          id: newUuid(),
          iecLocation: '',
          alias: undefined,
        })),
      })),
    }
  }

  if (next.ethercatConfig) {
    // A slave's NAME is its key in tabs, editor models and the file registry — not its
    // id. Same `_01`, `_02`… strategy as the add path; `copied` keeps the copies from
    // colliding with each other.
    const copied = new Set<string>()
    next.ethercatConfig = {
      ...next.ethercatConfig,
      devices: (next.ethercatConfig.devices ?? []).map((slave) => {
        const name = generateUniqueSlaveName(
          slave.name,
          (candidate) => copied.has(candidate) || slaveNameTaken(candidate),
        )
        copied.add(name)
        return {
          ...slave,
          id: newUuid(),
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

  // Without rekeying the flow slices, a renamed LD/FBD POU renders an empty canvas and loses its body on save.
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
  pendingDatatypeDelete: null,

  pouActions: {
    create: ({ type, name, language }) => {
      const state = getState()
      const collision = elementNameCollision(state, name, 'pou')
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(name)
      if (!nameCheck.ok) return nameCheck

      const pouDto = createPouObject({ type, name, language })
      const result = state.projectActions.createPou(pouDto)
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      // The editor reads the flow slice, not the body, so an unseeded LD/FBD POU renders an empty canvas.
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

      // Programs are instantiated by the Resource, never called from another POU, so they are not library blocks.
      if (type !== 'program') {
        state.libraryActions.addLibrary(name, type)
      }

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
      // `updatePouName` queues the old path for deletion unconditionally, so letting a
      // no-op rename through would mark the POU's own file deleted on the next save.
      if (oldName === newName) return { ok: true }

      const collision = elementNameCollision(state, newName, 'pou', oldName)
      if (collision) return { ok: false, message: collision }

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

      const collision = elementNameCollision(state, newName, 'pou')
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      const language = sourcePou.body.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
      const pouDto = createPouObject({ type: sourcePou.pouType, name: newName, language })

      pouDto.data.body = { ...sourcePou.body }
      pouDto.data.variables = sourcePou.interface?.variables ? [...sourcePou.interface.variables] : []
      pouDto.data.documentation = sourcePou.documentation ?? ''
      if (sourcePou.pouType === 'function' && 'returnType' in pouDto.data) {
        pouDto.data.returnType = sourcePou.interface?.returnType ?? 'BOOL'
      }

      const result = state.projectActions.createPou(pouDto)
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      // The shallow-copied body still carries `sourceName`, so override it to the new POU's name.
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

      // Without the user-library entry the copy exists in the project but can't be placed or completed.
      if (sourcePou.pouType !== 'program') {
        state.libraryActions.addLibrary(newName, sourcePou.pouType)
      }

      // Persist only on save: flag the new POU dirty instead of auto-saving.
      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(newName)

      return { ok: true }
    },
  },

  globalVariableListActions: {
    create: (name) => {
      const state = getState()
      // Collision before validation, matching `datatypeActions` above: the more
      // specific message is the more useful one when a name fails both.
      const collision = elementNameCollision(state, name, 'global-variable-list')
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

    /** Rename the list AND every `<oldName>.member` that qualifies against it, or references silently stop resolving. */
    rename: (oldName, newName) => {
      const state = getState()
      const collision = elementNameCollision(state, newName, 'global-variable-list', oldName)
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      // Fold the code view's pending buffer in first, exactly as the data type rename
      // does — otherwise the regenerate at the end writes the pre-edit declaration
      // back over whatever the user had just typed.
      const reconcile = state.projectActions.reconcileGlobalVariableListText(oldName)
      if (!reconcile.ok) return { ok: false, message: reconcile.message }

      if (newName !== oldName) {
        // Land any debounced graphical write-back BEFORE the scan: a pending one leaves `pou.body.value` stale.
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

            // Re-seed the live flow from the rewritten body; the editors read the flow slice, not `pou.body.value`.
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

      const collision = elementNameCollision(state, newName, 'global-variable-list')
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      // Fold any pending code-view buffer in first, or the copy is taken from the
      // declaration as it stood before the user's last edits.
      const reconcile = state.projectActions.reconcileGlobalVariableListText(sourceName)
      if (!reconcile.ok) return { ok: false, message: reconcile.message }

      // Clones the whole record rather than create-then-patch, so no field (e.g. `documentation`) is silently dropped.
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
      const collision = elementNameCollision(state, name, 'data-type')
      if (collision) return { ok: false, message: collision }

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

      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      const state = getState()
      if (state.pendingDatatypeDelete || state.pendingDatatypeRename) return
      const impact = findAllReferencesToDataType(
        name,
        state.project.data.pous,
        state.project.data.configurations.resource.globalVariables,
        state.project.data.dataTypes,
        state.project.data.globalVariableLists ?? [],
      )
      if (impact.totalReferences > 0) {
        setState({ pendingDatatypeDelete: { name, impact } })
        return
      }
      state.modalActions.openModal('confirm-delete-element', { name, elementType: 'datatype' })
    },

    delete: (name) => deleteElement(getState(), name, (n) => getState().projectActions.deleteDatatype(n)),

    rename: async (oldName, newName) => {
      const state = getState()
      const collision = elementNameCollision(state, newName, 'data-type', oldName)
      if (collision) return { ok: false, message: collision }

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
          if (getState().pendingDatatypeRename || getState().pendingDatatypeDelete) {
            return { ok: false, message: 'Another data type change is awaiting confirmation' }
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

    respondToPendingDelete: (confirmed) => {
      const pending = getState().pendingDatatypeDelete
      if (!pending) return
      setState({ pendingDatatypeDelete: null })
      if (confirmed) getState().datatypeActions.delete(pending.name)
    },

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = state.project.data.dataTypes.find((d) => d.name === sourceName)
      if (!source) return { ok: false, message: 'Data type not found' }

      const collision = elementNameCollision(state, newName, 'data-type')
      if (collision) return { ok: false, message: collision }

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
      const collision = elementNameCollision(state, name, 'server')
      if (collision) return { ok: false, message: collision }

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

      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'server' })
    },

    delete: (name) => deleteElement(getState(), name, (n) => getState().projectActions.deleteServer(n)),

    rename: (oldName, newName) => {
      const state = getState()
      // Same name: nothing to rename, and not a duplicate of itself.
      if (oldName === newName) return { ok: true }

      const collision = elementNameCollision(state, newName, 'server', oldName)
      if (collision) return { ok: false, message: collision }

      return renameElement(state, oldName, newName, (o, n) => state.projectActions.updateServerName(o, n))
    },

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = (state.project.data.servers ?? []).find((s) => s.name === sourceName)
      if (!source) return { ok: false, message: 'Server not found' }

      const collision = elementNameCollision(state, newName, 'server')
      if (collision) return { ok: false, message: collision }

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
      const collision = elementNameCollision(state, name, 'remote-device')
      if (collision) return { ok: false, message: collision }

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

      state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'remote-device' })
    },

    delete: (name) => {
      // Cascade: purge EtherCAT children first, or they survive the parent delete as orphan state.
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

    rename: (oldName, newName) => {
      const state = getState()
      // Same name: nothing to rename, and not a duplicate of itself.
      if (oldName === newName) return { ok: true }

      const collision = elementNameCollision(state, newName, 'remote-device', oldName)
      if (collision) return { ok: false, message: collision }

      return renameElement(state, oldName, newName, (o, n) => state.projectActions.updateRemoteDeviceName(o, n))
    },

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = (state.project.data.remoteDevices ?? []).find((d) => d.name === sourceName)
      if (!source) return { ok: false, message: 'Remote device not found' }

      const collision = elementNameCollision(state, newName, 'remote-device')
      if (collision) return { ok: false, message: collision }

      const nameCheck = validateElementName(newName)
      if (!nameCheck.ok) return nameCheck

      const copy = {
        ...duplicateRemoteDeviceIdentity(
          structuredClone(source),
          (name) => elementNameCollision(state, name, 'ethercat-slave') !== null,
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
      // Rejecting here; scan-bus add auto-suffixes instead. Same-name rename stays idempotent.
      const collision = elementNameCollision(state, newName, 'ethercat-slave', oldName)
      if (collision) return { ok: false, message: collision }
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
      // Tabs with no persisted data never register a file entry; treat their absence as "nothing to save", not "unsaved".
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
      // Drop the editor model too, or the workspace's multi-mount loop keeps rendering a hidden editor for a closed tab.
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

    openRetrievedProject: (data) => {
      getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
      // No location the user chose, so a user-initiated save is refused and
      // points at Save As. The build's own flush is unaffected -- refusing that
      // would not protect anything, it would just stop the project compiling.
      getState().workspaceActions.setIsEphemeralProject(true)
    },

    hasUnsavedChanges: () => {
      const editingState = getState().workspace.editingState
      const isFilesSaved = getState().fileActions.checkIfAllFilesAreSaved()
      return !isFilesSaved || editingState === 'unsaved'
    },

    closeProject: () => {
      if (getState().sharedWorkspaceActions.hasUnsavedChanges()) {
        getState().modalActions.openModal('save-changes-project', {
          validationContext: 'close-project',
        })
        return { pendingConfirmation: true }
      }
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
      return { pendingConfirmation: false }
    },

    clearStatesOnCloseProject: () => {
      // A confirmation parked against the closing project must not answer for the next
      // one, and a dropped rename resolver would strand its caller's await forever.
      const pendingRename = getState().pendingDatatypeRename
      setState({ pendingDatatypeRename: null, pendingDatatypeDelete: null })
      pendingRename?.resolve(false)
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
      // `canEdit === false` gates only backend writes (save/commit/branch); in-memory editing, simulation, and compilation stay on.
      getState().workspaceActions.setCanEdit(data.canEdit !== false)

      // An unrecoverable POU opens the workspace EMPTY and read-only, so a save can never overwrite the on-disk
      // file with a blank diagram. Recoverable failures stay in `warnings` instead.
      if (data.fatalErrors?.length) {
        // `setProject` setting `meta.path` is the only thing that moves the desktop build off the start screen.
        getState().projectActions.setProject({
          meta: data.meta,
          data: {
            ...data.projectData,
            pous: [],
            dataTypes: [],
            globalVariableLists: [],
            servers: [],
            remoteDevices: [],
            configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
          },
        })
        // After `setProject`, because `clearWorkspace` resets `canEdit` to true.
        getState().workspaceActions.setCanEdit(false)
        for (const message of data.fatalErrors) {
          getState().consoleActions.addLog({ level: 'error', message })
        }
        getState().consoleActions.addLog({
          level: 'error',
          message:
            'The project was opened empty and read-only so the unreadable file is not overwritten. Fix the file listed above, then reopen the project.',
        })
        return
      }

      // Log any parsing warnings to the app console (after clear so they aren't wiped)
      if (data.warnings) {
        for (const message of data.warnings) {
          getState().consoleActions.addLog({ level: 'warning', message })
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
      // The bytes as loaded, echoed back for untouched files; always reset, so a reopen doesn't inherit the map.
      getState().versionControlActions.setRawLoadedContent(data.rawLoadedFiles ?? {})
      // A pre-DOPE-385 project owes a migration to `datatypes/*.dt`. Always set,
      // so reopening a project that has since migrated clears the flag.
      getState().projectActions.setDataTypesNeedMigration(data.dataTypesNeedMigration ?? false)

      // Unreadable files have no PLCDataType, so no tree leaf to click.
      const unparsedDataTypes = (data.unparsedDataTypeFiles ?? []).flatMap((file) => {
        const name = file.relativePath.split('/').pop()?.replace(/\.dt$/i, '')
        if (!name) return []
        // The file registry is keyed by raw name across every kind, so a GVL excludes a name just as a POU or data type does.
        const taken = [
          ...data.projectData.pous,
          ...data.projectData.dataTypes,
          ...(data.projectData.globalVariableLists ?? []),
        ].some((element) => element.name.toLowerCase() === name.toLowerCase())
        if (taken) return []
        return [{ name, content: file.content, derivation: guessDatatypeDerivation(file.content) }]
      })

      // Key flows under `pou.name`, not the flow's own embedded `name`: a drift between the two renders an empty
      // canvas.
      const pous = data.projectData.pous

      // Refresh placed block variant types before the flows enter the store, so
      // existing projects pick up library type changes (e.g. ADR: ULINT ->
      // __XWORD) and user-POU pin changes alike. A no-op when nothing is stale.
      const systemLibraries = getState().libraries.system
      const userPous = pous.filter((pou) => pou.pouType !== 'program')
      const userPouNames = userPous.map((pou) => pou.name.toUpperCase())
      let restampedCount = 0
      // Blocks still on the old two-sided VAR_IN_OUT pin are counted, never converted: the fix belongs to the
      // block's update badge, and only project-owned blocks can show one.
      const convertibleInOutPous = new Set<string>()
      const libraryInOutBlocks = new Set<string>()

      const scanLegacyInOut = (nodes: unknown[] | undefined, pouName: string): void => {
        for (const node of nodes ?? []) {
          if (!hasLegacyInOutOutputHandle(node as Parameters<typeof hasLegacyInOutOutputHandle>[0])) continue
          const name = (node as { data?: { variant?: { name?: string } } }).data?.variant?.name
          if (name !== undefined && userPouNames.includes(name.toUpperCase())) convertibleInOutPous.add(pouName)
          else if (name !== undefined) libraryInOutBlocks.add(name)
        }
      }

      pous.forEach((pou) => {
        if (pou.body.language === 'ld') {
          // The loaded project data is frozen, so clone before re-stamping
          // (which mutates variant types in place) and hand the store the copy.
          const bodyValue = structuredClone(pou.body.value) as LadderFlowType
          restampedCount += restampFlowBlockVariants([bodyValue], systemLibraries, userPous)
          for (const rung of bodyValue.rungs ?? []) scanLegacyInOut(rung.nodes, pou.name)
          getState().ladderFlowActions.addLadderFlow({ ...bodyValue, name: pou.name })
        }
        if (pou.body.language === 'fbd') {
          const bodyValue = structuredClone(pou.body.value) as FBDFlowType
          restampedCount += restampFlowBlockVariants([bodyValue], systemLibraries, userPous)
          scanLegacyInOut(bodyValue.rung?.nodes, pou.name)
          getState().fbdFlowActions.addFBDFlow({ ...bodyValue, name: pou.name })
        }
      })

      if (restampedCount > 0) {
        getState().consoleActions.addLog({
          level: 'info',
          message: `Refreshed ${restampedCount} block pin type(s) from the current definitions.`,
        })
      }

      if (convertibleInOutPous.size > 0) {
        getState().consoleActions.addLog({
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
          level: 'info',
          message:
            `${[...libraryInOutBlocks].sort().join(', ')}: this project places library blocks with a ` +
            `VAR_IN_OUT parameter that were drawn with a pin on both sides. They keep the extra pin, ` +
            `which no longer accepts new connections; existing connections and the generated code are ` +
            `unaffected.`,
        })
      }

      pous.forEach((pou) => {
        if (pou.pouType !== 'program') {
          getState().libraryActions.addLibrary(pou.name, pou.pouType)
        }
      })

      // Bundled/canonical libs are always-on and don't appear in `project.libraries`.
      const projectLibraryRefs = (data.projectData.libraries ?? []).map((ref) => ({
        name: ref.name,
        version: ref.version,
      }))
      getState().libraryActions.setProjectLibraries(projectLibraryRefs)

      if (getState().missingLibraries.length > 0) {
        getState().modalActions.openModal('missing-libraries')
      }

      // Set device definitions.
      //
      // Before the alias repair below, because the board's pins are one of the
      // producers that declare aliases — repairing with no pins loaded finds
      // nothing to repair. Nothing between here and the POU passes reads the
      // device, so bringing it forward only makes that dependency explicit.
      if (data.deviceConfiguration || data.devicePinMapping) {
        getState().deviceActions.setDeviceDefinitions({
          configuration: data.deviceConfiguration,
          pinMapping: data.devicePinMapping,
        })
      }

      // Repair I/O aliases saved before they had to be IEC identifiers.
      //
      // `AT <alias>` is read back by STruC++ as an identifier, so a project
      // carrying `Motor Start` or `relay-1` cannot be re-read — the editor
      // accepted those names before the rule existed (DOPE-650). They are
      // renamed here rather than dropped, and every variable bound to the old
      // name follows, because dropping would leave those variables unlocated
      // at compile time with nothing to show for it.
      //
      // Runs after the device definitions load, since pins are one of the
      // producers, and before the variables are read anywhere.
      const aliasRepairs = getState().projectActions.normalizeProjectAliases().repairs
      for (const repair of aliasRepairs) {
        getState().consoleActions.addLog({ level: 'warning', message: describeAliasRename(repair) })
      }

      // Runs BEFORE the reclassify pass below, not after. A project carrying an
      // illegal alias cannot be parsed while it still carries it: the POU's
      // declarations fail, its variable list comes back empty, and a cascade
      // that walks `interface.variables` then has nothing to walk. The producer
      // got its new name, the declaration text kept the old one, and the binding
      // was orphaned — the precise outcome this repair exists to prevent. With
      // the repair first, the text is legal by the time anything reads it and
      // the POU loads into the table instead of the code view.
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

        const reclassContext = buildTypeContext(pous, reclassDataTypes, reclassLibraries)

        pous.forEach((payloadPou) => {
          try {
            // Read from the STORE, not from the loader's payload. The alias
            // repair above rewrites `variablesText` in the store; taking the
            // payload's copy here wrote the pre-repair text straight back over
            // it, so a legacy project was repaired and then un-repaired within
            // the same load.
            const pou = getState().project.data.pous.find((c) => c.name === payloadPou.name) ?? payloadPou
            /* istanbul ignore next -- defensive: interface may be undefined */
            const vars = pou.interface?.variables ?? []
            // Reclassify from the POU's OWN text, not from a re-serialisation of
            // the model: the text is what the file holds and what the table is a
            // view of (DOPE-650), and a round trip through
            // `generateIecVariablesToString` throws away the comments it carries.
            //
            // Normalised on the way in, so `a, b : INT;` — legal IEC that STruC++
            // reads but the table cannot show, because the Documentation column
            // is the comment at the end of the line — becomes one declaration per
            // line before anything else looks at it.
            const stored = pou.variablesText
            const normalized = stored !== undefined ? normalizeOneVariablePerLine(stored, reclassContext) : undefined
            const iecString = normalized ?? generateIecVariablesToString(vars)
            const reparsedVariables = parseIecStringToVariables(iecString, pous, reclassDataTypes, reclassLibraries)

            // The same gate the table and the code view apply. A hand-edited or
            // externally-written project file can hold a variable set the editor
            // would never have produced; it used to be written straight into the
            // store. Refusing it is not a failed load — the text is kept and
            // marked, and the POU opens in the code view for the user to fix.
            const validation = validateVariableSet(reparsedVariables)
            if (!validation.ok) {
              if (stored !== undefined) getState().projectActions.setPouVariablesText(pou.name, stored, true)
              // Say which declaration is refused. Opening the POU in the code
              // view with no reason given reads as "the editor broke my file",
              // and the commonest cause — two variables bound to one location,
              // which the table has always refused — is invisible otherwise.
              const [firstError] = validation.errors
              getState().consoleActions.addLog({
                level: 'error',
                message: `POU "${pou.name}": ${firstError.title.replace(/\.$/, '')} — ${firstError.message} The declarations are shown as text so they can be corrected.`,
              })
              return
            }

            // Always rewritten on success, even when the bytes are unchanged:
            // this is also what clears a POU the LOADER marked unparsed but the
            // alias repair above has since made readable. Without it the mark
            // outlived the problem and the POU still opened in the code view.
            const settled = normalized ?? stored
            if (settled !== undefined) getState().projectActions.setPouVariablesText(pou.name, settled, false)
            getState().projectActions.setPouVariables({
              pouName: pou.name,
              variables: carryEditorMetadata(vars, reparsedVariables),
            })
          } catch (err) {
            // Unparseable declarations are the one thing the code view exists
            // for: keep the user's bytes and open it there, rather than leaving
            // the POU with whatever the loader managed to salvage.
            const current = getState().project.data.pous.find((c) => c.name === payloadPou.name)
            const stored = current?.variablesText
            if (stored !== undefined) getState().projectActions.setPouVariablesText(payloadPou.name, stored, true)
            console.error(`[Reclassify] Failed to reclassify variables for POU "${payloadPou.name}":`, err)
          }
        })
      }

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

      // Restore debug flags from debugVariables
      // Since POU variables are saved as text files, debug flags are stored separately in project.json
      const debugVariables = data.projectData.debugVariables
      if (debugVariables) {
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
          // Keyed by slave.name, to match the rest of the file registry, tabs and editor models.
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

      if (aliasRepairs.length > 0) {
        // A legacy-alias repair changed the project, so it is marked unsaved —
        // all of it, not the files the repair happened to touch, and here
        // rather than where the repair runs, because the registry above is
        // built afterwards and starts everything saved.
        //
        // All of it, because one rename spans the producer that declares the
        // alias and every POU that binds it. Saving one without the other is
        // worse than not saving at all: the pin mapping takes the new name, the
        // declaration keeps the old one, and on the next open there is nothing
        // left to repair from — the binding is simply orphaned.
        getState().fileActions.setAllToUnsaved()
      }

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
        // Prefer "main", but fall back: it can be renamed or deleted.
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

      // A POU whose declarations could not be read opens in the code view, on
      // the user's own bytes, so they can repair it.
      //
      // Read from the STORE, not from the response payload: the reclassify pass
      // above is what discovers a set the validator refuses — a file holding two
      // variables of the same name parses fine, so the loader has no way to flag
      // it — and it marks the POU in the store. Iterating the payload here meant
      // that verdict never reached the editor model, and the POU opened on an
      // empty table with its declarations nowhere in sight.
      pous.forEach((payloadPou) => {
        const pouWithText =
          getState().project.data.pous.find((candidate) => candidate.name === payloadPou.name) ?? payloadPou
        if (pouWithText.variablesTextUnparsed === true && pouWithText.variablesText) {
          const pou = pouWithText
          const language = pou.body.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
          const model = createEditorObjectForPou(pou.name, pou.pouType, language)
          /* istanbul ignore next -- defensive: model type may not include variable property */
          if ('variable' in model) {
            model.variable = { display: 'code', code: pouWithText.variablesText }
          }
          getState().editorActions.addModel(model)
          // The auto-open block above may already hold a table-mode model for this POU, which `addModel`/`setEditor`
          // can't reach; this updates whichever object actually holds it.
          getState().editorActions.updateModelVariablesForName(pou.name, {
            display: 'code',
            code: pouWithText.variablesText,
          })
        }
      })

      // A GVL whose declaration didn't parse opens on the preserved text, not a re-serialization.
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

      // Last, since the load-time syncs above set the updated flags as a side effect.
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
      // Flush any pending debounced write-back first, or the redo snapshot below could pair a stale body with a fresh flow.
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
