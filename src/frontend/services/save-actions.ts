/** Shared save actions for the OpenPLC editor; all path → content production funnels through `iterateProjectFiles`. */

import type { PlatformCapabilities } from '../../middleware/shared/ports/platform-capabilities'
import type {
  ProjectPort,
  RawProjectFile,
  SaveResult,
  WriteProjectFiles,
} from '../../middleware/shared/ports/project-port'
import type { PLCDataType, PLCPou } from '../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../store'
import type { LadderFlowType } from '../store/slices/ladder'
import { flushFlowWriteBacks } from '../store/slices/shared/flow-writeback'
import { parseIecStringToVariables } from '../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../utils/generate-iec-variables-to-string'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../utils/graphical/sync-nodes-with-variables'
import { notifyNoWritePermission } from '../utils/notify-no-write-permission'
import { serializeDataTypeToText } from '../utils/PLC/data-type-serializer'
import { parseDataTypeFromText } from '../utils/PLC/data-type-text-parser'
import { getExtensionFromLanguage, getFolderFromPouType } from '../utils/PLC/pou-file-extensions'
import { parseGraphicalPouFromString, parseTextualPouFromString } from '../utils/PLC/pou-text-parser'
import { serializePouToText } from '../utils/PLC/pou-text-serializer'
import { collectDebugVariables, sanitizePou } from '../utils/save-project'
import { toast } from '../utils/toast'
import { pickContentForSave } from '../utils/version-control-content'
import { collectScreenPersistenceKeys } from '../utils/vpp/persistence-keys'
import { isSaveBlockedByEndedSession, resumeSaveAfterEdgeSignIn } from './resume-save-after-sign-in'
import { executeSaveProjectAs } from './save-project-as'

/** Join path segments with forward slashes (platform-agnostic, works with Node's fs on all OSes). */
const joinPath = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')

type StoreState = ReturnType<typeof openPLCStoreBase.getState>

type ProjectFileCategory =
  | 'pou'
  | 'server'
  | 'remote-device'
  | 'device-config'
  | 'pin-mapping'
  | 'project-json'
  | 'library-manifest'
  | 'data-type'

type ProjectFileSpec = {
  path: string
  content: string
  category: ProjectFileCategory
}

