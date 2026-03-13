import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { SharedRootState, SharedSlice } from './types'
import type { FileSliceDataObject } from '../file'
import type { TabsProps } from '../tabs'
import type { LadderFlowType } from '../ladder'
import type { FBDFlowType } from '../fbd'
import { CreateEditorObjectFromTab } from '../tabs/utils'
import { toast } from '../../../components/_features/[app]/toast/use-toast'
import {
  createDatatypeObject,
  createEditorObjectForDatatype,
  createEditorObjectForPou,
  createEditorObjectForRemoteDevice,
  createEditorObjectForServer,
  createPouObject,
} from './utils'

const MAX_HISTORY_SIZE = 50

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

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'pou' })
    },

    delete: (name) => {
      const state = getState()
      state.projectActions.deletePou(name)
      state.editorActions.removeModel(name)
      state.fileActions.removeFile({ name })
      state.tabsActions.removeTab(name)
      state.libraryActions.removeUserLibrary(name)

      // Reset editor if current editor was deleted
      const currentEditor = state.editor
      if (currentEditor.type !== 'available' && currentEditor.meta.name === name) {
        state.editorActions.clearEditor()
      }

      return { ok: true }
    },

    rename: (oldName, newName) => {
      const state = getState()
      const existing = state.project.data.pous.find((p) => p.name === newName)
      if (existing) return { ok: false, message: 'POU name already exists' }

      state.projectActions.updatePouName(oldName, newName)
      state.editorActions.updateEditorName(oldName, newName)
      state.fileActions.updateFile({ name: oldName, newName })
      state.tabsActions.updateTabName(oldName, newName)
      state.libraryActions.updateLibraryName(oldName, newName)

      return { ok: true }
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

      return { ok: true }
    },

    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'datatype' })
    },

    delete: (name) => {
      const state = getState()
      state.projectActions.deleteDatatype(name)
      state.editorActions.removeModel(name)
      state.fileActions.removeFile({ name })
      state.tabsActions.removeTab(name)

      const currentEditor = state.editor
      if (currentEditor.type !== 'available' && currentEditor.meta.name === name) {
        state.editorActions.clearEditor()
      }

      return { ok: true }
    },

    rename: (oldName, newName) => {
      const state = getState()
      const existing = state.project.data.dataTypes.find((d) => d.name === newName)
      if (existing) return { ok: false, message: 'Data type name already exists' }

      const datatype = state.project.data.dataTypes.find((d) => d.name === oldName)
      if (!datatype) return { ok: false, message: 'Data type not found' }

      const updatedDatatype = { ...datatype, name: newName }
      state.projectActions.updateDatatype(oldName, updatedDatatype)

      state.editorActions.updateEditorName(oldName, newName)
      state.fileActions.updateFile({ name: oldName, newName })
      state.tabsActions.updateTabName(oldName, newName)

      return { ok: true }
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
    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'server' })
    },

    delete: (name) => {
      const state = getState()
      state.projectActions.deleteServer(name)
      state.editorActions.removeModel(name)
      state.fileActions.removeFile({ name })
      state.tabsActions.removeTab(name)

      const currentEditor = state.editor
      if (currentEditor.type !== 'available' && currentEditor.meta.name === name) {
        state.editorActions.clearEditor()
      }

      return { ok: true }
    },

    rename: (oldName, newName) => {
      const state = getState()
      const result = state.projectActions.updateServerName(oldName, newName)
      if (!result.ok) return { ok: false, message: result.message }

      state.editorActions.updateEditorName(oldName, newName)
      state.fileActions.updateFile({ name: oldName, newName })
      state.tabsActions.updateTabName(oldName, newName)

      return { ok: true }
    },
  },

  remoteDeviceActions: {
    deleteRequest: (name) => {
      getState().modalActions.openModal('confirm-delete-element', { name, elementType: 'remote-device' })
    },

    delete: (name) => {
      const state = getState()
      state.projectActions.deleteRemoteDevice(name)
      state.editorActions.removeModel(name)
      state.fileActions.removeFile({ name })
      state.tabsActions.removeTab(name)

      const currentEditor = state.editor
      if (currentEditor.type !== 'available' && currentEditor.meta.name === name) {
        state.editorActions.clearEditor()
      }

      return { ok: true }
    },

    rename: (oldName, newName) => {
      const state = getState()
      const result = state.projectActions.updateRemoteDeviceName(oldName, newName)
      if (!result.ok) return { ok: false, message: result.message }

      state.editorActions.updateEditorName(oldName, newName)
      state.fileActions.updateFile({ name: oldName, newName })
      state.tabsActions.updateTabName(oldName, newName)

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

    forceCloseFile: (name) => {
      getState().tabsActions.removeTab(name)

      const filteredTabs = getState().tabs
      const nextTab = filteredTabs[filteredTabs.length - 1]
      if (!nextTab) {
        getState().editorActions.setEditor({ type: 'available', meta: { name: '' } })
        getState().tabsActions.setSelectedTab('')
        getState().workspaceActions.setSelectedProjectTreeLeaf({ label: '', type: null })
        return { success: true }
      }

      const editor =
        getState().editorActions.getEditorFromEditors(nextTab.name) || CreateEditorObjectFromTab(nextTab)
      getState().editorActions.setEditor(editor)
      getState().tabsActions.setSelectedTab(nextTab.name)
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: nextTab.name,
        type: nextTab.elementType.type,
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
        return
      }
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
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
    },

    handleOpenProjectResponse: (data) => {
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
      getState().workspaceActions.setEditingState('saved')

      // Set project data (setting meta.path triggers navigation from start to workspace)
      getState().projectActions.setProject({
        meta: data.meta,
        data: data.projectData,
      })

      // Add ladder and FBD flows for graphical POUs
      const pous = data.projectData.pous
      pous.forEach((pou) => {
        if (pou.body.language === 'ld') {
          getState().ladderFlowActions.addLadderFlow(pou.body.value as LadderFlowType)
        }
        if (pou.body.language === 'fbd') {
          getState().fbdFlowActions.addFBDFlow(pou.body.value as FBDFlowType)
        }
      })

      // Register user-defined functions/function-blocks in the library
      pous.forEach((pou) => {
        if (pou.pouType !== 'program') {
          getState().libraryActions.addLibrary(pou.name, pou.pouType)
        }
      })

      // Set device definitions
      if (data.deviceConfiguration || data.devicePinMapping) {
        getState().deviceActions.setDeviceDefinitions({
          configuration: data.deviceConfiguration,
          pinMapping: data.devicePinMapping,
        })
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
        })
      }
      files['Resource'] = { type: 'resource', filePath: 'Resource', saved: true }
      files['Configuration'] = { type: 'device', filePath: 'Configuration', saved: true }
      getState().fileActions.setFiles({ files })

      // Open the main POU tab (if present)
      const mainPou = pous.find((p) => p.name === 'main' && p.pouType === 'program')
      if (mainPou) {
        const language = mainPou.body.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
        const tabToBeCreated: TabsProps = {
          name: mainPou.name,
          path: `/data/pous/program/${mainPou.name}`,
          elementType: { type: 'program', language },
        }
        const model = CreateEditorObjectFromTab(tabToBeCreated)
        getState().editorActions.addModel(model)
        getState().editorActions.setEditor(model)
        getState().tabsActions.updateTabs(tabToBeCreated)
        getState().tabsActions.setSelectedTab(mainPou.name)
        getState().workspaceActions.setSelectedProjectTreeLeaf({ label: mainPou.name, type: 'program' })
      }

      toast({
        title: 'Project opened!',
        description: 'Your project was opened, and loaded.',
        variant: 'default',
      })
    },
  },

  snapshotActions: {
    pushToHistory: (pouName, snapshot) => {
      setState(
        produce((state: SharedRootState) => {
          if (!state.undoRedo[pouName]) {
            state.undoRedo[pouName] = { past: [], future: [] }
          }
          const history = state.undoRedo[pouName]
          history.past.push(snapshot)
          if (history.past.length > MAX_HISTORY_SIZE) {
            history.past.shift()
          }
          history.future = []
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

      // Save current state to future
      const currentSnapshot = {
        variables: pou.interface?.variables ?? [],
        body: pou.body.value,
        globalVariables: state.project.data.configurations.resource.globalVariables,
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
    },

    redo: (pouName) => {
      const state = getState()
      const history = state.undoRedo[pouName]
      if (!history || history.future.length === 0) return

      const snapshot = history.future[history.future.length - 1]
      const pou = state.project.data.pous.find((p) => p.name === pouName)
      if (!pou) return

      // Save current state to past
      const currentSnapshot = {
        variables: pou.interface?.variables ?? [],
        body: pou.body.value,
        globalVariables: state.project.data.configurations.resource.globalVariables,
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
    },
  },
})

export { createSharedSlice }
