/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { ipcRenderer, IpcRendererEvent } from 'electron'

import { IProject } from '../../../types/PLC'
import { IProjectServiceResponse } from '../../services/project-service'

type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: any) => void

const rendererProcessBridge = {
  startOpenProject: () => ipcRenderer.invoke('start-screen/project:open'),
  startCreateProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('start-screen/project:create'),
  createProject: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:create', callback),
  openProject: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:open', callback),
  saveProject: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-request', callback),
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
  }> => ipcRenderer.invoke('system:get-system-info'),
  closeWindow: () => ipcRenderer.send('window-controls:close'),
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),
  maximizeWindow: () => ipcRenderer.send('window-controls:maximize'),
  reloadWindow: () => ipcRenderer.send('window:reload'),
  handleUpdateTheme: (callback: IpcRendererCallbacks) => ipcRenderer.on('system:update-theme', callback),
  winHandleUpdateTheme: () => ipcRenderer.send('system:update-theme'),
  handleSaveProjectOpenRequest: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:save/open-request', callback),
  handleSaveProjectWriteData: (dataToWrite: {
    projectPath: string
    projectData: IProject
  }): Promise<{
    success: boolean
    reason: {
      title: string
      description: string
    }
  }> => ipcRenderer.invoke('project:save/write-data', dataToWrite),
  // WIP: Refactoring
  // setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  // createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
}
export default rendererProcessBridge
