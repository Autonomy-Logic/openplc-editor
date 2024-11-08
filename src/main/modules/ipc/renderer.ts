/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { ipcRenderer, IpcRendererEvent } from 'electron'

import { PLCProject } from '../../../types/PLC/open-plc'
import { CompilerResponse } from '../../services/compiler-service'
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
    ipcRenderer.on('project:create-accelerator', (_event, val: IProjectServiceResponse) => callback(_event, val)),

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
  openProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open-accelerator', (_event, val: IProjectServiceResponse) => callback(_event, val)),

  openProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('project:open'),
  openProjectByPath: (projectPath: string): Promise<IProjectServiceResponse> =>
    ipcRenderer.invoke('project:open-by-path', projectPath),
  /**
   * Handlers for opening projects.
   * As for the click and for the accelerator type.
   */
  saveProjectAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-accelerator', callback),
  saveProject: (dataToWrite: IDataToWrite): Promise<ISaveDataResponse> =>
    ipcRenderer.invoke('project:save', dataToWrite),

  /** -------------------------------------------------------------------------------------------- */
  // saveProject: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-request', callback),
  getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),
  setStoreValue: (key: string, val: string) => ipcRenderer.send('app:store-set', key, val),
  /**
   * Send the OS information to the renderer process
   * !IMPORTANT: This return type must be refactored to match the Node.js API
   */
  getRecents: (): Promise<string[]> => ipcRenderer.invoke('app:store-get'),
  getSystemInfo: (): Promise<{
    OS: 'linux' | 'darwin' | 'win32' | ''
    architecture: 'x64' | 'arm' | ''
    prefersDarkMode: boolean
    isWindowMaximized: boolean
  }> => ipcRenderer.invoke('system:get-system-info'),
  retrieveRecents: (): Promise<{ path: string; lastOpenedAt: string; createdAt: string }[]> =>
    ipcRenderer.invoke('app:store-retrieve-recents'),
  closeWindow: () => ipcRenderer.send('window-controls:close'),
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),
  maximizeWindow: () => ipcRenderer.send('window-controls:maximize'),
  isMaximizedWindow: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('window-controls:toggle-maximized', (_event) => callback(_event)),
  reloadWindow: () => ipcRenderer.send('window:reload'),
  handleUpdateTheme: (callback: IpcRendererCallbacks) => ipcRenderer.on('system:update-theme', callback),
  winHandleUpdateTheme: () => ipcRenderer.send('system:update-theme'),

  // WIP: Refactoring
  // setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  // createPou: (callback: any) => ipcRenderer.on('pou:create', callback),

  /**
   * Compiler Service
   */
  writeXMLFile: (path: string, data: string, fileName: string) =>
    ipcRenderer.invoke('compiler:write-xml-file', { path, data, fileName }),
  /**
   * This is a mock implementation to be used as a presentation.
   * !! Do not use this on production !!
   */
  compileSTProgram: (pathToXMLFile: string): Promise<CompilerResponse> => ipcRenderer.invoke('compiler:compile-st-program', pathToXMLFile),
}
export default rendererProcessBridge
