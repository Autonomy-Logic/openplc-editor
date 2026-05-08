/**
 * Shared save actions for the OpenPLC editor.
 *
 * These functions are called from multiple UI entry points (keyboard shortcuts,
 * menu items, activity bar, modals) and centralise the save logic so it isn't
 * duplicated. They read state from the store, perform serialization, call the
 * platform port, and update state on success/failure.
 *
 * All path → content production funnels through `iterateProjectFiles` so the
 * preview, the snapshot baselines, the per-file save and the full-project
 * save can never disagree about what a given file should look like on disk.
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
import { pickContentForSave } from '../utils/version-control-content'

/** Join path segments with forward slashes (platform-agnostic, works with Node's fs on all OSes). */
const joinPath = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')

// ---------------------------------------------------------------------------
// Project file iteration — single source of truth for path → content
// ---------------------------------------------------------------------------

type StoreState = ReturnType<typeof openPLCStoreBase.getState>

type ProjectFileCategory = 'pou' | 'server' | 'remote-device' | 'device-config' | 'pin-mapping' | 'project-json'

type ProjectFileSpec = {
  path: string
  content: string
  category: ProjectFileCategory
}

function buildProjectJsonContent(state: StoreState): string {
  const { project } = state
  const debugVariables = collectDebugVariables(project.data.configurations.resource.globalVariables, project.data.pous)
  // Per-project library enablement, alphabetical-by-name for stable
  // diffs.  Bundled / canonical strucpp libs are always-on regardless
  // and intentionally don't appear here.
  const libraries = [...(project.data.libraries ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  return JSON.stringify(
    {
      meta: { name: project.meta.name, type: 'plc-project' },
      data: {
        dataTypes: project.data.dataTypes,
        pous: [],
        configuration: project.data.configurations,
        libraries,
        debugVariables,
      },
    },
    null,
    2,
  )
}

function buildPouSpec(pou: PLCPou, state: StoreState): ProjectFileSpec {
  const folder = getFolderFromPouType(pou.pouType)
  const ext = getExtensionFromLanguage(pou.body.language)
  const editorModel = state.editorActions.getEditorFromEditors(pou.name)
  const sanitized = sanitizePou(pou, editorModel ?? undefined)
  return {
    path: `pous/${folder}/${pou.name}${ext}`,
    content: serializePouToText(sanitized),
    category: 'pou',
  }
}

/**
 * Yield every file the save flow uploads, in a deterministic order, with the
 * canonical serialized content for each. Used by `buildAllProjectFileContents*`
 * for snapshots and previews, and by `executeSaveProject` to build the
 * platform write payload.
 */
function* iterateProjectFiles(state: StoreState): Generator<ProjectFileSpec> {
  const { project, deviceDefinitions } = state

  for (const pou of project.data.pous) {
    yield buildPouSpec(pou, state)
  }

  for (const s of project.data.servers ?? []) {
    yield {
      path: `devices/servers/${s.name}.json`,
      content: JSON.stringify(s, null, 2),
      category: 'server',
    }
  }

  for (const d of project.data.remoteDevices ?? []) {
    yield {
      path: `devices/remote/${d.name}.json`,
      content: JSON.stringify(d, null, 2),
      category: 'remote-device',
    }
  }

  yield {
    path: 'devices/configuration.json',
    content: JSON.stringify(deviceDefinitions.configuration, null, 2),
    category: 'device-config',
  }

  yield {
    path: 'devices/pin-mapping.json',
    content: JSON.stringify(deviceDefinitions.pinMapping.pins, null, 2),
    category: 'pin-mapping',
  }

  yield {
    path: 'project.json',
    content: buildProjectJsonContent(state),
    category: 'project-json',
  }
}

/**
 * Resolve the canonical specs for a single named file (POU, datatype, server,
 * etc.). Returns multiple specs only for the `device` editor type, which
 * persists both the configuration and pin-mapping JSON files.
 */
function serializeProjectFile(
  fileName: string,
  file: { type: string | null; filePath: string },
  state: StoreState,
): ProjectFileSpec[] {
  const { project, deviceDefinitions } = state
  const isPouType = file.type === 'program' || file.type === 'function' || file.type === 'function-block'

  if (isPouType) {
    const pou = project.data.pous.find((p) => p.name === fileName)
    return pou ? [buildPouSpec(pou, state)] : []
  }

  if (file.type === 'device') {
    return [
      {
        path: 'devices/configuration.json',
        content: JSON.stringify(deviceDefinitions.configuration, null, 2),
        category: 'device-config',
      },
      {
        path: 'devices/pin-mapping.json',
        content: JSON.stringify(deviceDefinitions.pinMapping.pins, null, 2),
        category: 'pin-mapping',
      },
    ]
  }

  if (file.type === 'server') {
    const server = project.data.servers?.find((s) => s.name === fileName)
    if (!server) return []
    return [{ path: `devices/servers/${fileName}.json`, content: JSON.stringify(server, null, 2), category: 'server' }]
  }

  if (file.type === 'remote-device') {
    const device = project.data.remoteDevices?.find((d) => d.name === fileName)
    if (!device) return []
    return [
      {
        path: `devices/remote/${fileName}.json`,
        content: JSON.stringify(device, null, 2),
        category: 'remote-device',
      },
    ]
  }

  if (file.type === 'ethercat-device') {
    const bus = project.data.remoteDevices?.find((d) => d.name === file.filePath)
    if (!bus) return []
    return [
      {
        path: `devices/remote/${file.filePath}.json`,
        content: JSON.stringify(bus, null, 2),
        category: 'remote-device',
      },
    ]
  }

  // data-type, resource: live in project.json
  return [{ path: 'project.json', content: buildProjectJsonContent(state), category: 'project-json' }]
}

// ---------------------------------------------------------------------------
// Public file-content builders
// ---------------------------------------------------------------------------

/**
 * Pure-serialize every project file (no raw fallback). Use this to capture
 * the "state at sync point" snapshot stored in
 * `versionControl.loadedSerialized`, so the save flow can later detect
 * "state hasn't changed since sync" via byte-equality comparison.
 *
 * Also used by the version-control changes panel to render the diff preview,
 * so what the user sees there is byte-identical to what the next commit
 * would upload.
 */
export function buildAllProjectFileContentsPure(): Record<string, string> {
  const state = openPLCStoreBase.getState()
  const result: Record<string, string> = {}
  for (const spec of iterateProjectFiles(state)) {
    result[spec.path] = spec.content
  }
  return result
}

/**
 * Build the file content map the save flow actually uploads. Like
 * `buildAllProjectFileContentsPure`, but applies the raw-fallback for files
 * whose serialized state hasn't changed since the last sync (byte-stable
 * echo back to S3, no phantom modifications vs HEAD).
 *
 * Used as input to `versionControlActions.commitBaseline` so the post-commit
 * baseline matches what was actually on S3 at commit time.
 */
export function buildAllProjectFileContents(): Record<string, string> {
  const state = openPLCStoreBase.getState()
  const result: Record<string, string> = {}
  for (const spec of iterateProjectFiles(state)) {
    result[spec.path] = pickContentForSave(spec.path, spec.content, state.versionControl)
  }
  return result
}

// ---------------------------------------------------------------------------
// Save flows
// ---------------------------------------------------------------------------

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
  const { project, pendingDeletions } = state
  const { setEditingState } = state.workspaceActions
  const { setAllToSaved } = state.fileActions
  const { markAllSaved } = state.snapshotActions

  const deletionsBeforeSave = [...pendingDeletions]

  setEditingState('save-request')
  toast({
    title: 'Save changes',
    description: 'Trying to save the changes in the project file.',
    variant: 'warn',
  })

  try {
    // Group every spec by category so we can build the platform's
    // category-shaped WriteProjectFiles struct without duplicating the
    // serialization logic. `pickContentForSave` keeps unedited files
    // byte-identical to their last-synced raw content.
    const pouFiles: RawProjectFile[] = []
    const serverFiles: RawProjectFile[] = []
    const remoteDeviceFiles: RawProjectFile[] = []
    let projectJson = ''
    let deviceConfig = ''
    let pinMapping = ''

    for (const spec of iterateProjectFiles(state)) {
      const content = pickContentForSave(spec.path, spec.content, state.versionControl)
      switch (spec.category) {
        case 'pou':
          pouFiles.push({ relativePath: spec.path, content })
          break
        case 'server':
          serverFiles.push({ relativePath: spec.path, content })
          break
        case 'remote-device':
          remoteDeviceFiles.push({ relativePath: spec.path, content })
          break
        case 'device-config':
          deviceConfig = content
          break
        case 'pin-mapping':
          pinMapping = content
          break
        case 'project-json':
          projectJson = content
          break
      }
    }

    const files: WriteProjectFiles = {
      projectPath: project.meta.path,
      projectJson,
      deviceConfig,
      pinMapping,
      pouFiles,
      serverFiles,
      remoteDeviceFiles,
      deletions: [...pendingDeletions],
    }

    const res = await projectPort.saveProject(files)
    if (res.success) {
      // Tell the version-control slice exactly which paths were just sent +
      // their content. The slice compares against baseline to add or remove
      // paths from `changedPaths` (handles the modify-then-save-then-revert
      // case correctly without round-tripping to /changes).
      const savedRecords = [
        { path: 'project.json', content: projectJson },
        { path: 'devices/configuration.json', content: deviceConfig },
        { path: 'devices/pin-mapping.json', content: pinMapping },
        ...pouFiles.map((f) => ({ path: f.relativePath, content: f.content })),
        ...serverFiles.map((f) => ({ path: f.relativePath, content: f.content })),
        ...remoteDeviceFiles.map((f) => ({ path: f.relativePath, content: f.content })),
      ]
      state.versionControlActions.recordSavedFiles({
        saved: savedRecords,
        deleted: deletionsBeforeSave,
      })

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
    // Use the same canonical serializer as the full-project save path so
    // both flows agree on what bytes hit disk. For POUs and JSON files this
    // is a one-shot lookup; the special `device` type returns two specs
    // (configuration + pin-mapping).
    const specs = serializeProjectFile(fileName, file, state)
    if (specs.length === 0) {
      // Some categories (e.g. ethercat-device) need handling that doesn't
      // map to a single fileName lookup, so fall through to the legacy path.
    }

    const isPouType = file.type === 'program' || file.type === 'function' || file.type === 'function-block'

    if (isPouType) {
      const spec = specs[0]
      if (!spec) return fail(`POU "${fileName}" not found.`)
      const pou = project.data.pous.find((p) => p.name === fileName)
      if (!pou) return fail(`POU "${fileName}" not found.`)
      const folder = getFolderFromPouType(pou.pouType)
      const ext = getExtensionFromLanguage(pou.body.language)
      const res = await projectPort.saveFile(joinPath(projectPath, 'pous', folder, `${fileName}${ext}`), spec.content)
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else if (file.type === 'device') {
      const config = specs.find((s) => s.category === 'device-config')
      const pin = specs.find((s) => s.category === 'pin-mapping')
      if (!config || !pin) return fail('Save failed')
      const configRes = await projectPort.saveFile(joinPath(projectPath, 'devices/configuration.json'), config.content)
      const pinRes = await projectPort.saveFile(joinPath(projectPath, 'devices/pin-mapping.json'), pin.content)
      if (!configRes.success || !pinRes.success) return fail('Save failed')
    } else if (file.type === 'server') {
      const spec = specs[0]
      if (!spec) return fail(`Server "${fileName}" not found.`)
      const res = await projectPort.saveFile(joinPath(projectPath, 'devices/servers', `${fileName}.json`), spec.content)
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else if (file.type === 'remote-device') {
      const spec = specs[0]
      if (!spec) return fail(`Remote device "${fileName}" not found.`)
      const res = await projectPort.saveFile(joinPath(projectPath, 'devices/remote', `${fileName}.json`), spec.content)
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else if (file.type === 'ethercat-device') {
      // Slave devices live inside the parent bus file. filePath holds the bus name.
      const spec = specs[0]
      if (!spec) return fail(`Parent bus "${file.filePath}" not found for device "${fileName}".`)
      const res = await projectPort.saveFile(
        joinPath(projectPath, 'devices/remote', `${file.filePath}.json`),
        spec.content,
      )
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else {
      // data-type, resource: live in project.json
      const spec = specs[0]
      if (!spec) return fail('Save failed')
      const res = await projectPort.saveFile(joinPath(projectPath, 'project.json'), spec.content)
      if (!res.success) return fail(res.error ?? 'Save failed')
    }

    // Tell the version-control slice exactly which paths/content were just
    // sent. The slice diffs against baseline to add or remove from changedPaths.
    if (specs.length > 0) {
      state.versionControlActions.recordSavedFiles({
        saved: specs.map((spec) => ({ path: spec.path, content: spec.content })),
        deleted: [],
      })
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
