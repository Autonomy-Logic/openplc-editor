/**
 * Editor ProjectPort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process project-service and pou-service via IPC.
 * Files are stored on the local filesystem. Recent projects are tracked in electron-store.
 *
 * Type mapping:
 *   - Editor POUs use a discriminated union: { type: 'program', data: { name, ... } }
 *   - Port POUs use a flat format: { name, pouType: 'program', ... }
 *   - Editor uses `configuration` (singular), port uses `configurations` (plural)
 */

import { parseProjectFiles } from '../../../backend/shared/utils/parse-project-files'
import { buildProjectResponseFromPlcopenParse } from '../../../frontend/utils/PLC/build-plcopen-project-response'
import { parsePlcopenXml } from '../../../frontend/utils/PLC/xml-parser'
import type {
  CloudFoldersResult,
  CloudProjectsResult,
  CreatePouParams,
  CreateProjectParams,
  ProjectPort,
  ProjectResponse,
  RawProjectFiles,
  RenamePouParams,
  UploadProjectParams,
  UploadProjectResult,
  WriteProjectFiles,
} from '../../shared/ports/project-port'
import {
  CloudFoldersResultSchema,
  CloudProjectsResultSchema,
  UploadProjectResultSchema,
} from '../../shared/ports/project-port'
import type {
  DeviceConfiguration,
  DevicePin,
  PLCDataType,
  PLCInstance,
  PLCPou,
  PLCProjectData,
  PLCTask,
  PLCVariable,
  RecentProject,
  Unsubscribe,
} from '../../shared/ports/types'
import { isRemoteProjectPath } from '../../shared/ports/types'

/** Editor IPC POU shape (discriminated union). */
interface IpcPou {
  type: string
  data: {
    name: string
    language?: string
    variables: unknown[]
    returnType?: string
    body: { language: string; value: unknown }
    documentation: string
    variablesText?: string
  }
}