function buildProjectJsonContent(state: StoreState): string {
  const { project } = state
  const debugVariables = collectDebugVariables(project.data.configurations.resource.globalVariables, project.data.pous)
  // Alphabetical order keeps diffs stable; bundled/canonical strucpp libs are always-on and omitted here.
  const libraries = [...(project.data.libraries ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  // Preserve the project type on disk: a re-saved library must round-trip as `plc-library`,
  // not silently downgrade to `plc-project`.
  const metaType: 'plc-project' | 'plc-library' = project.meta.type === 'plc-library' ? 'plc-library' : 'plc-project'
  return JSON.stringify(
    {
      meta: { name: project.meta.name, type: metaType },
      data: {
        // Types now live in datatypes/<Name>.dt; the empty array clears the inline copy on first save.
        dataTypes: [],
        // GVLs have no file of their own — project.json is their only persistence.
        globalVariableLists: project.data.globalVariableLists ?? [],
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

function buildDataTypeSpec(dt: PLCDataType): ProjectFileSpec {
  return {
    path: `datatypes/${dt.name}.dt`,
    content: serializeDataTypeToText(dt),
    category: 'data-type',
  }
}

/** Yield every file the save flow uploads, in deterministic order, with canonical serialized content. */
function* iterateProjectFiles(state: StoreState): Generator<ProjectFileSpec> {
  const { project, deviceDefinitions } = state
  const isLibrary = project.meta.type === 'plc-library'

  for (const pou of project.data.pous) {
    yield buildPouSpec(pou, state)
  }

  for (const dt of project.data.dataTypes) {
    yield buildDataTypeSpec(dt)
  }
  // Echo back unparsed .dt files verbatim; a parsed type claiming the same path wins.
  for (const f of state.unparsedDataTypeFiles) {
    if (project.data.dataTypes.some((dt) => `datatypes/${dt.name}.dt` === f.relativePath)) continue
    yield { path: f.relativePath, content: f.content, category: 'data-type' }
  }

  if (!isLibrary) {
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
      // Serialise the full per-board dict so switching boards doesn't lose the other board's pin work.
      content: JSON.stringify(deviceDefinitions.pinMapping.pinsByBoard, null, 2),
      category: 'pin-mapping',
    }
  }

  yield {
    path: 'project.json',
    content: buildProjectJsonContent(state),
    category: 'project-json',
  }

  // library.json mirrors project.data.libraryManifest — the same source the manifest editor uses.
  if (isLibrary && typeof project.data.libraryManifest === 'string') {
    yield {
      path: 'library.json',
      content: project.data.libraryManifest,
      category: 'library-manifest',
    }
  }
}

/** Resolve the canonical specs for a named file; only `device` returns multiple (config + pin-mapping). */
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
        content: JSON.stringify(deviceDefinitions.pinMapping.pinsByBoard, null, 2),
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

  if (file.type === 'library-manifest') {
    const content = project.data.libraryManifest ?? ''
    return [{ path: 'library.json', content, category: 'library-manifest' }]
  }

  if (file.type === 'data-type') {
    const dt = project.data.dataTypes.find((d) => d.name === fileName)
    return dt ? [buildDataTypeSpec(dt)] : []
  }

  // resource: lives in project.json
  return [{ path: 'project.json', content: buildProjectJsonContent(state), category: 'project-json' }]
}

/** Fold every Global Variable List's pending code-view buffer into the project; a parse failure is preserved verbatim. */
export function flushGlobalVariableListDrafts(): void {
  const state = openPLCStoreBase.getState()
  for (const list of state.project.data.globalVariableLists ?? []) {
    state.projectActions.reconcileGlobalVariableListText(list.name)
  }
}

/** Pure-serialize every project file (no raw fallback), for the sync-point snapshot and the version-control diff preview. */
export function buildAllProjectFileContentsPure(): Record<string, string> {
  flushGlobalVariableListDrafts()
  const state = openPLCStoreBase.getState()
  const result: Record<string, string> = {}
  for (const spec of iterateProjectFiles(state)) {
    result[spec.path] = spec.content
  }
  return result
}

/** Like `buildAllProjectFileContentsPure`, but applies the raw-fallback for files unchanged since the last sync. */
export function buildAllProjectFileContents(): Record<string, string> {
  const state = openPLCStoreBase.getState()
  const result: Record<string, string> = {}
  for (const spec of iterateProjectFiles(state)) {
    result[spec.path] = pickContentForSave(spec.path, spec.content, state.versionControl)
  }
  return result
}

/** Why a save is happening. A `user` save on an ephemeral (device-retrieved) project is refused; `pre-build` is exempt. */
export type SaveReason = 'user' | 'pre-build'

/** Whether the resume-queue makes sense: false when there's no account surface to sign back into. */
function endedSessionCanBeRestored(capabilities: PlatformCapabilities): boolean {
  return capabilities.hasEdgeAccount
}

/** Mirrors the `/unauthorized` panel's wording for the same situation. */
const ENDED_SESSION_NO_RETURN = {
  title: 'Your editing session has ended',
  description:
    'Editing sessions are temporary and this one has run out, so nothing further can be saved from this tab. Open the project again from the application you came from to carry on.',
} as const

/** Refuse a user-initiated save on a project with no chosen location (e.g. retrieved from a device); the flush is exempt. */
function refusedForHavingNoLocation(reason: SaveReason): boolean {
  if (!openPLCStoreBase.getState().workspace.isEphemeralProject || reason !== 'user') return false
  toast({
    title: 'This project has no location yet',
    description: 'It was retrieved from a device. Use Save As to choose where to keep it, then saving works as usual.',
    variant: 'warn',
  })
  return true
}

/** Whether a failed write means the session is gone. */
function writeFailedForSignedOut(result: SaveResult): boolean {
  return result.reason === 'signed-out' || isSaveBlockedByEndedSession()
}

/** Fall back to Save As when Autonomy Edge is unreachable and there's a local filesystem to write to. */
function canFallBackToSaveAs(result: SaveResult, capabilities: PlatformCapabilities): boolean {
  return result.reason === 'unreachable' && capabilities.hasLocalFilesystem
}

async function fallBackToSaveAs(projectPort: ProjectPort, capabilities: PlatformCapabilities): Promise<boolean> {
  toast({
    title: 'Autonomy Edge could not be reached',
    description: 'Choose a folder to keep a local copy of the project, so nothing you did is lost.',
    variant: 'warn',
  })
  const saved = await executeSaveProjectAs(projectPort, capabilities)
  return saved.success
}

export async function executeSaveProject(
  projectPort: ProjectPort,
  capabilities: PlatformCapabilities,
  reason: SaveReason = 'user',
): Promise<{ success: boolean }> {
  // Flush pending debounced flow write-backs first; a flow that fails validation stays stale
  // and must not be reported as saved.
  const staleFlows = flushFlowWriteBacks(openPLCStoreBase.getState)
  // Same for GVLs, which commit on blur only — Ctrl+S with focus still in Monaco never fires one.
  flushGlobalVariableListDrafts()
  const state = openPLCStoreBase.getState()
  // Every save path funnels through this gate; skip the doomed write and warn when the viewer
  // lacks write permission.
  if (!state.workspace.canEdit) {
    notifyNoWritePermission('save changes to')
    return { success: false }
  }

  if (refusedForHavingNoLocation(reason)) return { success: false }

  const { project, pendingDeletions } = state
  const { setEditingState } = state.workspaceActions
  const { setAllToSaved, updateFile } = state.fileActions
  const { markAllSaved } = state.snapshotActions

  setEditingState('save-request')
  if (!capabilities.isNativeApplication) {
    toast({
      title: 'Save changes',
      description: 'Trying to save the changes in the project file.',
      variant: 'warn',
    })
  }

  try {
    // Group every spec by category to build the platform's category-shaped write payload
    // without duplicating serialization logic.
    const pouFiles: RawProjectFile[] = []
    const serverFiles: RawProjectFile[] = []
    const remoteDeviceFiles: RawProjectFile[] = []
    const dataTypeFiles: RawProjectFile[] = []
    let projectJson = ''
    // undefined here means the iterator didn't yield it; the backend skips writes for
    // undefined instead of truncating the on-disk copy to an empty string.
    let deviceConfig: string | undefined
    let pinMapping: string | undefined
    let libraryManifest: string | undefined

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
        case 'data-type':
          dataTypeFiles.push({ relativePath: spec.path, content })
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
        case 'library-manifest':
          libraryManifest = content
          break
      }
    }

    // A path this save writes must never also be in deletions (a create → delete → create cycle
    // would list it in both). Desktop applies deletions after writes, so this guards a real
    // data-loss bug; compared case-insensitively for macOS/Windows case-only renames.
    const writtenPaths = new Set(
      [...pouFiles, ...serverFiles, ...remoteDeviceFiles, ...dataTypeFiles].map((f) => f.relativePath.toLowerCase()),
    )
    const deletionsBeforeSave = [...new Set(pendingDeletions)].filter((path) => !writtenPaths.has(path.toLowerCase()))

    const files: WriteProjectFiles = {
      projectPath: project.meta.path,
      projectJson,
      ...(deviceConfig !== undefined ? { deviceConfig } : {}),
      ...(pinMapping !== undefined ? { pinMapping } : {}),
      ...(libraryManifest !== undefined ? { libraryManifest } : {}),
      pouFiles,
      serverFiles,
      remoteDeviceFiles,
      dataTypeFiles,
      deletions: deletionsBeforeSave,
    }

    const res = await projectPort.saveProject(files)
    if (res.success) {
      // Tell version-control exactly which paths/content were just sent, so it can diff
      // against baseline (handles modify→save→revert without a round trip to /changes).
      const savedRecords = [
        { path: 'project.json', content: projectJson },
        ...(deviceConfig !== undefined ? [{ path: 'devices/configuration.json', content: deviceConfig }] : []),
        ...(pinMapping !== undefined ? [{ path: 'devices/pin-mapping.json', content: pinMapping }] : []),
        ...(libraryManifest !== undefined ? [{ path: 'library.json', content: libraryManifest }] : []),
        ...pouFiles.map((f) => ({ path: f.relativePath, content: f.content })),
        ...serverFiles.map((f) => ({ path: f.relativePath, content: f.content })),
        ...remoteDeviceFiles.map((f) => ({ path: f.relativePath, content: f.content })),
        ...dataTypeFiles.map((f) => ({ path: f.relativePath, content: f.content })),
      ]
      state.versionControlActions.recordSavedFiles({
        saved: savedRecords,
        deleted: deletionsBeforeSave,
      })

      const isStale = new Set(staleFlows)

      state.projectActions.clearPendingDeletions()
      state.projectActions.setDataTypesNeedMigration(false)
      setEditingState(staleFlows.length > 0 ? 'unsaved' : 'saved')
      setAllToSaved()
      markAllSaved(staleFlows)

      // A stale flow keeps `updated` set and its file dirty; skip it here so the in-memory
      // edit isn't stranded with no way back to disk.
      for (const flow of state.ladderFlows) {
        state.ladderFlowActions.clearSelections({ editorName: flow.name })
        if (isStale.has(flow.name)) continue
        state.ladderFlowActions.setFlowUpdated({ editorName: flow.name, updated: false })
      }
      for (const flow of state.fbdFlows) {
        state.fbdFlowActions.clearSelections({ editorName: flow.name })
        if (isStale.has(flow.name)) continue
        state.fbdFlowActions.setFlowUpdated({ editorName: flow.name, updated: false })
      }
      // Must stay after `setAllToSaved()` above, which marks every file saved.
      for (const name of staleFlows) {
        updateFile({ name, saved: false })
      }

      if (staleFlows.length > 0) {
        toast({
          title: 'Some changes were not saved',
          description: `The graphical body of ${staleFlows.join(', ')} is invalid and could not be written to disk. Every other file was saved.`,
          variant: 'fail',
        })
      } else if (!capabilities.isNativeApplication) {
        toast({
          title: 'Changes saved!',
          description: 'The project was saved successfully!',
          variant: 'default',
        })
      }
    } else if (writeFailedForSignedOut(res)) {
      // A dead session isn't a save error; queue the save so signing in finishes it instead
      // of surfacing a raw 401.
      setEditingState('unsaved')

      if (!endedSessionCanBeRestored(capabilities)) {
        toast({ ...ENDED_SESSION_NO_RETURN, variant: 'fail' })
        return { success: false }
      }

      resumeSaveAfterEdgeSignIn(() => executeSaveProject(projectPort, capabilities))
      toast({
        title: 'Not saved — your session ended',
        description: 'Sign in again and this save finishes on its own. Everything you typed is still open here.',
        variant: 'fail',
      })
    } else if (canFallBackToSaveAs(res, capabilities)) {
      setEditingState('unsaved')
      return { success: (await fallBackToSaveAs(projectPort, capabilities)) && staleFlows.length === 0 }
    } else {
      setEditingState('unsaved')
      toast({
        title: 'Error in the save request!',
        description: res.error ?? 'Save failed',
        variant: 'fail',
      })
    }
    // A stale flow means the edit never reached disk, so callers gating on this save
    // (build, close-project) must not proceed.
    return { success: res.success && staleFlows.length === 0 }
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

/** Basename of a project-relative path, minus its extension; splits on both separators since paths may use either. */
function getBaseNameFromRelativePath(relativePath: string): string {
  return (
    relativePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.\w+$/, '') ?? ''
  )
}

/** One-time migration off legacy inline `dataTypes` onto `datatypes/*.dt`; writes `project.json` last so a failure is a no-op. */
async function migrateDataTypesToFiles(
  projectPath: string,
  projectPort: ProjectPort,
  state: StoreState,
): Promise<SaveResult & { written: ProjectFileSpec[] }> {
  const written: ProjectFileSpec[] = []
  for (const dt of state.project.data.dataTypes) {
    const spec = buildDataTypeSpec(dt)
    const res = await projectPort.saveFile(joinPath(projectPath, ...spec.path.split('/')), spec.content)
    if (!res.success) return { ...res, written }
    written.push(spec)
  }
  const indexSpec: ProjectFileSpec = {
    path: 'project.json',
    content: buildProjectJsonContent(state),
    category: 'project-json',
  }
  const res = await projectPort.saveFile(joinPath(projectPath, 'project.json'), indexSpec.content)
  if (res.success) written.push(indexSpec)
  return { ...res, written }
}

/** Core single-file save logic shared by Ctrl+S and direct callers; POUs serialize to IEC text, others to JSON. */
export async function executeSaveFile(
  fileName: string,
  projectPort: ProjectPort,
  capabilities: PlatformCapabilities,
): Promise<{ success: boolean }> {
  // Same pending write-back flush as executeSaveProject, scoped to this file.
  const staleFlows = flushFlowWriteBacks(openPLCStoreBase.getState, fileName)
  // A GVL rides inside project.json, which this path rewrites, so its buffer is folded in too.
  flushGlobalVariableListDrafts()
  const state = openPLCStoreBase.getState()
  // See executeSaveProject for rationale — same persist gate.
  if (!state.workspace.canEdit) {
    notifyNoWritePermission('save changes to')
    return { success: false }
  }
  // Same again: every caller of this is a person pressing Save.
  if (refusedForHavingNoLocation('user')) return { success: false }
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

  /** A failure from the write itself, not from this function, so only a real write failure triggers the session-expiry path. */
  const failedWrite = async (result: SaveResult): Promise<{ success: boolean }> => {
    setEditingState('unsaved')

    // An expired session isn't a file error; queue the save so signing in completes it.
    if (writeFailedForSignedOut(result)) {
      if (!endedSessionCanBeRestored(capabilities)) {
        toast({ ...ENDED_SESSION_NO_RETURN, variant: 'fail' })
        return { success: false }
      }

      resumeSaveAfterEdgeSignIn(() => executeSaveFile(fileName, projectPort, capabilities), {
        scope: 'file',
        fileName,
      })
      toast({
        title: 'Not saved — your session ended',
        description: `Sign in again and "${fileName}" saves on its own. Everything you typed is still open here.`,
        variant: 'fail',
      })
      return { success: false }
    }

    // One file of a cloud project cannot be kept on its own; the whole project is.
    if (canFallBackToSaveAs(result, capabilities)) {
      return { success: await fallBackToSaveAs(projectPort, capabilities) }
    }

    toast({ title: 'Error saving file', description: result.error ?? 'Save failed', variant: 'fail' })
    return { success: false }
  }

  // Writing the stale body would overwrite disk with pre-edit content and report success — abort instead.
  if (staleFlows.includes(fileName)) {
    return fail(`The graphical body of "${fileName}" is invalid, so the file was not written to disk.`)
  }

  try {
    // Same canonical serializer the full-project save uses; `device` returns two specs
    // (configuration + pin-mapping).
    const specs = serializeProjectFile(fileName, file, state)
    // Paths reported to version-control; a .dt migration below replaces this with its own set.
    let recordedSpecs: ProjectFileSpec[] = specs
    if (specs.length === 0) {
      // Some categories (e.g. ethercat-device) don't map to a single lookup — fall through below.
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
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'device') {
      const config = specs.find((s) => s.category === 'device-config')
      const pin = specs.find((s) => s.category === 'pin-mapping')
      if (!config || !pin) return fail('Save failed')
      const configRes = await projectPort.saveFile(joinPath(projectPath, 'devices/configuration.json'), config.content)
      const pinRes = await projectPort.saveFile(joinPath(projectPath, 'devices/pin-mapping.json'), pin.content)
      if (!configRes.success) return failedWrite(configRes)
      if (!pinRes.success) return failedWrite(pinRes)
    } else if (file.type === 'server') {
      const spec = specs[0]
      if (!spec) return fail(`Server "${fileName}" not found.`)
      const res = await projectPort.saveFile(joinPath(projectPath, 'devices/servers', `${fileName}.json`), spec.content)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'remote-device') {
      const spec = specs[0]
      if (!spec) return fail(`Remote device "${fileName}" not found.`)
      const res = await projectPort.saveFile(joinPath(projectPath, 'devices/remote', `${fileName}.json`), spec.content)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'ethercat-device') {
      // Slave devices live inside the parent bus file. filePath holds the bus name.
      const spec = specs[0]
      if (!spec) return fail(`Parent bus "${file.filePath}" not found for device "${fileName}".`)
      const res = await projectPort.saveFile(
        joinPath(projectPath, 'devices/remote', `${file.filePath}.json`),
        spec.content,
      )
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'library-manager') {
      // Surgical save: swap only data.libraries into project.json so unrelated unsaved
      // edits in other tabs aren't persisted.
      const res = await saveLibraryManagerOnly(projectPath, projectPort, state)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'vendor-screen') {
      // Surgical save: swap only this screen's owned vendorScreenData keys into
      // devices/configuration.json.
      const res = await saveVendorScreenOnly(projectPath, projectPort, state, fileName)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'library-manifest') {
      // Partial-write shortcut for the manifest tab — same content the full-project
      // save's iterator yields.
      const spec = specs[0]
      if (!spec) return fail('Save failed')
      const res = await projectPort.saveFile(joinPath(projectPath, 'library.json'), spec.content)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'data-type') {
      const spec = specs[0]
      if (!spec) {
        // An unparsed .dt has a tab but no entry in project.data.dataTypes; say so instead
        // of a misleading "not found".
        const unreadable = state.unparsedDataTypeFiles.some(
          (f) => getBaseNameFromRelativePath(f.relativePath).toLowerCase() === fileName.toLowerCase(),
        )
        return fail(
          unreadable
            ? `"${fileName}.dt" could not be parsed, so it can't be saved yet. Fix the declaration text first.`
            : `Data type "${fileName}" not found.`,
        )
      }
      // First .dt save migrates the whole set in one go — writing just this one would leave
      // project.json's inline list and the new file disagreeing.
      if (state.dataTypesNeedMigration) {
        const migration = await migrateDataTypesToFiles(projectPath, projectPort, state)
        // Report every migrated file even on failure, or version-control's changedPaths
        // would still list them dirty.
        recordedSpecs = migration.written
        if (!migration.success) return failedWrite(migration)
        state.projectActions.setDataTypesNeedMigration(false)
      } else {
        const res = await projectPort.saveFile(joinPath(projectPath, 'datatypes', `${fileName}.dt`), spec.content)
        if (!res.success) return failedWrite(res)
      }
    } else {
      // resource: lives in project.json (legacy whole-file write)
      const spec = specs[0]
      if (!spec) return fail('Save failed')
      const res = await projectPort.saveFile(joinPath(projectPath, 'project.json'), spec.content)
      if (!res.success) return failedWrite(res)
    }

    if (recordedSpecs.length > 0) {
      state.versionControlActions.recordSavedFiles({
        saved: recordedSpecs.map((spec) => ({ path: spec.path, content: spec.content })),
        deleted: [],
      })
    }

    // Refresh cleanState too for tabs that dirty-check against a snapshot (library-manager,
    // vendor-screen), or the next render re-marks them unsaved.
    if (file.type === 'library-manager') {
      const refs = state.project.data.libraries ?? []
      const cleanState = JSON.stringify(
        [...refs].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ name: r.name, version: r.version })),
      )
      updateFile({ name: fileName, saved: true, isNew: false, cleanState })
    } else if (file.type === 'vendor-screen') {
      const ownedKeys = vendorScreenOwnedKeysFor(state, fileName)
      const cleanState = serializeVendorScreenSlice(state, ownedKeys)
      updateFile({ name: fileName, saved: true, isNew: false, cleanState })
    } else if (file.type === 'library-manifest') {
      const cleanState = state.project.data.libraryManifest ?? ''
      updateFile({ name: fileName, saved: true, isNew: false, cleanState })
    } else {
      updateFile({ name: fileName, saved: true, isNew: false })
    }
    markSaved(fileName)

    // Clear selections (avoids spurious dirty on reopen from a deselection click) and
    // reset updated flags.
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

    if (checkIfAllFilesAreSaved()) {
      setEditingState('saved')
    } else {
      setEditingState('unsaved')
    }

    // See `executeSaveProject` for the capability-gated toast rationale.
    if (!capabilities.isNativeApplication) {
      toast({ title: 'File saved', description: `"${fileName}" saved successfully.`, variant: 'default' })
    }
    return { success: true }
  } catch {
    return fail('An unexpected error occurred.')
  }
}

