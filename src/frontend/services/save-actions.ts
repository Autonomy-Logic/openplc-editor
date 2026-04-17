/**
 * Shared save actions for the OpenPLC editor.
 *
 * These functions are called from multiple UI entry points (keyboard shortcuts,
 * menu items, activity bar, modals) and centralise the save logic so it isn't
 * duplicated. They read state from the store, perform serialization, call the
 * platform port, and update state on success/failure.
 */

import type { ProjectPort, RawProjectFile, WriteProjectFiles } from '../../middleware/shared/ports/project-port'
import type { PLCPou } from '../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../store'
import type { LadderFlowType } from '../store/slices/ladder'
import { parseIecStringToVariables } from '../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../utils/generate-iec-variables-to-string'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../utils/graphical/sync-nodes-with-variables'
import { getExtensionFromLanguage, getFolderFromPouType } from '../utils/PLC/pou-file-extensions'
import { parseGraphicalPouFromString, parseTextualPouFromString } from '../utils/PLC/pou-text-parser'
import { serializePouToText } from '../utils/PLC/pou-text-serializer'
import { collectDebugVariables, sanitizePou } from '../utils/save-project'
import { toast } from '../utils/toast'

/** Join path segments with forward slashes (platform-agnostic, works with Node's fs on all OSes). */
const joinPath = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')

/**
 * Strip transient UI state (selected, selectedNodes) from graphical POU body
 * before serializing to disk. This prevents nodes from loading as selected
 * on the next open, which would cause a spurious dirty mark on first click.
 */
function stripGraphicalSelections<T extends { body: { language: string; value: unknown } }>(pou: T): T {
  const lang = pou.body.language
  if (lang !== 'ld' && lang !== 'fbd') return pou

  const body = pou.body.value as Record<string, unknown>
  if (!body) return pou

  if (lang === 'ld' && Array.isArray(body.rungs)) {
    return {
      ...pou,
      body: {
        ...pou.body,
        value: {
          ...body,
          rungs: (body.rungs as Array<Record<string, unknown>>).map((rung) => ({
            ...rung,
            selectedNodes: [],
            nodes: Array.isArray(rung.nodes)
              ? (rung.nodes as Array<Record<string, unknown>>).map((n) => ({ ...n, selected: false }))
              : rung.nodes,
          })),
        },
      },
    }
  }

  if (lang === 'fbd' && body.rung) {
    const rung = body.rung as Record<string, unknown>
    return {
      ...pou,
      body: {
        ...pou.body,
        value: {
          ...body,
          rung: {
            ...rung,
            nodes: Array.isArray(rung.nodes)
              ? (rung.nodes as Array<Record<string, unknown>>).map((n) => ({ ...n, selected: false }))
              : rung.nodes,
          },
        },
      },
    }
  }

  return pou
}

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
      const sanitized = stripGraphicalSelections(sanitizePou(pou, editorModel ?? undefined))
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

      // Reset graphical flow state: clear selections and updated flags
      for (const flow of state.ladderFlows) {
        state.ladderFlowActions.clearSelections({ editorName: flow.name })
        state.ladderFlowActions.setFlowUpdated({ editorName: flow.name, updated: false })
      }
      for (const flow of state.fbdFlows) {
        state.fbdFlowActions.clearSelections({ editorName: flow.name })
        state.fbdFlowActions.setFlowUpdated({ editorName: flow.name, updated: false })
      }

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
      const sanitized = stripGraphicalSelections(sanitizePou(pou, editorModel ?? undefined))
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

    // Reset graphical flow state: clear selections (prevents spurious dirty on reopen
    // when a deselection click triggers updateNode) and reset updated flags.
    const ladderFlow = state.ladderFlows.find((f) => f.name === fileName)
    if (ladderFlow) {
      state.ladderFlowActions.clearSelections({ editorName: fileName })
      state.ladderFlowActions.setFlowUpdated({ editorName: fileName, updated: false })
    }
    const fbdFlow = state.fbdFlows.find((f) => f.name === fileName)
    if (fbdFlow) {
      state.fbdFlowActions.clearSelections({ editorName: fileName })
      state.fbdFlowActions.setFlowUpdated({ editorName: fileName, updated: false })
    }

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

