/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { ipcRenderer, IpcRendererEvent } from 'electron'

import { ProjectState } from '../../../renderer/store/slices'
import { PLCProject } from '../../../types/PLC/open-plc'
import { IProjectServiceResponse } from '../../services/project-service'
import { CreateProjectFile } from '../../services/project-service/utils'

type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: any) => void

type IDataToWrite = {
  projectPath: string
  projectData: PLCProject
}

type ISaveDataResponse = {
  success: boolean
  reason: {
    title: string
    description: string
  }
}

type CreateProjectFileProps = {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
  type: 'plc-project' | 'plc-library'
  name: string
  path: string
}
type CreateProjectFileResponse = ReturnType<typeof CreateProjectFile>

const rendererProcessBridge = {
  /**
   * Handlers for creating projects.
   * As for the click and for the accelerator type.
   */

  createProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:create-accelerator', (_event) => callback(_event)),
  removeCreateProjectAccelerator: () => ipcRenderer.removeAllListeners('project:create-accelerator'),
  createProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('project:create'),
  createProjectFile: (dataToCreateProjectFile: CreateProjectFileProps): Promise<CreateProjectFileResponse> =>
    ipcRenderer.invoke('project:create-project-file', dataToCreateProjectFile),

  /**
   * Path picker
   */

  pathPicker: (): Promise<
    | {
        success: boolean
        error: {
          title: string
          description: string
        }
        path?: undefined
      }
    | {
        success: boolean
        path: string
        error?: undefined
      }
  > => ipcRenderer.invoke('project:path-picker'),

  /**
   * Handlers for opening projects.
   * As for the click and for the accelerator type.
   */
  handleOpenProjectRequest: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open-project-request', (_event) => callback(_event)),
  removeOpenProjectAccelerator: () => ipcRenderer.removeAllListeners('project:open-project-request'),
  openProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('project:open'),
  openProjectByPath: (projectPath: string): Promise<IProjectServiceResponse> =>
    ipcRenderer.invoke('project:open-by-path', projectPath),
  openRecentAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open-recent-accelerator', (_event, val: IProjectServiceResponse) => callback(_event, val)),
  openExternalLinkAccelerator: (link: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-external-link', link),
  /**
   * Handlers for opening projects.
   * As for the click and for the accelerator type.
   */
  saveProjectAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-accelerator', callback),
  saveProject: (dataToWrite: IDataToWrite): Promise<ISaveDataResponse> =>
    ipcRenderer.invoke('project:save', dataToWrite),
  closeTabAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('workspace:close-tab-accelerator', callback),
  closeProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:close-project-accelerator', callback),
  removeCloseProjectListener: () => ipcRenderer.removeAllListeners('workspace:close-project-accelerator'),
  deletePouAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:delete-pou-accelerator', callback),

  switchPerspective: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:switch-perspective-accelerator', callback),
  removeDeletePouListener: () => ipcRenderer.removeAllListeners('workspace:delete-pou-accelerator'),
  removeCloseTabListener: () => ipcRenderer.removeAllListeners('workspace:close-tab-accelerator'),
  findInProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:find-in-project-accelerator', callback),

  aboutModalAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('about:open-accelerator', callback),
  aboutAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('website:about-accelerator', callback),
  /** -------------------------------------------------------------------------------------------- */
  getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),
  setStoreValue: (key: string, val: string) => ipcRenderer.send('app:store-set', key, val),
  /**
   * Send the OS information to the renderer process
   * !IMPORTANT: This return type must be refactored to match the Node.js API
   */
  getRecent: (): Promise<string[]> => ipcRenderer.invoke('app:store-get'),
  getSystemInfo: (): Promise<{
    OS: 'linux' | 'darwin' | 'win32' | ''
    architecture: 'x64' | 'arm' | ''
    prefersDarkMode: boolean
    isWindowMaximized: boolean
  }> => ipcRenderer.invoke('system:get-system-info'),
  retrieveRecent: (): Promise<{ name: string; path: string; lastOpenedAt: string; createdAt: string }[]> =>
    ipcRenderer.invoke('app:store-retrieve-recent'),
  closeWindow: () => ipcRenderer.send('window-controls:close'),
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),
  maximizeWindow: () => ipcRenderer.send('window-controls:maximize'),
  isMaximizedWindow: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('window-controls:toggle-maximized', (_event) => callback(_event)),
  reloadWindow: () => ipcRenderer.send('window:reload'),
  handleUpdateTheme: (callback: IpcRendererCallbacks) => ipcRenderer.on('system:update-theme', callback),
  winHandleUpdateTheme: () => ipcRenderer.send('system:update-theme'),
  quitAppRequest: (callback: IpcRendererCallbacks) => ipcRenderer.on('app:quit-accelerator', callback),
  removeQuitAppListener: () => ipcRenderer.removeAllListeners('app:quit-accelerator'),
  hideWindow: () => ipcRenderer.send('window-controls:hide'),

  // WIP: Refactoring
  // setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  // createPou: (callback: any) => ipcRenderer.on('pou:create', callback),

  /**
   * Compiler Service
   */
  createBuildDirectory: async (pathToUserProject: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:create-build-directory', pathToUserProject),
  createXmlFileToBuild: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:create-xml-file', pathToUserProject, dataToCreateXml),
  exportProjectRequest: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('compiler:export-project-request', (_event) => callback(_event)),
  removeExportProjectListener: () => ipcRenderer.removeAllListeners('compiler:export-project-request'),
  /**
   * This is a mock implementation to be used as a presentation.
   * !! Do not use this on production !!
   */

  // @ts-expect-error Callback is from an any type
  compileRequest: (xmlPath: string, callback) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()

    ipcRenderer.postMessage('compiler:build-st-program', xmlPath, [mainProcessPort])

    rendererProcessPort.onmessage = (event) => callback(event.data)

    rendererProcessPort.addEventListener('close', () => console.log('Port closed'))
  },
  generateCFilesRequest: (pathToStFile: string) => ipcRenderer.send('compiler:generate-c-files', pathToStFile),
}
export default rendererProcessBridge
