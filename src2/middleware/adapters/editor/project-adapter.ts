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

import type {
  CreatePouParams,
  CreateProjectParams,
  ProjectPort,
  ProjectResponse,
  RenamePouParams,
  SaveProjectParams,
} from '../../shared/ports/project-port'
import type {
  DeviceConfiguration,
  DevicePin,
  PLCDataType,
  PLCInstance,
  PLCPou,
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
        }
      }
      pous: IpcPou[]
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }
}

/** Editor IPC save response shape. */
interface IpcSaveResponse {
  success: boolean
  reason: { title: string; description: string }
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
    interface:
      ipcPou.data.variables.length > 0 || ipcPou.data.returnType
        ? {
            returnType: ipcPou.data.returnType,
            variables: ipcPou.data.variables as PLCVariable[],
          }
        : undefined,
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
        configurations: content.project.data.configuration,
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
        language: params.language ?? 'il',
        time: params.time ?? new Date().toISOString(),
      })) as unknown as IpcProjectResponse

      return mapIpcResponse(response, { name: params.name, type: params.type })
    },

    async openProject(): Promise<ProjectResponse> {
      const response = (await window.bridge.openProject()) as unknown as IpcProjectResponse
      return mapIpcResponse(response)
    },

    async openProjectByPath(projectPath: string): Promise<ProjectResponse> {
      const response = (await window.bridge.openProjectByPath(projectPath)) as unknown as IpcProjectResponse
      return mapIpcResponse(response)
    },

    async saveProject(params: SaveProjectParams): Promise<{ success: boolean; error?: string }> {
      const pathParts = params.projectPath.replace(/\\/g, '/').split('/')
      const projectName = pathParts[pathParts.length - 1] || 'untitled'
      const editorPous = params.projectData.pous.map(mapPortPouToIpcPou)

      const response = (await window.bridge.saveProject({
        projectPath: params.projectPath,
        content: {
          projectData: {
            meta: { name: projectName, type: 'plc-project' as const },
            data: {
              dataTypes: params.projectData.dataTypes,
              pous: editorPous,
              configuration: params.projectData.configurations,
            },
          },
          pous: editorPous,
          deviceConfiguration: params.deviceConfiguration,
          devicePinMapping: params.devicePinMapping,
        },
      } as never)) as unknown as IpcSaveResponse

      if (!response.success) {
        return { success: false, error: response.reason?.description ?? 'Save failed' }
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

    async pickPath(): Promise<{ success: boolean; path?: string; error?: { title: string; description: string } }> {
      return window.bridge.pathPicker()
    },

    async getRecentProjects(): Promise<RecentProject[]> {
      return window.bridge.retrieveRecent()
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
