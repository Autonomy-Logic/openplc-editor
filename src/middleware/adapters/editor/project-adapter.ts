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

import type * as PdfJsLib from 'pdfjs-dist'
import { z } from 'zod'

import { renderProjectToPdf } from '../../../backend/shared/print'
import { parseProjectFiles } from '../../../backend/shared/utils/parse-project-files'
import { buildProjectResponseFromPlcopenParse } from '../../../frontend/utils/PLC/build-plcopen-project-response'
import { parsePlcopenXml } from '../../../frontend/utils/PLC/xml-parser'
import type { EdgeAccountPort } from '../../shared/ports/edge-account-port'
import type { PrintRequest } from '../../shared/ports/print-types'
import type {
  CloudFoldersResult,
  CloudProjectsResult,
  CreatePouParams,
  CreateProjectParams,
  ProjectPort,
  ProjectResponse,
  RawProjectFile,
  RawProjectFiles,
  RenamePouParams,
  SaveResult,
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
import { editorEdgeAccountPort } from './edge-account-adapter'
import { applyPdfJsEnginePolyfills } from './services/pdf-export/pdfjs-engine-polyfills'

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

const RawProjectFileSchema = z.object({
  relativePath: z.string(),
  content: z.string(),
}) satisfies z.ZodType<RawProjectFile>

// `dataTypeFiles` falls back to none: a main process that predates `.dt` files must not stop the project opening.
const RawProjectFilesSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      projectPath: z.string(),
      projectJson: z.string(),
      deviceConfig: z.string(),
      pinMapping: z.string(),
      libraryManifest: z.string(),
      pouFiles: z.array(RawProjectFileSchema),
      serverFiles: z.array(RawProjectFileSchema),
      remoteDeviceFiles: z.array(RawProjectFileSchema),
      dataTypeFiles: z.array(RawProjectFileSchema).catch([]),
      canEdit: z.boolean().optional(),
      readme: z.string().nullish(),
      pendingPlcopenSource: z.string().optional(),
      rawLoadedFiles: z.record(z.string()).optional(),
    })
    .optional(),
  error: z.object({ title: z.string(), description: z.string(), status: z.number().optional() }).optional(),
})

const UNREADABLE_PROJECT_FILES: RawProjectFiles = {
  success: false,
  error: {
    title: 'Failed to open project',
    description: 'The project files arrived in a shape this build of the editor cannot read.',
  },
}

function readRawProjectFiles(answer: unknown): RawProjectFiles {
  const parsed = RawProjectFilesSchema.safeParse(answer)

  return parsed.success ? parsed.data : UNREADABLE_PROJECT_FILES
}

const CloudWriteAnswerSchema = z.object({ success: z.boolean(), error: z.string().optional() })

// The account read on failure also marks the session gone for every consumer, which restores the sign-in control.
async function classifyCloudWrite(answer: unknown, account: EdgeAccountPort): Promise<SaveResult> {
  const parsed = CloudWriteAnswerSchema.safeParse(answer)
  const result: SaveResult = parsed.success
    ? parsed.data
    : { success: false, error: 'Autonomy Edge answered in a way this build cannot read.' }

  if (result.success) {
    return result
  }

  const read = await account.fetchUser()

  return { ...result, reason: read.status === 'no-session' ? 'signed-out' : 'unreachable' }
}

export const isCloudProjectId = isRemoteProjectPath

// Preload and renderer bundles can skew: a missing channel must answer a failure, not throw "is not a function".
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

  // `invoke` can still reject; callers of `openProjectByPath` do not catch, so contain it here.
  return window.bridge.edgeProjectsRead(projectId).then(
    readRawProjectFiles,
    (error: unknown): RawProjectFiles => ({
      success: false,
      error: {
        title: 'Failed to open project',
        description: error instanceof Error ? error.message : 'Autonomy Edge could not be reached.',
      },
    }),
  )
}

const NO_CLOUD_WRITE_CHANNEL = {
  success: false,
  error: 'This build of the editor cannot save cloud projects.',
} as const

const cloudWriteFailure = (error: unknown): SaveResult => ({
  success: false,
  error: error instanceof Error ? error.message : 'The save could not be sent to Autonomy Edge.',
})