/** Save the active file (Ctrl+S); resolves the active editor name and delegates to executeSaveFile. */
export async function executeSaveActiveFile(
  projectPort: ProjectPort,
  capabilities: PlatformCapabilities,
): Promise<{ success: boolean }> {
  const name = openPLCStoreBase.getState().editor.meta.name
  if (!name) {
    toast({ title: 'No file open', description: 'There is no file to save.', variant: 'fail' })
    return { success: false }
  }
  return executeSaveFile(name, projectPort, capabilities)
}

/** Reload a POU from disk, discarding in-memory edits, via the same parse/restore/reclassify cycle as project open. */
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

    const isGraphical = language === 'ld' || language === 'fbd'
    const parsed: PLCPou = isGraphical
      ? parseGraphicalPouFromString(result.content, language, pou.pouType)
      : parseTextualPouFromString(result.content, language, pou.pouType)

    state.projectActions.applyPouSnapshot(pouName, parsed.interface?.variables ?? [], parsed.body)
    if (parsed.documentation !== undefined) {
      state.projectActions.updatePouDocumentation(pouName, parsed.documentation)
    }

    if (language === 'ld' && parsed.body.value) {
      state.ladderFlowActions.addLadderFlow(parsed.body.value as LadderFlowType)
    } else if (language === 'fbd' && parsed.body.value) {
      state.fbdFlowActions.addFBDFlow(
        parsed.body.value as unknown as Parameters<typeof state.fbdFlowActions.addFBDFlow>[0],
      )
    }

    // Reclassify variables with full project context (same as handleOpenProjectResponse).
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

      if (language === 'ld') {
        const pouFlows = openPLCStoreBase.getState().ladderFlows.filter((f) => f.name === pouName)
        if (pouFlows.length > 0) {
          syncNodesWithVariables(reparsedVars, pouFlows, openPLCStoreBase.getState().ladderFlowActions.updateNodes)
        }
        // Reset flow updated flag (syncNodesWithVariables triggers updateNodes which sets updated=true).
        openPLCStoreBase.getState().ladderFlowActions.setFlowUpdated({ editorName: pouName, updated: false })
      } else if (language === 'fbd') {
        const pouFlows = openPLCStoreBase.getState().fbdFlows.filter((f) => f.name === pouName)
        if (pouFlows.length > 0) {
          syncNodesWithVariablesFBD(reparsedVars, pouFlows, openPLCStoreBase.getState().fbdFlowActions.updateNodes)
        }
        openPLCStoreBase.getState().fbdFlowActions.setFlowUpdated({ editorName: pouName, updated: false })
      }
    }

    return { success: true }
  } catch {
    return { success: false }
  }
}