/** Editor IPC project response shape. */
interface IpcProjectResponse {
  success: boolean
  error?: { title: string; description: string; error?: unknown }
  data?: {
    meta: { path: string }
    content: {
      project: {
        meta: { name: string; type: 'plc-project' | 'plc-library' }
        data: {
          dataTypes: PLCDataType[]
          globalVariableLists?: PLCProjectData['globalVariableLists']
          pous: IpcPou[]
          configuration: { resource: { tasks: PLCTask[]; instances: PLCInstance[]; globalVariables: PLCVariable[] } }
          servers?: unknown[]
          remoteDevices?: unknown[]
          debugVariables?: { global?: string[]; pous?: Record<string, string[]> }
        }
      }
      pous: IpcPou[]
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }
}

/** Editor IPC POU service response shape. */
interface IpcPouResponse {
  success: boolean
  error?: { title: string; description: string; error?: unknown }
  data?: { filePath?: string; pou?: unknown }
}

/**
 * Maps editor discriminated-union POU to port flat POU format.
 */
function mapIpcPouToPortPou(ipcPou: IpcPou): PLCPou {
  return {
    name: ipcPou.data.name,
    pouType: ipcPou.type as PLCPou['pouType'],
    interface: {
      returnType: ipcPou.data.returnType,
      variables: ipcPou.data.variables as PLCVariable[],
    },
    body: ipcPou.data.body as PLCPou['body'],
    documentation: ipcPou.data.documentation || undefined,
  }
}

/**
 * Converts port flat POU to editor discriminated-union format.
 */
function mapPortPouToIpcPou(portPou: PLCPou): IpcPou {
  return {
    type: portPou.pouType,
    data: {
      name: portPou.name,
      language: portPou.body.language,
      variables: (portPou.interface?.variables ?? []) as unknown[],
      ...(portPou.interface?.returnType ? { returnType: portPou.interface.returnType } : {}),
      body: portPou.body as { language: string; value: unknown },
      documentation: portPou.documentation ?? '',
    },
  }
}

/**
 * Maps an IPC project response to the port's ProjectResponse format.
 */
function mapIpcResponse(
  response: IpcProjectResponse,
  fallbackMeta?: { name: string; type: 'plc-project' | 'plc-library' },
): ProjectResponse {
  if (!response.success || !response.data) {
    return {
      success: false,
      error: response.error ? { title: response.error.title, description: response.error.description } : undefined,
    }
  }

  const { content, meta } = response.data

  const projectMeta = content.project.meta ?? fallbackMeta
  const configuration = content.project.data.configuration

  return {
    success: true,
    data: {
      meta: {
        name: projectMeta?.name ?? '',
        type: projectMeta?.type ?? 'plc-project',
        path: meta.path,
      },
      projectData: {
        dataTypes: content.project.data.dataTypes,
        // `parseProjectFiles` reads the lists correctly in the main process;
        // this object then reassembles the shape field by field, so a list not
        // named here is dropped on open however well the schema validated it.
        globalVariableLists: content.project.data.globalVariableLists ?? [],
        pous: content.pous.map(mapIpcPouToPortPou),
        configurations: configuration,
        servers: content.project.data.servers as PLCProjectData['servers'],
        remoteDevices: content.project.data.remoteDevices as PLCProjectData['remoteDevices'],
        // Defensive default: legacy projects on disk have no
        // `libraries` field; the schema's `default([])` covers parsed
        // payloads but the IPC route reaches us with the raw shape.
        libraries: (content.project.data as { libraries?: PLCProjectData['libraries'] }).libraries ?? [],
        // Threading the library manifest content through the create
        // response so the post-create handler seeds the in-memory
        // store with the same content that just landed on disk —
        // same pattern POU bodies use (parsed from the .st files in
        // `content.pous`).  The manifest lives at `content.libraryManifest`
        // (mirrors the on-disk shape: `project.json` carries no
        // manifest, `library.json` is its own file), NOT inside the
        // project.json blob.
        ...(typeof (content as { libraryManifest?: string }).libraryManifest === 'string'
          ? { libraryManifest: (content as { libraryManifest?: string }).libraryManifest }
          : {}),
        debugVariables: content.project.data.debugVariables,
      },
      deviceConfiguration: content.deviceConfiguration,
      devicePinMapping: content.devicePinMapping,
    },
  }
}

/**
 * Whether an identifier names a project on Autonomy Edge rather than one on disk.
 *
 * The editor opens both, and `project.meta.path` is the single identifier every save flows
 * through — so this decides which world a project belongs to. It delegates rather than
 * deciding: the shared UI needs the same answer to know whether to offer version control,
 * and two copies of this test would eventually disagree about a Windows path and send a
 * save to the wrong place. The name stays because the save flow reads better for it.
 */
export const isCloudProjectId = isRemoteProjectPath

/**
 * The cloud read, refusing rather than throwing when the channel is not there.
 *
 * The listing channels each check this and say why: the preload bundle and the
 * renderer bundle are built separately and can skew, and a running app whose main
 * process predates a channel has no such method. Without the check the call raises
 * "is not a function", and that rejection escapes `openProjectByPath` to callers that
 * do not catch it — the cloud-projects card among them, which takes the start screen
 * down over one stale bundle.
 */
async function readCloudProjectFiles(projectId: string): Promise<RawProjectFiles> {
  if (typeof window.bridge.edgeProjectsRead !== 'function') {
    return {
      success: false,
      error: {
        title: 'Failed to open project',
        description: 'This build of the editor cannot open cloud projects.',
      },
    }
  }

  return window.bridge.edgeProjectsRead(projectId)
}

/** What a cloud write answers when the channel it needs is not in this build. */
const NO_CLOUD_WRITE_CHANNEL = {
  success: false,
  error: 'This build of the editor cannot save cloud projects.',
} as const

export function createEditorProjectAdapter(): ProjectPort {
  return {
    async createProject(params: CreateProjectParams): Promise<ProjectResponse> {
      const response = (await window.bridge.createProject({
        name: params.name,
        type: params.type,
        path: params.path ?? '',
        language: (params.language ?? 'il') as 'il' | 'st' | 'ld' | 'sfc' | 'fbd',
        time: params.time ?? new Date().toISOString(),
      })) as unknown as IpcProjectResponse

      return mapIpcResponse(response, { name: params.name, type: params.type })
    },

    async openProject(): Promise<ProjectResponse> {
      // Use open-project file picker (validates project.json exists, no empty-dir check)
      const pickResult = await window.bridge.openPathPicker()
      if (!pickResult.success || !pickResult.path) {
        return { success: false, error: pickResult.error ?? { title: 'Cancelled', description: 'No project selected' } }
      }
      // Read raw files and parse on the frontend
      const raw = (await window.bridge.readProjectFiles(pickResult.path)) as RawProjectFiles
      if (!raw.success || !raw.data) {
        return { success: false, error: raw.error }
      }
      const parsed = parseProjectFiles(
        raw.data.projectPath,
        raw.data.projectJson,
        raw.data.deviceConfig,
        raw.data.pinMapping,
        raw.data.pouFiles,
        raw.data.serverFiles,
        raw.data.remoteDeviceFiles,
        raw.data.libraryManifest,
        // Array guard: the IPC payload is a cast, not validated — a
        // version-skewed main process must not crash project open.
        Array.isArray(raw.data.dataTypeFiles) ? raw.data.dataTypeFiles : [],
      )
      return { success: true, data: parsed }
    },

    async openProjectByPath(projectPath: string): Promise<ProjectResponse> {
      // Read raw files and parse on the frontend. The parsing below is identical either
      // way — only where the bytes come from differs, which is the whole point of the
      // cloud reader returning the same `RawProjectFiles` the filesystem one does.
      const raw = isCloudProjectId(projectPath)
        ? await readCloudProjectFiles(projectPath)
        : ((await window.bridge.readProjectFiles(projectPath)) as RawProjectFiles)
      if (!raw.success || !raw.data) {
        return { success: false, error: raw.error }
      }

      /**
       * A project uploaded as raw PLCopen XML has no `project.json` and no POUs — only
       * Node's `plcopen-pending-import.xml` marker, stored verbatim because nothing
       * parses it server-side. Handing that to `parseProjectFiles` loads schema
       * defaults and ignores the XML entirely, so the project opens EMPTY: the imported
       * program is on the server, and the editor shows a blank one over it.
       *
       * The web adapter has had this branch since the marker existed; the desktop
       * inherited the reader without it. `wasPendingPlcopenImport` tells the caller to
       * save immediately, which prunes the marker — Node's save deletes what the
       * payload omits.
       */
      const pending = raw.data.pendingPlcopenSource

      if (pending !== undefined && pending.length > 0) {
        return {
          success: true,
          data: {
            ...buildProjectResponseFromPlcopenParse(parsePlcopenXml(pending), raw.data.projectPath),
            wasPendingPlcopenImport: true,
            canEdit: raw.data.canEdit,
          },
        }
      }

      const parsed = parseProjectFiles(
        raw.data.projectPath,
        raw.data.projectJson,
        raw.data.deviceConfig,
        raw.data.pinMapping,
        raw.data.pouFiles,
        raw.data.serverFiles,
        raw.data.remoteDeviceFiles,
        raw.data.libraryManifest,
        // Array guard: the IPC payload is a cast, not validated — a
        // version-skewed main process must not crash project open.
        Array.isArray(raw.data.dataTypeFiles) ? raw.data.dataTypeFiles : [],
      )
      return {
        success: true,
        data: {
          ...parsed,
          /**
           * Carried through so the save flow can echo unedited files back byte-for-byte
           * instead of re-serialising them. `RawProjectFiles` only has it for a cloud
           * project — the filesystem reader has the files on disk and no separate notion of
           * "as loaded" — so it is absent for a local one, which the sync point treats the
           * same as having nothing to echo.
           */
          rawLoadedFiles: raw.data.rawLoadedFiles,
          /**
           * Whether this account may persist changes, straight from the server's own
           * capabilities. Dropping it made the store fall back to "editable", which left
           * the read-only guards dead on the desktop: a viewer saw Commit, Discard and
           * Restore enabled and found out only when Edge refused the write.
           *
           * Absent for a project on disk, where there is no remote permission to speak of,
           * and the store reads absent as editable — which is correct there.
           */
          canEdit: raw.data.canEdit,
        },
      }
    },

    async readProjectFiles(projectPath: string): Promise<RawProjectFiles> {
      return (await window.bridge.readProjectFiles(projectPath)) as RawProjectFiles
    },

    async saveProject(files: WriteProjectFiles): Promise<{ success: boolean; error?: string }> {
      if (isCloudProjectId(files.projectPath)) {
        if (typeof window.bridge.edgeProjectsSaveProject !== 'function') {
          return NO_CLOUD_WRITE_CHANNEL
        }

        return window.bridge.edgeProjectsSaveProject(files)
      }

      const response = (await window.bridge.writeProjectFiles(files)) as { success: boolean; error?: string }
      if (!response.success) {
        return { success: false, error: response.error ?? 'Save failed' }
      }
      return { success: true }
    },

    async saveFile(filePath: string, content: unknown): Promise<{ success: boolean; error?: string }> {
      // `projectId/relative/path` for a cloud project, an absolute path for a local one.
      // Both arrive here from the same shared save flow.
      if (isCloudProjectId(filePath)) {
        if (typeof window.bridge.edgeProjectsSaveFile !== 'function') {
          return NO_CLOUD_WRITE_CHANNEL
        }

        return window.bridge.edgeProjectsSaveFile(filePath, content)
      }

      return window.bridge.saveFile(filePath, content)
    },

    async createPou(params: CreatePouParams): Promise<{ success: boolean; data?: unknown; error?: string }> {
      const response = (await window.bridge.createPouFile({
        path: params.filePath ?? '',
        pou: mapPortPouToIpcPou({
          name: params.name,
          pouType: params.pouType,
          body: { language: params.language as PLCPou['body']['language'], value: '' },
          documentation: '',
        }),
      } as never)) as unknown as IpcPouResponse

      if (!response.success) {
        return { success: false, error: response.error?.description }
      }

      return { success: true, data: response.data }
    },

    async deletePou(filePath: string): Promise<{ success: boolean; error?: string }> {
      const response = (await window.bridge.deletePouFile(filePath)) as unknown as IpcPouResponse

      if (!response.success) {
        return { success: false, error: response.error?.description }
      }

      return { success: true }
    },

    async renamePou(params: RenamePouParams): Promise<{ success: boolean; data?: unknown; error?: string }> {
      const response = (await window.bridge.renamePouFile({
        filePath: params.filePath,
        newFileName: params.newFileName,
        fileContent: params.fileContent,
      })) as unknown as IpcPouResponse

      if (!response.success) {
        return { success: false, error: response.error?.description }
      }

      return { success: true, data: response.data }
    },

    async renameProject(
      _projectId: string,
      newName: string,
    ): Promise<{ success: boolean; name?: string; error?: string }> {
      // Desktop has no separate canonical name store: `project.json`'s
      // `meta.name` IS the project name, and the existing rename flow
      // (updateMetaName + project save) already persists it to disk.
      // Nothing to do over IPC — succeed with the requested name so the
      // shared explorer logic mirrors it into `meta.name`.
      return { success: true, name: newName }
    },

    async pickPath(): Promise<{ success: boolean; path?: string; error?: { title: string; description: string } }> {
      return window.bridge.pathPicker()
    },

    /**
     * Where a local project can be published. Guarded like `listRecentCloudProjects`: a
     * renderer paired with a main process that predates this channel would otherwise raise
     * "is not a function" and take the start screen down over a menu item nobody clicked.
     */
    async listCloudFolders(): Promise<CloudFoldersResult> {
      if (typeof window.bridge.edgeUploadListFolders !== 'function') {
        return { status: 'unreachable' }
      }

      const result = await window.bridge.edgeUploadListFolders().catch(
        (): CloudFoldersResult => ({
          status: 'unreachable',
        }),
      )

      // Shape-checked, not trusted: a stale main bundle answering with something else
      // must not become an empty folder list, which would read as "you have no folders".
      // Validated rather than probed for a `status` key — the `ok` case carries the
      // folders the picker renders, and half of one is not better than none.
      const parsed = CloudFoldersResultSchema.safeParse(result)

      return parsed.success ? parsed.data : { status: 'unreachable' }
    },

    async uploadProjectToCloud(params: UploadProjectParams): Promise<UploadProjectResult> {
      if (typeof window.bridge.edgeUploadProject !== 'function') {
        return {
          status: 'failed',
          failure: { reason: 'unreadable', message: 'This build of the editor cannot publish to Autonomy Edge.' },
        }
      }

      const answer = await window.bridge.edgeUploadProject(params).catch(
        (error: unknown): UploadProjectResult => ({
          status: 'failed',
          // A rejection here is the IPC call itself failing, which says nothing about
          // whether the import ran. Reported as unreachable for that reason.
          failure: { reason: 'unreachable', message: error instanceof Error ? error.message : 'The upload failed.' },
        }),
      )

      const parsed = UploadProjectResultSchema.safeParse(answer)

      // Same reasoning as the rejection above, and the same wording: an answer we
      // cannot read leaves it unknown whether the project was created, and the upload
      // is not idempotent. Saying "failed" would invite a retry that duplicates it.
      return parsed.success
        ? parsed.data
        : {
            status: 'failed',
            failure: { reason: 'unreachable', message: 'Autonomy Edge answered in a way this build cannot read.' },
          }
    },

    listRecentCloudProjects(limit: number): Promise<CloudProjectsResult> {
      // Guarded, not assumed: the preload bundle and the renderer bundle are built
      // separately and can skew — a running app whose main process predates this
      // feature has no such channel. `unavailable` is the honest answer there, and it
      // is what stops a missing channel taking the whole start screen down with it.
      if (typeof window.bridge.edgeProjectsListRecent !== 'function') {
        return Promise.resolve({ status: 'unavailable' })
      }

      // The SHAPE is checked too, not just the presence of the function. An older main
      // process answers with a bare array, and an unrecognised shape falls through every
      // branch of the section's state machine into "no cloud projects yet" — telling a
      // signed-out user their account is empty. Observed, not imagined: it is what a
      // stale bundle did on the first run of this code.
      return window.bridge.edgeProjectsListRecent(limit).then((result): CloudProjectsResult => {
        const parsed = CloudProjectsResultSchema.safeParse(result)

        return parsed.success ? parsed.data : { status: 'unavailable' }
      })
    },

    async getRecentProjects(): Promise<RecentProject[]> {
      return window.bridge.retrieveRecent()
    },

    async removeRecentProject(projectPath: string): Promise<{ success: boolean; error?: string }> {
      return window.bridge.removeProjectFromRecent(projectPath)
    },

    async deleteProject(projectPath: string): Promise<{ success: boolean; error?: string }> {
      return window.bridge.deleteProject(projectPath)
    },

    async readFileContent(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
      return window.bridge.fileReadContent(filePath)
    },

    watchFile(filePath: string): Promise<{ success: boolean; error?: string }> {
      return window.bridge.fileWatchStart(filePath)
    },

    unwatchFile(filePath: string): Promise<{ success: boolean }> {
      return window.bridge.fileWatchStop(filePath)
    },

    unwatchAll(): Promise<{ success: boolean }> {
      return window.bridge.fileWatchStopAll()
    },

    onFileExternalChange(callback: (filePath: string) => void): Unsubscribe {
      return window.bridge.onFileExternalChange((_event: unknown, data: { filePath: string }) => {
        callback(data.filePath)
      })
    },

    async pickPlcopenImportFile(): Promise<{ success: boolean; content?: string; error?: string }> {
      const response = await window.bridge.pickPlcopenImportFile()
      if (!response.success) {
        return { success: false, error: response.error?.description }
      }
      return { success: true, content: response.content }
    },

    async exportPlcopenFile(defaultFileName: string, xml: string): Promise<{ success: boolean; error?: string }> {
      const response = await window.bridge.exportPlcopenFile(defaultFileName, xml)
      if (!response.success) {
        return { success: false, error: response.error?.description }
      }
      return { success: true }
    },
  }
}

export { mapIpcPouToPortPou, mapPortPouToIpcPou }