/** A failed cloud write asks `account` whether a session still exists. */
export function createEditorProjectAdapter(account: EdgeAccountPort = editorEdgeAccountPort): ProjectPort {
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
      const raw = readRawProjectFiles(await window.bridge.readProjectFiles(pickResult.path))
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
        raw.data.dataTypeFiles,
      )
      return { success: true, data: parsed }
    },

    async openProjectByPath(projectPath: string): Promise<ProjectResponse> {
      // Read raw files and parse on the frontend
      const raw = isCloudProjectId(projectPath)
        ? await readCloudProjectFiles(projectPath)
        : readRawProjectFiles(await window.bridge.readProjectFiles(projectPath))
      if (!raw.success || !raw.data) {
        return { success: false, error: raw.error }
      }

      // A pending PLCopen import has no `project.json`; `parseProjectFiles` would open it EMPTY.
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
        raw.data.dataTypeFiles,
      )
      return {
        success: true,
        data: {
          ...parsed,
          // Lets the save flow echo unedited files back byte-for-byte; absent for a local project.
          rawLoadedFiles: raw.data.rawLoadedFiles,
          // Dropping this makes the store fall back to "editable" and leaves the read-only guards dead.
          canEdit: raw.data.canEdit,
        },
      }
    },

    async trackRecentProject(projectPath: string): Promise<{ success: boolean; error?: string }> {
      return window.bridge.trackRecentProject(projectPath)
    },

    async readProjectFiles(projectPath: string): Promise<RawProjectFiles> {
      return readRawProjectFiles(await window.bridge.readProjectFiles(projectPath))
    },

    async saveProject(files: WriteProjectFiles): Promise<SaveResult> {
      if (isCloudProjectId(files.projectPath)) {
        if (typeof window.bridge.edgeProjectsSaveProject !== 'function') {
          return NO_CLOUD_WRITE_CHANNEL
        }

        return classifyCloudWrite(await window.bridge.edgeProjectsSaveProject(files).catch(cloudWriteFailure), account)
      }

      const response = (await window.bridge.writeProjectFiles(files)) as { success: boolean; error?: string }
      if (!response.success) {
        return { success: false, error: response.error ?? 'Save failed' }
      }
      return { success: true }
    },

    async saveFile(filePath: string, content: unknown): Promise<SaveResult> {
      // `projectId/relative/path` for a cloud project, an absolute path for a local one.
      if (isCloudProjectId(filePath)) {
        if (typeof window.bridge.edgeProjectsSaveFile !== 'function') {
          return NO_CLOUD_WRITE_CHANNEL
        }

        return classifyCloudWrite(
          await window.bridge.edgeProjectsSaveFile(filePath, content).catch(cloudWriteFailure),
          account,
        )
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

    async listCloudFolders(): Promise<CloudFoldersResult> {
      if (typeof window.bridge.edgeUploadListFolders !== 'function') {
        return { status: 'unreachable' }
      }

      const result = await window.bridge.edgeUploadListFolders().catch(
        (): CloudFoldersResult => ({
          status: 'unreachable',
        }),
      )

      // An unreadable answer must not become an empty folder list, which reads as "you have no folders".
      const parsed = CloudFoldersResultSchema.safeParse(result)

      return parsed.success ? parsed.data : { status: 'unreachable' }
    },

    async listCloudProjectsInFolder(folderId: string): Promise<CloudProjectsResult> {
      if (typeof window.bridge.edgeProjectsListInFolder !== 'function') {
        return { status: 'unavailable' }
      }

      const result = await window.bridge
        .edgeProjectsListInFolder(folderId)
        .catch((): CloudProjectsResult => ({ status: 'unreachable' }))

      // An unreadable answer must not become an empty list, which reads as "this folder is empty".
      const parsed = CloudProjectsResultSchema.safeParse(result)

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
          // A rejected invoke says nothing about whether the import ran, hence unreachable.
          failure: { reason: 'unreachable', message: error instanceof Error ? error.message : 'The upload failed.' },
        }),
      )

      const parsed = UploadProjectResultSchema.safeParse(answer)

      // Not "failed": the upload is not idempotent, and "failed" would invite a duplicating retry.
      return parsed.success
        ? parsed.data
        : {
            status: 'failed',
            failure: { reason: 'unreachable', message: 'Autonomy Edge answered in a way this build cannot read.' },
          }
    },

    listRecentCloudProjects(limit: number): Promise<CloudProjectsResult> {
      // Preload and renderer bundles can skew; a missing channel is `unavailable`, not a throw.
      if (typeof window.bridge.edgeProjectsListRecent !== 'function') {
        return Promise.resolve({ status: 'unavailable' })
      }

      // An older main process answers a bare array, which would read as "no cloud projects yet".
      return (
        window.bridge
          .edgeProjectsListRecent(limit)
          .then((result): CloudProjectsResult => {
            const parsed = CloudProjectsResultSchema.safeParse(result)

            return parsed.success ? parsed.data : { status: 'unavailable' }
          })
          // The start screen calls this without a catch; a rejection must not take it down.
          .catch((): CloudProjectsResult => ({ status: 'unreachable' }))
      )
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

    async exportPdfFile(
      defaultFileName: string,
      bytes: Uint8Array,
    ): Promise<{ success: boolean; canceled?: boolean; error?: string }> {
      const response = await window.bridge.exportPdfFile(defaultFileName, bytes)
      if (response.canceled) {
        return { success: false, canceled: true }
      }
      if (!response.success) {
        return { success: false, error: response.error?.description }
      }
      return { success: true }
    },

    async renderPdf(request: PrintRequest): Promise<Uint8Array> {
      // Runs on the renderer's main thread — unlike web, which offloads this
      // to a Worker (Vite bundles an in-repo `.worker.ts` natively). Doing the
      // same here would need `import.meta.url`, which this repo's single,
      // CommonJS-targeted tsconfig.json (shared with the Electron main
      // process) can't compile; standing up a second build target just for
      // one worker file was judged disproportionate to a render that
      // normally completes in well under a second.
      //
      // The embedded fonts (~464KB of base64) are imported dynamically here
      // rather than at module load, so they never land in the startup bundle
      // for a session that never opens the export wizard.
      const { getEmbeddedFontSet } = await import('../../../backend/shared/print/fonts/embedded-font-set')
      return renderProjectToPdf(request, getEmbeddedFontSet())
    },

    async preparePdfPreviewWorker(_pdfjsLib: typeof PdfJsLib): Promise<void> {
      // pdf.js's main API layer (`pdf.mjs`, always main-thread) and, once
      // registered below, its worker code too call several very recent JS
      // platform APIs Electron's bundled V8 doesn't have yet.
      applyPdfJsEnginePolyfills()
      // pdf.js's own hook for running its worker code in-process: `PDFWorker`
      // checks `window.pdfjsWorker` before ever constructing a real Worker.
      // @ts-expect-error -- pdfjs-dist ships no .d.ts for this deep worker
      // chunk; imported directly (not via `?url`) so it executes here rather
      // than resolving to just a URL string.
      window.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs')
    },
  }
}

export { mapIpcPouToPortPou, mapPortPouToIpcPou }
