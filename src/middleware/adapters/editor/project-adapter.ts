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
import type {
  CreatePouParams,
  CreateProjectParams,
  ProjectPort,
  ProjectResponse,
  RawProjectFiles,
  RenamePouParams,
  WriteProjectFiles,
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
      )
      return { success: true, data: parsed }
    },

    async openProjectByPath(projectPath: string): Promise<ProjectResponse> {
      // Read raw files and parse on the frontend
      const raw = (await window.bridge.readProjectFiles(projectPath)) as RawProjectFiles
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
      )
      return { success: true, data: parsed }
    },

    async readProjectFiles(projectPath: string): Promise<RawProjectFiles> {
      return (await window.bridge.readProjectFiles(projectPath)) as RawProjectFiles
    },

    async saveProject(files: WriteProjectFiles): Promise<{ success: boolean; error?: string }> {
      const response = (await window.bridge.writeProjectFiles(files)) as { success: boolean; error?: string }
      if (!response.success) {
        return { success: false, error: response.error ?? 'Save failed' }
      }
      return { success: true }
    },

    async saveFile(filePath: string, content: unknown): Promise<{ success: boolean; error?: string }> {
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
  }
}

export { mapIpcPouToPortPou, mapPortPouToIpcPou }
