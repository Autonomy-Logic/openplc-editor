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

import type { PlatformCapabilities } from '../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort, RawProjectFile, WriteProjectFiles } from '../../middleware/shared/ports/project-port'
import type { PLCPou } from '../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../store'
import type { LadderFlowType } from '../store/slices/ladder'
import { parseIecStringToVariables } from '../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../utils/generate-iec-variables-to-string'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../utils/graphical/sync-nodes-with-variables'
import { notifyNoWritePermission } from '../utils/notify-no-write-permission'
import { getExtensionFromLanguage, getFolderFromPouType } from '../utils/PLC/pou-file-extensions'
import { parseGraphicalPouFromString, parseTextualPouFromString } from '../utils/PLC/pou-text-parser'
import { serializePouToText } from '../utils/PLC/pou-text-serializer'
import { collectDebugVariables, sanitizePou } from '../utils/save-project'
import { toast } from '../utils/toast'
import { pickContentForSave } from '../utils/version-control-content'
import { collectScreenPersistenceKeys } from '../utils/vpp/persistence-keys'

/** Join path segments with forward slashes (platform-agnostic, works with Node's fs on all OSes). */
const joinPath = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')

// ---------------------------------------------------------------------------
// Project file iteration — single source of truth for path → content
// ---------------------------------------------------------------------------

type StoreState = ReturnType<typeof openPLCStoreBase.getState>