/** Reload a data type from its `.dt` file; a name mismatch fails the reload rather than silently rekeying it. */
export async function reloadDataTypeFromDisk(name: string, projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const dt = state.project.data.dataTypes.find((d) => d.name === name)
  if (!dt) return { success: false }

  try {
    const fullPath = joinPath(state.project.meta.path, 'datatypes', `${name}.dt`)
    const result = await projectPort.readFileContent(fullPath)
    if (!result.success || !result.content) return { success: false }

    const parsed = parseDataTypeFromText(result.content, name)
    if (!parsed.dataType) return { success: false }

    state.projectActions.applyDatatypeSnapshot(name, parsed.dataType)
    return { success: true }
  } catch (error) {
    console.error(`Failed to reload data type "${name}" from disk:`, error)
    return { success: false }
  }
}

/** Surgical save for the Library Manager tab: swaps only `data.libraries` into `project.json`, preserving everything else. */
async function saveLibraryManagerOnly(
  projectPath: string,
  projectPort: ProjectPort,
  state: ReturnType<typeof openPLCStoreBase.getState>,
): Promise<{ success: boolean; error?: string }> {
  const fullPath = joinPath(projectPath, 'project.json')
  const refs = state.project.data.libraries ?? []
  const sortedRefs = [...refs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ name: r.name, version: r.version }))

  const read = await projectPort.readFileContent(fullPath)
  if (!read.success || typeof read.content !== 'string') {
    // No existing file — fall back to the canonical full-project write (unreachable in
    // practice, but keeps the fallback honest).
    return projectPort.saveFile(fullPath, buildProjectJsonContent(state))
  }

  let onDisk: Record<string, unknown>
  try {
    const parsed = JSON.parse(read.content) as unknown
    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, error: 'project.json on disk is not an object' }
    }
    onDisk = parsed as Record<string, unknown>
  } catch {
    return { success: false, error: 'project.json on disk is malformed' }
  }

  const data =
    onDisk.data && typeof onDisk.data === 'object'
      ? (onDisk.data as Record<string, unknown>)
      : ((onDisk.data = {}), onDisk.data as Record<string, unknown>)
  data.libraries = sortedRefs

  return projectPort.saveFile(fullPath, JSON.stringify(onDisk, null, 2))
}

