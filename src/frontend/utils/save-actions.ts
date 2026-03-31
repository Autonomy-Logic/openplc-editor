/**
 * Shared save actions for the OpenPLC editor.
 *
 * These functions are called from multiple UI entry points (keyboard shortcuts,
 * menu items, activity bar, modals) and centralise the save logic so it isn't
 * duplicated. They read state from the store, perform serialization, call the
 * platform port, and update state on success/failure.
 */

import type { ProjectPort } from '../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../store'
import { getExtensionFromLanguage, getFolderFromPouType } from './PLC/pou-file-extensions'
import { serializePouToText } from './PLC/pou-text-serializer'
import { collectDebugVariables, prepareSavePayload, sanitizePou } from './save-project'
import { toast } from './toast'

/**
 * Save the entire project (all files, device config, debug variables).
 * Equivalent to Ctrl+Shift+S / "Save Project" menu item.
 */
export async function executeSaveProject(projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const { project, editors, editor: activeEditor, deviceDefinitions } = state
  const { setEditingState } = state.workspaceActions
  const { setAllToSaved } = state.fileActions
  const { markAllSaved } = state.snapshotActions

  setEditingState('save-request')
  toast({
    title: 'Save changes',
    description: 'Trying to save the changes in the project file.',
    variant: 'warn',
  })

  try {
    const params = prepareSavePayload({
      projectPath: project.meta.path,
      projectName: project.meta.name,
      projectData: project.data,
      deviceConfiguration: deviceDefinitions.configuration,
      devicePinMapping: deviceDefinitions.pinMapping.pins,
      editors,
      activeEditor,
    })

    const res = await projectPort.saveProject(params)
    if (res.success) {
      setEditingState('saved')
      setAllToSaved()
      markAllSaved()
      toast({
        title: 'Changes saved!',
        description: 'The project was saved successfully!',
        variant: 'default',
      })
    } else {
      setEditingState('unsaved')
      toast({
        title: 'Error in the save request!',
        description: res.error ?? 'Save failed',
        variant: 'fail',
      })
    }
    return { success: res.success }
  } catch {
    setEditingState('unsaved')
    toast({
      title: 'Error in the save request!',
      description: 'An unexpected error occurred while saving.',
      variant: 'fail',
    })
    return { success: false }
  }
}

/**
 * Save only the active file (the POU/resource currently open in the editor).
 * Equivalent to Ctrl+S / "Save" menu item.
 *
 * For POUs: serializes to IEC text on the frontend, writes via projectPort.saveFile.
 * For device/data-type/resource/server/remote-device: writes appropriate JSON files.
 * Also updates project.json when debug variables may have changed.
 */
export async function executeSaveActiveFile(projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const { project, editor: activeEditor, files } = state
  const { setEditingState } = state.workspaceActions
  const { updateFile, checkIfAllFilesAreSaved } = state.fileActions
  const { markSaved } = state.snapshotActions

  const name = activeEditor.meta.name
  if (!name) {
    toast({ title: 'No file open', description: 'There is no file to save.', variant: 'fail' })
    return { success: false }
  }

  const file = files[name]
  if (!file) {
    toast({ title: 'Error saving file', description: `File "${name}" not found.`, variant: 'fail' })
    return { success: false }
  }

  const projectPath = project.meta.path

  try {
    const isPouType = file.type === 'program' || file.type === 'function' || file.type === 'function-block'

    if (isPouType) {
      const pou = project.data.pous.find((p) => p.name === name)
      if (!pou) {
        toast({ title: 'Error saving file', description: `POU "${name}" not found.`, variant: 'fail' })
        return { success: false }
      }

      // Sanitize: sync variablesText from code-mode editor if applicable
      const editorModel = state.editorActions.getEditorFromEditors(name)
      const sanitized = sanitizePou(pou, editorModel ?? undefined)

      // Serialize POU to IEC text on the frontend (single source of truth)
      const textContent = serializePouToText(sanitized)

      // Compute file path
      const folder = getFolderFromPouType(pou.pouType)
      const ext = getExtensionFromLanguage(pou.body.language)
      const filePath = `${projectPath}/pous/${folder}/${name}${ext}`

      const res = await projectPort.saveFile(filePath, textContent)
      if (!res.success) {
        toast({ title: 'Error saving file', description: res.error ?? 'Save failed', variant: 'fail' })
        return { success: false }
      }

      // Also save project.json with updated debug variables
      const debugVariables = collectDebugVariables(
        project.data.configurations.resource.globalVariables,
        project.data.pous,
      )
      const projectJson = {
        meta: { name: project.meta.name, type: 'plc-project' },
        data: {
          dataTypes: project.data.dataTypes,
          pous: [],
          configuration: project.data.configurations,
          debugVariables,
        },
      }
      await projectPort.saveFile(`${projectPath}/project.json`, JSON.stringify(projectJson, null, 2))
    } else if (file.type === 'device') {
      // Device config: two JSON files
      const configRes = await projectPort.saveFile(
        `${projectPath}/devices/configuration.json`,
        JSON.stringify(state.deviceDefinitions.configuration, null, 2),
      )
      const pinRes = await projectPort.saveFile(
        `${projectPath}/devices/pin-mapping.json`,
        JSON.stringify(state.deviceDefinitions.pinMapping.pins, null, 2),
      )
      if (!configRes.success || !pinRes.success) {
        toast({ title: 'Error saving device config', description: 'Save failed', variant: 'fail' })
        return { success: false }
      }
    } else {
      // data-type, resource, server, remote-device: all live in project.json
      const debugVariables = collectDebugVariables(
        project.data.configurations.resource.globalVariables,
        project.data.pous,
      )
      const projectJson = {
        meta: { name: project.meta.name, type: 'plc-project' },
        data: {
          dataTypes: project.data.dataTypes,
          pous: [],
          configuration: project.data.configurations,
          servers: project.data.servers,
          remoteDevices: project.data.remoteDevices,
          debugVariables,
        },
      }
      const res = await projectPort.saveFile(
        `${projectPath}/project.json`,
        JSON.stringify(projectJson, null, 2),
      )
      if (!res.success) {
        toast({ title: 'Error saving file', description: res.error ?? 'Save failed', variant: 'fail' })
        return { success: false }
      }
    }

    // Mark only this file as saved
    updateFile({ name, saved: true, isNew: false })
    markSaved(name)

    // If all files are now saved, update workspace editing state
    if (checkIfAllFilesAreSaved()) {
      setEditingState('saved')
    }

    toast({ title: 'File saved', description: `"${name}" saved successfully.`, variant: 'default' })
    return { success: true }
  } catch {
    toast({ title: 'Error saving file', description: 'An unexpected error occurred.', variant: 'fail' })
    return { success: false }
  }
}