type ProjectFileCategory =
  | 'pou'
  | 'server'
  | 'remote-device'
  | 'device-config'
  | 'pin-mapping'
  | 'project-json'
  | 'library-manifest'

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
  // Preserve the project type on disk: a library opened, edited, and
  // re-saved must round-trip as `plc-library`.  The previous
  // hard-coded `plc-project` silently downgraded every library to
  // a PLC project on first save, so the project would re-open with
  // the wrong sidebar shape (Resource / Servers / Devices visible
  // instead of the Manifest tab).
  const metaType: 'plc-project' | 'plc-library' = project.meta.type === 'plc-library' ? 'plc-library' : 'plc-project'
  return JSON.stringify(
    {
      meta: { name: project.meta.name, type: metaType },
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
 *
 * Library projects yield a restricted set:
 *
 *   - POU files (functions / function blocks — libraries have no
 *     programs but the loop is identical for whichever POUs the
 *     project carries).
 *   - The library manifest (`library.json` at the project root).
 *   - A lean `project.json` (no resource / server / remote-device
 *     because those don't exist for a library; the `data.libraries`
 *     and `data.dataTypes` fields are still emitted via the same
 *     serialiser the PLC path uses).
 *
 * Configuration / pin-mapping / server / remote-device files are
 * skipped entirely for libraries — there are no runtime targets to
 * configure.  The PLC project path emits everything as before.
 */
function* iterateProjectFiles(state: StoreState): Generator<ProjectFileSpec> {
  const { project, deviceDefinitions } = state
  const isLibrary = project.meta.type === 'plc-library'

  for (const pou of project.data.pous) {
    yield buildPouSpec(pou, state)
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
      // Serialise the full per-board dict — each board's pins are
      // preserved on disk even when it's not the active target, so a
      // user switching Mega → MKR → back to Mega gets their Mega
      // pin-mapping work back. The parser accepts both this dict
      // shape and the legacy flat array (which it auto-migrates by
      // keying under the active board on load).
      content: JSON.stringify(deviceDefinitions.pinMapping.pinsByBoard, null, 2),
      category: 'pin-mapping',
    }
  }

  yield {
    path: 'project.json',
    content: buildProjectJsonContent(state),
    category: 'project-json',
  }

  // For library projects, yield `library.json` from the manifest
  // content the store carries on `project.data.libraryManifest`
  // — exact same shape POU bodies use (`project.data.pous[i].body
  // .value`): loaded from disk on project open, edited in-place by
  // the manifest editor (via a dedicated project-slice action),
  // serialised out by the standard save pipeline.  No parallel
  // dirty-tracking, no workspace-level buffer, no separate save
  // path — just one source of truth.
  if (isLibrary && typeof project.data.libraryManifest === 'string') {
    yield {
      path: 'library.json',
      content: project.data.libraryManifest,
      category: 'library-manifest',
    }
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
        // Per-board dict — see the matching comment in
        // serializeAllProjectFiles for the rationale.
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
    // Same in-store source the iterator + Monaco editor use.
    const content = project.data.libraryManifest ?? ''
    return [{ path: 'library.json', content, category: 'library-manifest' }]
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
 *
 * `capabilities` gates the success toast: on the native desktop build
 * saves go through the local filesystem and effectively never fail, so
 * surfacing "Saved!" after every save is just noise.  On the web build
 * the save round-trips through HTTP — broken token, dropped network,
 * server error are all routine — so the success toast is load-bearing
 * confirmation the user needs.  Failure toasts fire on both builds.
 */
export async function executeSaveProject(
  projectPort: ProjectPort,
  capabilities: PlatformCapabilities,
): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  // Persist gate.  Every save path — Ctrl+S, File → Save, auto-save after
  // a rename/delete, the AI panel — funnels through here.  When the viewer
  // lacks write permission (e.g. a public project they don't own) we skip
  // the doomed backend write and warn instead of surfacing a raw 401.
  // (Compile's auto-save guards on `canEdit` before calling us, so a build
  // proceeds with the in-memory project rather than tripping this.)
  if (!state.workspace.canEdit) {
    notifyNoWritePermission('save changes to')
    return { success: false }
  }
  const { project, pendingDeletions } = state
  const { setEditingState } = state.workspaceActions
  const { setAllToSaved } = state.fileActions
  const { markAllSaved } = state.snapshotActions

  const deletionsBeforeSave = [...pendingDeletions]

  setEditingState('save-request')
  // Same capability-gate as the success toast below: on desktop the
  // save is effectively instantaneous and "Trying to save…" would
  // outlive the actual save round-trip, leaving the user staring at
  // a message that looks like failure when really the save already
  // succeeded.  Web shows it because the HTTP round-trip is slow
  // enough that the user wants confirmation something's happening.
  if (!capabilities.isNativeApplication) {
    toast({
      title: 'Save changes',
      description: 'Trying to save the changes in the project file.',
      variant: 'warn',
    })
  }

  try {
    // Group every spec by category so we can build the platform's
    // category-shaped WriteProjectFiles struct without duplicating the
    // serialization logic. `pickContentForSave` keeps unedited files
    // byte-identical to their last-synced raw content.
    const pouFiles: RawProjectFile[] = []
    const serverFiles: RawProjectFile[] = []
    const remoteDeviceFiles: RawProjectFile[] = []
    let projectJson = ''
    // `deviceConfig` / `pinMapping` / `libraryManifest` stay
    // `undefined` when the iterator doesn't yield them.  Library
    // projects skip the device files; PLC projects skip the
    // manifest; either skips when the relevant tab hasn't been
    // mounted this session.  Passing an empty string used to
    // truncate the on-disk copy to 0 bytes on every save — the
    // backend now skips writes for `undefined` instead.
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

    const files: WriteProjectFiles = {
      projectPath: project.meta.path,
      projectJson,
      ...(deviceConfig !== undefined ? { deviceConfig } : {}),
      ...(pinMapping !== undefined ? { pinMapping } : {}),
      ...(libraryManifest !== undefined ? { libraryManifest } : {}),
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
        ...(deviceConfig !== undefined ? [{ path: 'devices/configuration.json', content: deviceConfig }] : []),
        ...(pinMapping !== undefined ? [{ path: 'devices/pin-mapping.json', content: pinMapping }] : []),
        ...(libraryManifest !== undefined ? [{ path: 'library.json', content: libraryManifest }] : []),
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

      if (!capabilities.isNativeApplication) {
        toast({
          title: 'Changes saved!',
          description: 'The project was saved successfully!',
          variant: 'default',
        })
      }
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
export async function executeSaveFile(
  fileName: string,
  projectPort: ProjectPort,
  capabilities: PlatformCapabilities,
): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  // See executeSaveProject for rationale — same persist gate.
  if (!state.workspace.canEdit) {
    notifyNoWritePermission('save changes to')
    return { success: false }
  }
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
    } else if (file.type === 'library-manager') {
      // Surgical save: read project.json from disk and replace only
      // the `data.libraries` field with the current in-memory list.
      // This keeps a library-manager save from carrying along other
      // unsaved project-level changes (data types, resource config,
      // debug snapshot) that the user hasn't touched in this tab.
      const res = await saveLibraryManagerOnly(projectPath, projectPort, state)
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else if (file.type === 'vendor-screen') {
      // Surgical save: read devices/configuration.json from disk and
      // replace only the `vendorScreenData` keys this screen owns
      // (computed from the screen definition's `sections[].persistence`).
      // Other screens' slices and the device editor's own fields stay
      // exactly as they are on disk.  cleanState carries the
      // serialised owned slice so the screen definition isn't needed
      // here.
      const res = await saveVendorScreenOnly(projectPath, projectPort, state, fileName)
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else if (file.type === 'library-manifest') {
      // Single-file save for the manifest tab: write the in-store
      // content (`project.data.libraryManifest`) to `library.json`.
      // Same content the full-project save's iterator yields —
      // this is just the partial-write shortcut.
      const spec = specs[0]
      if (!spec) return fail('Save failed')
      const res = await projectPort.saveFile(joinPath(projectPath, 'library.json'), spec.content)
      if (!res.success) return fail(res.error ?? 'Save failed')
    } else {
      // data-type, resource: live in project.json (legacy whole-file
      // write).  These editors don't yet have a surgical save path —
      // they still cross-contaminate each other today, which we accept
      // until each is migrated to its own read-modify-write branch
      // mirroring the library-manager case above.
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

    // Mark only this file as saved.  For tabs whose dirty-tracking
    // compares against a `cleanState` snapshot (library-manager and
    // vendor-screen today), also refresh that snapshot to the
    // just-saved state — otherwise the editor effect would
    // immediately re-mark the file unsaved on the next render.
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
      // Snapshot the just-saved manifest content as the new
      // cleanState so the file-slice dirty compare stays accurate.
      // Sources from `project.data.libraryManifest` — the only
      // place the manifest content lives.
      const cleanState = state.project.data.libraryManifest ?? ''
      updateFile({ name: fileName, saved: true, isNew: false, cleanState })
    } else {
      updateFile({ name: fileName, saved: true, isNew: false })
    }
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

    // See `executeSaveProject` for the capability-gated toast rationale.
    if (!capabilities.isNativeApplication) {
      toast({ title: 'File saved', description: `"${fileName}" saved successfully.`, variant: 'default' })
    }
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

/**
 * Surgical save for the Library Manager tab.
 *
 * Reads the on-disk `project.json`, swaps in **only** the current
 * in-memory `data.libraries` list, and writes the file back.  Other
 * project-level fields (`data.dataTypes`, `data.configuration`,
 * `data.debugVariables`, etc.) are preserved verbatim from disk so
 * unrelated unsaved edits in other tabs don't get persisted as a
 * side-effect of a library-manager save.
 *
 * Falls back gracefully if the file doesn't exist yet (new project) —
 * writes the canonical full-project serialisation in that case so the
 * caller still ends up with a valid project.json.
 */
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
    // No existing file — fall back to the canonical full-project
    // write.  This branch is unreachable in practice (the project
    // is open, so the file existed when it loaded) but keeps the
    // fallback honest.
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

/**
 * Resolve the `vendorScreenData` keys this screen tab owns.  Looks
 * up the screen definition from the current board's VPP catalogue
 * and delegates to the canonical helper in the renderer module so
 * the contract lives in exactly one place.  Empty array when the
 * screen / board is no longer available (e.g. board changed since
 * the tab opened) — callers fall through to a no-op.
 */
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

/**
 * Surgical save for a single Vendor Screen tab.  Reads
 * `devices/configuration.json` from disk, swaps in **only** the
 * `vendorScreenData` keys this screen owns (the rest of
 * vendorScreenData and every other configuration field stay verbatim
 * from disk), and writes the file back.
 *
 * This is what isolates one vendor-screen tab's save from other
 * unsaved vendor-screen tabs and from the device editor's own
 * pending edits.
 */
async function saveVendorScreenOnly(
  projectPath: string,
  projectPort: ProjectPort,
  state: ReturnType<typeof openPLCStoreBase.getState>,
  screenName: string,
): Promise<{ success: boolean; error?: string }> {
  const fullPath = joinPath(projectPath, 'devices/configuration.json')
  const ownedKeys = vendorScreenOwnedKeysFor(state, screenName)
  if (ownedKeys.length === 0) {
    // No keys to write — treat as success so the file marks clean
    // and the tab closes.  Happens when the screen definition is no
    // longer reachable (board changed).
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

  // Keep the active board's per-board bucket in lock-step with the flat view
  // we just patched, leaving every other board's bucket on disk untouched.
  // Without this, a later load would restore a stale bucket over the keys we
  // surgically saved (the archive is authoritative on load).
  const boardId = state.deviceDefinitions.configuration.deviceBoard
  const diskByBoard =
    onDisk.vendorScreenDataByBoard && typeof onDisk.vendorScreenDataByBoard === 'object'
      ? ({ ...(onDisk.vendorScreenDataByBoard as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  diskByBoard[boardId] = diskVendor
  onDisk.vendorScreenDataByBoard = diskByBoard

  return projectPort.saveFile(fullPath, JSON.stringify(onDisk, null, 2))
}

/**
 * "Don't save" revert for the Library Project's manifest tab.
 * Restores the in-store manifest content from the file-slice
 * `cleanState` snapshot — the same value that was current when
 * the tab opened — and clears the dirty flag.  Mirrors
 * `reloadLibraryManagerFromCleanState` and
 * `reloadVendorScreenFromCleanState`: no disk read, just an
 * in-store restore from the snapshot the editor seeded on mount.
 */
function reloadLibraryManifestFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'library-manifest') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : ''
  state.projectActions.updateLibraryManifest(cleanState)
  state.fileActions.updateFile({ name: fileName, saved: true })
  return { success: true }
}

/**
 * Reload a vendor-screen tab's in-memory state from its `cleanState`
 * snapshot.  Mirrors `reloadLibraryManagerFromCleanState` — parses
 * the serialised owned-slice and writes it back via the device
 * slice's bulk setter so other vendor-screen tabs and the device
 * editor stay untouched.
 */
function reloadVendorScreenFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'vendor-screen') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : '{}'
  try {
    const parsed = JSON.parse(cleanState) as unknown
    if (typeof parsed !== 'object' || parsed === null) return { success: false }
    const snapshot = parsed as Record<string, unknown>
    // Owned keys can change if the screen definition changed since
    // the tab opened (board switch).  Use the union of cleanState's
    // own keys (so we delete what the user added in this session)
    // and the screen's current owned set (so we touch the right
    // things).  In practice they overlap entirely.
    const definitionKeys = vendorScreenOwnedKeysFor(state, fileName)
    const ownedKeys = Array.from(new Set([...Object.keys(snapshot), ...definitionKeys]))
    state.deviceActions.restoreVendorScreenSlice(ownedKeys, snapshot)
    return { success: true }
  } catch {
    return { success: false }
  }
}

/**
 * Reload the Library Manager file's in-memory state from its
 * `cleanState` snapshot.
 *
 * "Don't save" needs an actual revert path for the Library Manager.
 * Project library mutations (enable / disable from the manager UI)
 * write straight into `state.project.data.libraries` via the library
 * slice's `enableLibrary` / `disableLibrary` actions — they're not
 * staged anywhere.  Without this revert, clicking "Don't save"
 * leaves the in-memory project mutated, and the next save of any
 * file (the project.json branch in `executeSaveFile` is shared by
 * data-type / resource / library-manager) would persist those
 * library changes the user explicitly discarded.
 *
 * The serialised `cleanState` is the snapshot the LibraryManagerEditor
 * captured on tab mount (or on the last successful save) — full
 * `{name, version}` refs, so a `setProjectLibraries(parsedRefs)`
 * call restores both the durable list and the derived
 * `enabledLibraries` view in one shot.
 */
function reloadLibraryManagerFromCleanState(fileName: string): { success: boolean } {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file || file.type !== 'library-manager') return { success: false }
  const cleanState = typeof file.cleanState === 'string' ? file.cleanState : '[]'
  try {
    const parsed = JSON.parse(cleanState) as unknown
    if (!Array.isArray(parsed)) return { success: false }
    // Defensive shape check — cleanState was written by the editor,
    // but a future migration could change the format and we'd rather
    // refuse than corrupt the project's library list.
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

/**
 * Generic "discard in-memory changes for this file" dispatcher.  The
 * save-changes modal's "Don't save" path uses this so the modal
 * itself doesn't need to know about every file type that supports
 * revert.  Returns `{success: true}` whenever the revert ran (or
 * was a no-op for a file type that doesn't need one); `false`
 * means the revert was *meant* to happen but failed (logged
 * upstream).
 */
export async function reloadFileFromDisk(fileName: string, projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()
  const file = state.fileActions.getFile({ name: fileName }).file
  if (!file) {
    // File entry vanished — nothing to revert.  Treat as success so
    // the modal continues to close the tab.
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
  // Everything else routes through the POU-specific reload.  Non-POU
  // file types that need a revert path should add a branch above
  // (mirroring the library-manager / vendor-screen cases) rather
  // than overloading reloadPouFromDisk.
  return reloadPouFromDisk(fileName, projectPort)
}
