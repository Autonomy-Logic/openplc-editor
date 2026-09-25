import type { PlatformCapabilities } from '../../middleware/shared/ports/platform-capabilities'
import type {
  ProjectPort,
  RawProjectFile,
  SaveResult,
  WriteProjectFiles,
} from '../../middleware/shared/ports/project-port'
import type { PLCDataType, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../store'
import type { LadderFlowType } from '../store/slices/ladder'
import { validateVariableSet } from '../store/slices/project/validation/variables'
import { flushFlowWriteBacks } from '../store/slices/shared/flow-writeback'
import { buildTypeContext, parseIecStringToVariables } from '../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../utils/generate-iec-variables-to-string'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../utils/graphical/sync-nodes-with-variables'
import { librariesUsedByProject } from '../utils/library-usage'
import { notifyNoWritePermission } from '../utils/notify-no-write-permission'
import { parseDataTypeFromText } from '../utils/PLC/data-type-declarations'
import { serializeDataTypeToText } from '../utils/PLC/data-type-serializer'
import { getExtensionFromLanguage, getFolderFromPouType } from '../utils/PLC/pou-file-extensions'
import { parseGraphicalPouFromString, parseTextualPouFromString } from '../utils/PLC/pou-text-parser'
import { serializePouToText } from '../utils/PLC/pou-text-serializer'
import { withProjectLibraries } from '../utils/PLC/project-libraries-json'
import { carryEditorMetadata } from '../utils/PLC/variable-metadata'
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
  // Declared refs, plus what the POUs actually instantiate. A project saved before blocks
  // wrote their library into `project.libraries` gets the entry here, on the side that has
  // the library installed, so the other side finally has something to warn about.
  const declared = project.data.libraries ?? []
  const derived = librariesUsedByProject(project.data.pous, state.libraries.system, state.bundledLibraryNames)
    .filter((name) => !declared.some((ref) => ref.name === name))
    .flatMap((name) => {
      const owner = state.libraries.system.find((library) => library.name === name)
      return owner ? [{ name, version: owner.version }] : []
    })
  // Alphabetical order keeps diffs stable.
  const libraries = [...declared, ...derived].sort((a, b) => a.name.localeCompare(b.name))
  // A re-saved library must round-trip as `plc-library`, not silently downgrade to `plc-project`.
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
  const sanitized = sanitizePou(
    pou,
    editorModel ?? undefined,
    buildTypeContext(state.project.data.pous, state.project.data.dataTypes, state.libraries),
  )
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

  if (isLibrary && typeof project.data.libraryManifest === 'string') {
    yield {
      path: 'library.json',
      content: project.data.libraryManifest,
      category: 'library-manifest',
    }
  }
}

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

export function flushGlobalVariableListDrafts(): void {
  const state = openPLCStoreBase.getState()
  for (const list of state.project.data.globalVariableLists ?? []) {
    state.projectActions.reconcileGlobalVariableListText(list.name)
  }
}

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

/** A `user` save on an ephemeral (device-retrieved) project is refused; `pre-build` is exempt. */
export type SaveReason = 'user' | 'pre-build'

/** With no account surface to sign back into, a queued save could never fire. */
function endedSessionCanBeRestored(capabilities: PlatformCapabilities): boolean {
  return capabilities.hasEdgeAccount
}

/** Mirrors the `/unauthorized` panel's wording for the same situation. */
const ENDED_SESSION_NO_RETURN = {
  title: 'Your editing session has ended',
  description:
    'Editing sessions are temporary and this one has run out, so nothing further can be saved from this tab. Open the project again from the application you came from to carry on.',
} as const

function refusedForHavingNoLocation(reason: SaveReason): boolean {
  if (!openPLCStoreBase.getState().workspace.isEphemeralProject || reason !== 'user') return false
  toast({
    title: 'This project has no location yet',
    description: 'It was retrieved from a device. Use Save As to choose where to keep it, then saving works as usual.',
    variant: 'warn',
  })
  return true
}

/**
 * A cloud write fails two ways: `signed-out` means the session died — queue the save to finish after sign-in;
 * `unreachable` means Edge is down — offer Save As so a local copy survives.
 */
function writeFailedForSignedOut(result: SaveResult): boolean {
  return result.reason === 'signed-out' || isSaveBlockedByEndedSession()
}

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
  // Flush debounced flow write-backs first; a flow that fails validation stays stale and must not count as saved.
  const staleFlows = flushFlowWriteBacks(openPLCStoreBase.getState)
  // Same for GVLs, which commit on blur only — Ctrl+S with focus still in Monaco never fires one.
  flushGlobalVariableListDrafts()
  const state = openPLCStoreBase.getState()
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
    const pouFiles: RawProjectFile[] = []
    const serverFiles: RawProjectFile[] = []
    const remoteDeviceFiles: RawProjectFile[] = []
    const dataTypeFiles: RawProjectFile[] = []
    let projectJson = ''
    // undefined means the iterator didn't yield it: the backend skips the write instead of truncating the on-disk
    // copy to an empty string.
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

    // A path this save writes must never also be in deletions: desktop applies deletions after writes, so this
    // guards real data loss. Compared case-insensitively for macOS/Windows case-only renames.
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
      // Tell version-control what was just sent, so it can diff against baseline without a round trip to /changes.
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

      // A stale flow keeps `updated` set and its file dirty, so the in-memory edit isn't stranded with no way back.
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
    // A stale flow means the edit never reached disk, so callers gating on this save must not proceed.
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

