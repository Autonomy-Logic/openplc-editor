import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../../../utils/graphical/sync-nodes-with-variables'
import { restampFlowLibraryVariants } from '../../../utils/PLC/restamp-library-variants'
import { collectAllSlaveNames } from '../../../utils/unique-slave-name'
import type { FBDFlowType } from '../fbd'
import type { FileSliceDataObject } from '../file'
import type { HistorySnapshot } from '../history'
import type { LadderFlowType } from '../ladder'
import type { TabsProps } from '../tabs'
import {
  CreateEditorObjectFromTab,
  CreateRemoteDeviceEditor,
  CreateServerEditor,
  LIBRARY_MANIFEST_TAB_NAME,
} from '../tabs/utils'
import type { SharedRootState, SharedSlice } from './types'
import { createDatatypeObject, createEditorObjectForDatatype, createEditorObjectForPou, createPouObject } from './utils'

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
  return { ok: true as const }
}

function renameElement(
  state: SharedRootState,
  oldName: string,
  newName: string,
  updateInProject: (oldName: string, newName: string) => { ok: boolean; message?: string } | void,
  afterRename?: (oldName: string, newName: string) => void,
) {
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

  afterRename?.(oldName, newName)

  return { ok: true as const }
}

const createSharedSlice: StateCreator<SharedRootState, [], [], SharedSlice> = (setState, getState) => ({
  undoRedo: {},

  pouActions: {
    create: ({ type, name, language }) => {
      const state = getState()
      const existing = state.project.data.pous.find((p) => p.name === name)
      if (existing) return { ok: false, message: 'POU already exists' }

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

      return { ok: true }
    },
  },

  datatypeActions: {
    create: ({ name, derivation }) => {
      const state = getState()
      const existing = state.project.data.dataTypes.find((d) => d.name === name)
      if (existing) return { ok: false, message: 'Data type already exists' }

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

    rename: (oldName, newName) => {
      const state = getState()
      const existing = state.project.data.dataTypes.find((d) => d.name === newName)
      if (existing) return { ok: false, message: 'Data type name already exists' }

      const datatype = state.project.data.dataTypes.find((d) => d.name === oldName)
      if (!datatype) return { ok: false, message: 'Data type not found' }

      const updatedDatatype = { ...datatype, name: newName }

      return renameElement(state, oldName, newName, () => {
        state.projectActions.updateDatatype(oldName, updatedDatatype)
      })
    },

    duplicate: (sourceName, newName) => {
      const state = getState()
      const source = state.project.data.dataTypes.find((d) => d.name === sourceName)
      if (!source) return { ok: false, message: 'Data type not found' }

      const existing = state.project.data.dataTypes.find((d) => d.name === newName)
      if (existing) return { ok: false, message: 'Data type name already exists' }

      const copy = { ...source, name: newName }
      const result = state.projectActions.createDatatype({ data: copy })
      /* istanbul ignore next -- defensive: shared slice already validates name uniqueness */
      if (!result.ok) return { ok: false, message: result.message }

      const editorModel = createEditorObjectForDatatype(newName, source.derivation)
      state.editorActions.addModel(editorModel)
      state.fileActions.addFile({ name: newName, type: 'data-type', filePath: newName, isNew: true })

      return { ok: true }
    },
  },

  serverActions: {
    create: ({ name, protocol }) => {
      const state = getState()
      /* istanbul ignore next -- defensive: servers is always initialized as [] */
      const servers = state.project.data.servers ?? []
      if (servers.some((s) => s.name === name)) return { ok: false, message: 'Server already exists' }

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
  },

  remoteDeviceActions: {
    create: ({ name, protocol }) => {
      const state = getState()
      /* istanbul ignore next -- defensive: remoteDevices is always initialized as [] */
      const devices = state.project.data.remoteDevices ?? []
      if (devices.some((d) => d.name === name)) return { ok: false, message: 'Remote device already exists' }

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

      pous.forEach((pou) => {
        if (pou.body.language === 'ld') {
          // The loaded project data is frozen, so clone before re-stamping
          // (which mutates variant types in place) and hand the store the copy.
          const bodyValue = structuredClone(pou.body.value) as LadderFlowType
          restampedCount += restampFlowLibraryVariants([bodyValue], systemLibraries, userPouNames)
          getState().ladderFlowActions.addLadderFlow({ ...bodyValue, name: pou.name })
        }
        if (pou.body.language === 'fbd') {
          const bodyValue = structuredClone(pou.body.value) as FBDFlowType
          restampedCount += restampFlowLibraryVariants([bodyValue], systemLibraries, userPouNames)
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
          const updateLadderNode = freshState.ladderFlowActions.updateNode
          const updateFBDNode = freshState.fbdFlowActions.updateNode

          try {
            ladderPous.forEach((pou) => {
              const freshPou = freshPous.find((p) => p.name === pou.name)
              /* istanbul ignore next -- defensive: freshPou always exists since we just loaded it */
              if (freshPou) {
                const pouFlow = freshLadderFlows.filter((flow) => flow.name === pou.name)
                /* istanbul ignore next -- defensive: flow always exists since we just added it */
                if (pouFlow.length > 0) {
                  syncNodesWithVariables(freshPou.interface?.variables ?? [], pouFlow, updateLadderNode)
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
                  syncNodesWithVariablesFBD(freshPou.interface?.variables ?? [], pouFlow, updateFBDNode)
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

    markAllSaved: () => {
      setState(
        produce((state: SharedRootState) => {
          for (const history of Object.values(state.undoRedo)) {
            history.savedAtDepth = history.past.length
          }
        }),
      )
    },

    undo: (pouName) => {
      const state = getState()
      const history = state.undoRedo[pouName]
      if (!history || history.past.length === 0) return

      const snapshot = history.past[history.past.length - 1]
      const pou = state.project.data.pous.find((p) => p.name === pouName)
      if (!pou) return

      // Save current state to future (deep copy to avoid mutation)
      const ladderFlow = state.ladderFlows.find((f) => f.name === pouName)
      const fbdFlow = state.fbdFlows.find((f) => f.name === pouName)
      const currentSnapshot: HistorySnapshot = {
        variables: JSON.parse(JSON.stringify(pou.interface?.variables ?? [])) as PLCVariable[],
        body: JSON.parse(JSON.stringify(pou.body.value)) as unknown,
        ladderFlow: ladderFlow ? JSON.parse(JSON.stringify(ladderFlow)) : undefined,
        fbdFlow: fbdFlow ? JSON.parse(JSON.stringify(fbdFlow)) : undefined,
        globalVariables: JSON.parse(
          JSON.stringify(state.project.data.configurations.resource.globalVariables),
        ) as PLCVariable[],
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

      // Check if we've returned to the saved state
      const afterUndo = getState().undoRedo[pouName]
      if (afterUndo?.savedAtDepth !== null && afterUndo?.savedAtDepth === afterUndo?.past.length) {
        getState().fileActions.updateFile({ name: pouName, saved: true })
      }
    },

    redo: (pouName) => {
      const state = getState()
      const history = state.undoRedo[pouName]
      if (!history || history.future.length === 0) return

      const snapshot = history.future[history.future.length - 1]
      const pou = state.project.data.pous.find((p) => p.name === pouName)
      if (!pou) return

      // Save current state to past (deep copy to avoid mutation)
      const ladderFlow = state.ladderFlows.find((f) => f.name === pouName)
      const fbdFlow = state.fbdFlows.find((f) => f.name === pouName)
      const currentSnapshot: HistorySnapshot = {
        variables: JSON.parse(JSON.stringify(pou.interface?.variables ?? [])) as PLCVariable[],
        body: JSON.parse(JSON.stringify(pou.body.value)) as unknown,
        ladderFlow: ladderFlow ? JSON.parse(JSON.stringify(ladderFlow)) : undefined,
        fbdFlow: fbdFlow ? JSON.parse(JSON.stringify(fbdFlow)) : undefined,
        globalVariables: JSON.parse(
          JSON.stringify(state.project.data.configurations.resource.globalVariables),
        ) as PLCVariable[],
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

      // Check if we've returned to the saved state
      const afterRedo = getState().undoRedo[pouName]
      if (afterRedo?.savedAtDepth !== null && afterRedo?.savedAtDepth === afterRedo?.past.length) {
        getState().fileActions.updateFile({ name: pouName, saved: true })
      }
    },
  },
})

export { createSharedSlice }