/**
 * Reload a single POU from disk, discarding in-memory changes.
 *
 * Performs the same full cycle as handleOpenProjectResponse does for each POU
 * during project open: parse file, restore body + variables, reclassify
 * variables with full project context, restore graphical flow, and sync
 * nodes with reclassified variables. This ensures the POU is in the exact
 * same state as if the project were freshly opened.
 */
export async function reloadPouFromDisk(pouName: string, projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === pouName)
  if (!pou) return { success: false }

  try {
    const language = pou.body.language
    const ext = getExtensionFromLanguage(language)
    const folder = getFolderFromPouType(pou.pouType)
    const fullPath = joinPath(state.project.meta.path, 'pous', folder, `${pouName}${ext}`)

    const result = await projectPort.readFileContent(fullPath)
    if (!result.success || !result.content) return { success: false }

    // Parse the file from disk (same parsers used during project load)
    const isGraphical = language === 'ld' || language === 'fbd'
    const parsed: PLCPou = isGraphical
      ? parseGraphicalPouFromString(result.content, language, pou.pouType)
      : parseTextualPouFromString(result.content, language, pou.pouType)

    // Restore body, variables, and documentation
    state.projectActions.applyPouSnapshot(pouName, parsed.interface?.variables ?? [], parsed.body)
    if (parsed.documentation !== undefined) {
      state.projectActions.updatePouDocumentation(pouName, parsed.documentation)
    }

    // Restore graphical flow state
    if (language === 'ld' && parsed.body.value) {
      state.ladderFlowActions.addLadderFlow(parsed.body.value as LadderFlowType)
    } else if (language === 'fbd' && parsed.body.value) {
      state.fbdFlowActions.addFBDFlow(
        parsed.body.value as unknown as Parameters<typeof state.fbdFlowActions.addFBDFlow>[0],
      )
    }

    // Reclassify variables with full project context (same as handleOpenProjectResponse)
    const freshState = openPLCStoreBase.getState()
    const freshPou = freshState.project.data.pous.find((p) => p.name === pouName)
    if (freshPou) {
      const vars = freshPou.interface?.variables ?? []
      const iecString = generateIecVariablesToString(vars)
      const reparsedVars = parseIecStringToVariables(
        iecString,
        freshState.project.data.pous,
        freshState.project.data.dataTypes,
        freshState.libraries,
      )
      freshState.projectActions.setPouVariables({ pouName, variables: reparsedVars })

      // Sync graphical nodes with reclassified variables
      if (language === 'ld') {
        const pouFlows = openPLCStoreBase.getState().ladderFlows.filter((f) => f.name === pouName)
        if (pouFlows.length > 0) {
          syncNodesWithVariables(reparsedVars, pouFlows, openPLCStoreBase.getState().ladderFlowActions.updateNode)
        }
        // Reset flow updated flag (syncNodesWithVariables triggers updateNode which sets updated=true)
        openPLCStoreBase.getState().ladderFlowActions.setFlowUpdated({ editorName: pouName, updated: false })
      } else if (language === 'fbd') {
        const pouFlows = openPLCStoreBase.getState().fbdFlows.filter((f) => f.name === pouName)
        if (pouFlows.length > 0) {
          syncNodesWithVariablesFBD(reparsedVars, pouFlows, openPLCStoreBase.getState().fbdFlowActions.updateNode)
        }
        openPLCStoreBase.getState().fbdFlowActions.setFlowUpdated({ editorName: pouName, updated: false })
      }
    }

    return { success: true }
  } catch {
    return { success: false }
  }
}
