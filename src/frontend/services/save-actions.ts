/**
 * Shared save actions for the OpenPLC editor.
 *
 * These functions are called from multiple UI entry points (keyboard shortcuts,
 * menu items, activity bar, modals) and centralise the save logic so it isn't
 * duplicated. They read state from the store, perform serialization, call the
 * platform port, and update state on success/failure.
 */

import type { ProjectPort, RawProjectFile, WriteProjectFiles } from '../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../store'
import { getExtensionFromLanguage, getFolderFromPouType } from '../utils/PLC/pou-file-extensions'
import { serializePouToText } from '../utils/PLC/pou-text-serializer'
import { collectDebugVariables, sanitizePou } from '../utils/save-project'
import { toast } from '../utils/toast'

/** Join path segments with forward slashes (platform-agnostic, works with Node's fs on all OSes). */
const joinPath = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')

/**
 * Save the entire project (all files, device config, debug variables).
 * Equivalent to Ctrl+Shift+S / "Save Project" menu item.
 *
 * All serialization happens here on the frontend using the same functions
 * as the single-file save (serializePouToText, sanitizePou, etc.).
 * The backend receives only pre-serialized strings via WriteProjectFiles.
 */
export async function executeSaveProject(projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const { project, pendingDeletions, deviceDefinitions } = state
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
    // Serialize all POUs using the same functions as single-file save
    const pouFiles: RawProjectFile[] = project.data.pous.map((pou) => {
      const editorModel = state.editorActions.getEditorFromEditors(pou.name)
      const sanitized = sanitizePou(pou, editorModel ?? undefined)
      const folder = getFolderFromPouType(pou.pouType)
      const ext = getExtensionFromLanguage(pou.body.language)
      return { relativePath: `pous/${folder}/${pou.name}${ext}`, content: serializePouToText(sanitized) }
    })

    // Serialize servers as individual JSON files
    const serverFiles: RawProjectFile[] = (project.data.servers ?? []).map((s) => ({
      relativePath: `devices/servers/${s.name}.json`,
      content: JSON.stringify(s, null, 2),
    }))

    // Serialize remote devices as individual JSON files
    const remoteDeviceFiles: RawProjectFile[] = (project.data.remoteDevices ?? []).map((d) => ({
      relativePath: `devices/remote/${d.name}.json`,
      content: JSON.stringify(d, null, 2),
    }))

    // Build project.json — same structure as single-file save
    const debugVariables = collectDebugVariables(
      project.data.configurations.resource.globalVariables,
      project.data.pous,
    )
    const projectJson = JSON.stringify(
      {
        meta: { name: project.meta.name, type: 'plc-project' },
        data: {
          dataTypes: project.data.dataTypes,
          pous: [],
          configuration: project.data.configurations,
          debugVariables,
        },
      },
      null,
      2,
    )

    const files: WriteProjectFiles = {
      projectPath: project.meta.path,
      projectJson,
      deviceConfig: JSON.stringify(deviceDefinitions.configuration, null, 2),
      pinMapping: JSON.stringify(deviceDefinitions.pinMapping.pins, null, 2),
      pouFiles,
      serverFiles,
      remoteDeviceFiles,
      deletions: [...pendingDeletions],
    }

    const res = await projectPort.saveProject(files)
    if (res.success) {
      state.projectActions.clearPendingDeletions()
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
 * Save a single file by name.
 *
 * This is the core single-file save logic used by both executeSaveActiveFile()
 * (Ctrl+S — saves whichever file is currently focused) and direct callers that
 * need to save a specific file by name (e.g. the save-changes-file modal).
 *
 * For POUs: serializes to IEC text on the frontend, writes via projectPort.saveFile.
 * For device/data-type/resource/server/remote-device: writes appropriate JSON files.
 * Also updates project.json when debug variables may have changed.
 */
export async function executeSaveFile(fileName: string, projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const { project, files } = state
  const { setEditingState } = state.workspaceActions
  const { updateFile, checkIfAllFilesAreSaved } = state.fileActions
  const { markSaved } = state.snapshotActions

  const file = files[fileName]
  if (!file) {
    toast({ title: 'Error saving file', description: `File "${fileName}" not found.`, variant: 'fail' })
    return { success: false }
  }

  setEditingState('save-request')
  const projectPath = project.meta.path

  const fail = (description: string): { success: false } => {
    setEditingState('unsaved')
    toast({ title: 'Error saving file', description, variant: 'fail' })
    return { success: false }
  }

  try {
    const isPouType = file.type === 'program' || file.type === 'function' || file.type === 'function-block'

    if (isPouType) {
      const pou = project.data.pous.find((p) => p.name === fileName)
      if (!pou) return fail(`POU "${fileName}" not found.`)

      const editorModel = state.editorActions.getEditorFromEditors(fileName)
      const sanitized = sanitizePou(pou, editorModel ?? undefined)
      const textContent = serializePouToText(sanitized)
      const folder = getFolderFromPouType(pou.pouType)
      const ext = getExtensionFromLanguage(pou.body.language)

      const res = await projectPort.saveFile(joinPath(projectPath, 'pous', folder, `${fileName}${ext}`), textContent)
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else if (file.type === 'device') {
      const configRes = await projectPort.saveFile(
        joinPath(projectPath, 'devices/configuration.json'),
        JSON.stringify(state.deviceDefinitions.configuration, null, 2),
      )
      const pinRes = await projectPort.saveFile(
        joinPath(projectPath, 'devices/pin-mapping.json'),
        JSON.stringify(state.deviceDefinitions.pinMapping.pins, null, 2),
      )
      if (!configRes.success || !pinRes.success) return fail('Save failed')
    } else if (file.type === 'server') {
      const server = project.data.servers?.find((s) => s.name === fileName)
      if (!server) return fail(`Server "${fileName}" not found.`)
      const res = await projectPort.saveFile(
        joinPath(projectPath, 'devices/servers', `${fileName}.json`),
        JSON.stringify(server, null, 2),
      )
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else if (file.type === 'remote-device') {
      const device = project.data.remoteDevices?.find((d) => d.name === fileName)
      if (!device) return fail(`Remote device "${fileName}" not found.`)
      const res = await projectPort.saveFile(
        joinPath(projectPath, 'devices/remote', `${fileName}.json`),
        JSON.stringify(device, null, 2),
      )
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else {
      // data-type, resource: live in project.json
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
      const res = await projectPort.saveFile(
        joinPath(projectPath, 'project.json'),
        JSON.stringify(projectJson, null, 2),
      )
      if (!res.success) return fail(res.error ?? 'Save failed')
    }

    // Mark only this file as saved
    updateFile({ name: fileName, saved: true, isNew: false })
    markSaved(fileName)

    // If all files are now saved, update workspace editing state
    if (checkIfAllFilesAreSaved()) {
      setEditingState('saved')
    } else {
      setEditingState('unsaved')
    }

    toast({ title: 'File saved', description: `"${fileName}" saved successfully.`, variant: 'default' })
    return { success: true }
  } catch {
    return fail('An unexpected error occurred.')
  }
}

/**
 * Save the currently active file (the one focused in the editor).
 * Equivalent to Ctrl+S / "Save" menu item.
 *
 * Thin wrapper around executeSaveFile that resolves the active editor name.
 */
export async function executeSaveActiveFile(projectPort: ProjectPort): Promise<{ success: boolean }> {
  const name = openPLCStoreBase.getState().editor.meta.name
  if (!name) {
    toast({ title: 'No file open', description: 'There is no file to save.', variant: 'fail' })
    return { success: false }
  }
  return executeSaveFile(name, projectPort)
}