function getBaseNameFromRelativePath(relativePath: string): string {
  return (
    relativePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.\w+$/, '') ?? ''
  )
}

/** Writes `project.json` last, so a failure partway leaves the legacy inline `dataTypes` still authoritative. */
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

export async function executeSaveFile(
  fileName: string,
  projectPort: ProjectPort,
  capabilities: PlatformCapabilities,
): Promise<{ success: boolean }> {
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

  /** Only a failure from the write itself may trigger the session-expiry path. */
  const failedWrite = async (result: SaveResult): Promise<{ success: boolean }> => {
    setEditingState('unsaved')

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
    // Reported to version-control; the .dt migration below replaces this with its own set.
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
      // Swap only data.libraries into project.json, so unrelated unsaved edits in other tabs aren't persisted.
      const res = await saveLibraryManagerOnly(projectPath, projectPort, state)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'vendor-screen') {
      const res = await saveVendorScreenOnly(projectPath, projectPort, state, fileName)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'library-manifest') {
      const spec = specs[0]
      if (!spec) return fail('Save failed')
      const res = await projectPort.saveFile(joinPath(projectPath, 'library.json'), spec.content)
      if (!res.success) return failedWrite(res)
    } else if (file.type === 'data-type') {
      const spec = specs[0]
      if (!spec) {
        // An unparsed .dt has a tab but no entry in project.data.dataTypes.
        const unreadable = state.unparsedDataTypeFiles.some(
          (f) => getBaseNameFromRelativePath(f.relativePath).toLowerCase() === fileName.toLowerCase(),
        )
        return fail(
          unreadable
            ? `"${fileName}.dt" could not be parsed, so it can't be saved yet. Fix the declaration text first.`
            : `Data type "${fileName}" not found.`,
        )
      }
      // The first .dt save migrates the whole set: writing just this one would leave project.json's inline list
      // and the new file disagreeing.
      if (state.dataTypesNeedMigration) {
        const migration = await migrateDataTypesToFiles(projectPath, projectPort, state)
        // Report every migrated file even on failure, or version-control's changedPaths still lists them dirty.
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

    // Tabs that dirty-check against a snapshot need cleanState refreshed too, or the next render re-marks them
    // unsaved.
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

    // Clearing selections avoids a spurious dirty state on reopen from a deselection click.
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

export async function executeSaveActiveFile(
  projectPort: ProjectPort,
  capabilities: PlatformCapabilities,
): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()

  // The start screen is `path === ''` (see App.tsx). Ctrl+S there is a stray
  // keystroke rather than a save that failed, so it says nothing.
  if (!state.project.meta.path) {
    return { success: false }
  }

  const editor = state.editor

  // `available` is the union's "nothing open" case, and its `meta.name` holds
  // the literal string 'available'. Checking the name therefore read as a real
  // file and fell through to the save, which then failed looking for a file
  // called "available" — the discriminant is the field to test.
  if (editor.type === 'available' || !editor.meta.name) {
    toast({ title: 'No file open', description: 'There is no file to save.', variant: 'fail' })
    return { success: false }
  }

  return executeSaveFile(editor.meta.name, projectPort, capabilities)
}

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

    // The file's own declaration text comes first, because it is the thing that
    // just changed. `applyPouSnapshot` patches whatever text the POU already
    // holds, so without this the in-memory text from before the external edit
    // survived and the comments and formatting the user changed on disk were
    // silently reverted on the next save.
    if (parsed.variablesText !== undefined) {
      state.projectActions.setPouVariablesText(pouName, parsed.variablesText, parsed.variablesTextUnparsed === true)

      // An open code view holds the PRE-reload text, and it parses, so the
      // regenerate that `applyPouSnapshot` triggers would prefer it and patch
      // it straight back over the text just read from disk — reverting exactly
      // the external edit this function exists to pick up. The buffer is the
      // user's newest word only while it is theirs; a reload replaces it.
      const model = state.editorActions.getEditorFromEditors(pouName)
      if (model && 'variable' in model && model.variable.display === 'code') {
        state.editorActions.updateModelVariablesForName(pouName, {
          display: 'code',
          code: parsed.variablesText,
        })
      }
    }

    // Restore body, variables, and documentation
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
      // Reclassify from the POU's OWN text when it has one, not from a
      // re-serialisation of the model. Round-tripping through
      // `generateIecVariablesToString` throws away the comments and spacing
      // that only the text carries, and this runs on an external-file reload,
      // where the text is the thing that just changed (DOPE-650).
      const iecString = freshPou.variablesText ?? generateIecVariablesToString(vars)

      // The same gate the table and the code view apply. A file edited outside
      // the editor can hold a variable set the editor would never have let the
      // user build — two variables of the same name, a location that does not
      // fit the type — and reclassify used to write it straight into the store.
      // A refusal is not a failed reload: the text is kept and marked, so the
      // POU opens in the code view with the user's own bytes to repair. Same
      // answer whether the declarations are refused or will not parse at all.
      let reparsedVars: PLCVariable[] = vars
      try {
        const candidate = parseIecStringToVariables(
          iecString,
          freshState.project.data.pous,
          freshState.project.data.dataTypes,
          freshState.libraries,
        )
        if (validateVariableSet(candidate).ok) {
          reparsedVars = carryEditorMetadata(vars, candidate)
          freshState.projectActions.setPouVariables({ pouName, variables: reparsedVars })
        } else if (freshPou.variablesText !== undefined) {
          freshState.projectActions.setPouVariablesText(pouName, freshPou.variablesText, true)
        }
      } catch (err) {
        if (freshPou.variablesText !== undefined) {
          freshState.projectActions.setPouVariablesText(pouName, freshPou.variablesText, true)
        }
        console.error(`[Reload] Could not read the declarations of POU "${pouName}":`, err)
      }

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

async function saveLibraryManagerOnly(
  projectPath: string,
  projectPort: ProjectPort,
  state: ReturnType<typeof openPLCStoreBase.getState>,
): Promise<{ success: boolean; error?: string }> {
  const fullPath = joinPath(projectPath, 'project.json')

  const read = await projectPort.readFileContent(fullPath)
  if (!read.success || typeof read.content !== 'string') {
    return projectPort.saveFile(fullPath, buildProjectJsonContent(state))
  }

  // Shared with the CLI's `library pin`, so the two cannot write the field
  // differently.
  const rewritten = withProjectLibraries(read.content, state.project.data.libraries ?? [])
  if (!rewritten.ok) return { success: false, error: rewritten.error }

  return projectPort.saveFile(fullPath, rewritten.json)
}

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

async function saveVendorScreenOnly(
  projectPath: string,
  projectPort: ProjectPort,
  state: ReturnType<typeof openPLCStoreBase.getState>,
  screenName: string,
): Promise<{ success: boolean; error?: string }> {
  const fullPath = joinPath(projectPath, 'devices/configuration.json')
  const ownedKeys = vendorScreenOwnedKeysFor(state, screenName)
  if (ownedKeys.length === 0) {
    // Nothing to write — treat as success so the tab still closes.
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

  // Keep the active board's per-board bucket in sync with the flat view: the archive is authoritative on load, so a
  // stale bucket would be restored over these keys.
  const boardId = state.deviceDefinitions.configuration.deviceBoard
  const diskByBoard =
    onDisk.vendorScreenDataByBoard && typeof onDisk.vendorScreenDataByBoard === 'object'
      ? ({ ...(onDisk.vendorScreenDataByBoard as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  diskByBoard[boardId] = diskVendor
  onDisk.vendorScreenDataByBoard = diskByBoard

  return projectPort.saveFile(fullPath, JSON.stringify(onDisk, null, 2))
}

function reloadLibraryManifestFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'library-manifest') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : ''
  state.projectActions.updateLibraryManifest(cleanState)
  state.fileActions.updateFile({ name: fileName, saved: true })
  return { success: true }
}

function reloadVendorScreenFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'vendor-screen') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : '{}'
  try {
    const parsed = JSON.parse(cleanState) as unknown
    if (typeof parsed !== 'object' || parsed === null) return { success: false }
    const snapshot = parsed as Record<string, unknown>
    // Owned keys can change since the tab opened (board switch); union both sets so stale and current fields are
    // covered.
    const definitionKeys = vendorScreenOwnedKeysFor(state, fileName)
    const ownedKeys = Array.from(new Set([...Object.keys(snapshot), ...definitionKeys]))
    state.deviceActions.restoreVendorScreenSlice(ownedKeys, snapshot)
    return { success: true }
  } catch {
    return { success: false }
  }
}

function reloadLibraryManagerFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'library-manager') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : '[]'
  try {
    const parsed = JSON.parse(cleanState) as unknown
    if (!Array.isArray(parsed)) return { success: false }
    // Refuse rather than corrupt the library list if cleanState's format ever changes.
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
  return reloadPouFromDisk(fileName, projectPort)
}