/** Resolve the vendorScreenData keys this screen tab owns; empty when the screen/board is no longer available. */
function vendorScreenOwnedKeysFor(state: ReturnType<typeof openPLCStoreBase.getState>, screenName: string): string[] {
  const boardId = state.deviceDefinitions.configuration.deviceBoard
  const boardInfo = state.deviceAvailableOptions.availableBoards.get(boardId)
  const screen = boardInfo?.vpp?.screens?.[screenName]
  return collectScreenPersistenceKeys(screen)
}

function serializeVendorScreenSlice(state: ReturnType<typeof openPLCStoreBase.getState>, ownedKeys: string[]): string {
  const vendorScreenData = state.deviceDefinitions.configuration.vendorScreenData ?? {}
  const slice: Record<string, unknown> = {}
  for (const k of [...ownedKeys].sort()) {
    if (Object.prototype.hasOwnProperty.call(vendorScreenData, k)) {
      slice[k] = vendorScreenData[k]
    }
  }
  return JSON.stringify(slice)
}

/** Surgical save for a Vendor Screen tab: swaps only this screen's owned keys into `devices/configuration.json`. */
async function saveVendorScreenOnly(
  projectPath: string,
  projectPort: ProjectPort,
  state: ReturnType<typeof openPLCStoreBase.getState>,
  screenName: string,
): Promise<{ success: boolean; error?: string }> {
  const fullPath = joinPath(projectPath, 'devices/configuration.json')
  const ownedKeys = vendorScreenOwnedKeysFor(state, screenName)
  if (ownedKeys.length === 0) {
    // No keys to write (screen/board no longer available) — treat as success so the tab still closes.
    return { success: true }
  }

  const memVendor = state.deviceDefinitions.configuration.vendorScreenData ?? {}

  const read = await projectPort.readFileContent(fullPath)
  let onDisk: Record<string, unknown> = {}
  if (read.success && typeof read.content === 'string') {
    try {
      const parsed = JSON.parse(read.content) as unknown
      if (typeof parsed === 'object' && parsed !== null) {
        onDisk = parsed as Record<string, unknown>
      }
    } catch {
      return { success: false, error: 'devices/configuration.json on disk is malformed' }
    }
  }

  const diskVendor =
    onDisk.vendorScreenData && typeof onDisk.vendorScreenData === 'object'
      ? ({ ...(onDisk.vendorScreenData as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  for (const key of ownedKeys) {
    if (Object.prototype.hasOwnProperty.call(memVendor, key)) {
      diskVendor[key] = memVendor[key]
    } else {
      delete diskVendor[key]
    }
  }
  onDisk.vendorScreenData = diskVendor

  // Keep the active board's per-board bucket in sync with the flat view we just patched —
  // otherwise a later load restores a stale bucket over these keys (the archive is
  // authoritative on load).
  const boardId = state.deviceDefinitions.configuration.deviceBoard
  const diskByBoard =
    onDisk.vendorScreenDataByBoard && typeof onDisk.vendorScreenDataByBoard === 'object'
      ? ({ ...(onDisk.vendorScreenDataByBoard as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  diskByBoard[boardId] = diskVendor
  onDisk.vendorScreenDataByBoard = diskByBoard

  return projectPort.saveFile(fullPath, JSON.stringify(onDisk, null, 2))
}

/** "Don't save" revert for the Library Project's manifest tab: restores from the file-slice `cleanState` snapshot. */
function reloadLibraryManifestFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'library-manifest') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : ''
  state.projectActions.updateLibraryManifest(cleanState)
  state.fileActions.updateFile({ name: fileName, saved: true })
  return { success: true }
}

/** Reload a vendor-screen tab from its `cleanState` snapshot via the device slice's bulk setter, so others stay untouched. */
function reloadVendorScreenFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'vendor-screen') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : '{}'
  try {
    const parsed = JSON.parse(cleanState) as unknown
    if (typeof parsed !== 'object' || parsed === null) return { success: false }
    const snapshot = parsed as Record<string, unknown>
    // Owned keys can change since the tab opened (board switch); union cleanState's own keys
    // with the current definition's so both stale and current fields are covered.
    const definitionKeys = vendorScreenOwnedKeysFor(state, fileName)
    const ownedKeys = Array.from(new Set([...Object.keys(snapshot), ...definitionKeys]))
    state.deviceActions.restoreVendorScreenSlice(ownedKeys, snapshot)
    return { success: true }
  } catch {
    return { success: false }
  }
}

/** Revert the Library Manager tab from its `cleanState` snapshot; library mutations write with no staging otherwise. */
function reloadLibraryManagerFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'library-manager') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : '[]'
  try {
    const parsed = JSON.parse(cleanState) as unknown
    if (!Array.isArray(parsed)) return { success: false }
    // Defensive shape check — refuse rather than corrupt the library list if a future
    // migration changes cleanState's format.
    const refs: { name: string; version: string }[] = []
    for (const r of parsed) {
      if (
        typeof r === 'object' &&
        r !== null &&
        typeof (r as { name?: unknown }).name === 'string' &&
        typeof (r as { version?: unknown }).version === 'string'
      ) {
        refs.push({ name: (r as { name: string }).name, version: (r as { version: string }).version })
      }
    }
    state.libraryActions.setProjectLibraries(refs)
    return { success: true }
  } catch {
    return { success: false }
  }
}

/** Generic "discard in-memory changes for this file" dispatcher, so callers don't need to know every revertable type. */
export async function reloadFileFromDisk(fileName: string, projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file) {
    // File entry vanished — nothing to revert; treat as success so the modal still closes the tab.
    return { success: true }
  }
  if (file.type === 'library-manager') {
    return reloadLibraryManagerFromCleanState(fileName)
  }
  if (file.type === 'vendor-screen') {
    return reloadVendorScreenFromCleanState(fileName)
  }
  if (file.type === 'library-manifest') {
    return reloadLibraryManifestFromCleanState(fileName)
  }
  if (file.type === 'data-type') {
    return reloadDataTypeFromDisk(fileName, projectPort)
  }
  // Everything else routes through the POU-specific reload; add new revertible types as a
  // branch above instead.
  return reloadPouFromDisk(fileName, projectPort)
}
