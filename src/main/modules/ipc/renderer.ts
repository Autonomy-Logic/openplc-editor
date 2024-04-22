import { ipcRenderer,IpcRendererEvent } from 'electron'

import { baseJsonStructure } from '../../services/project-service/data'

// biome-ignore lint/suspicious/noExplicitAny: <This causes an error in Electron, must be reviewed>
type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: any) => void

const rendererProcessBridge = {
  toggleTheme: () => ipcRenderer.invoke('app:toggle-theme'),
  getThemePreference: () => ipcRenderer.invoke('app-preferences:get-theme'),
  startOpenProject: () => ipcRenderer.invoke('start-screen/project:open'),
  startCreateProject: (): Promise<{
    ok: boolean
    res: { path: string; data: typeof baseJsonStructure }
  }> => ipcRenderer.invoke('start-screen/project:create'),
  createProject: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:create', callback),
  openProject: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:open', callback),
  saveProject: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-request', callback),
  getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),
  setStoreValue: (key: string, val: string) => ipcRenderer.send('app:store-set', key, val),
  /**
   * Send the OS information to the renderer process
   * !IMPORTANT: This return type must be refactored to match the Node.js API
   */
  getSystemInfo: (): Promise<{
    OS: 'linux' | 'darwin' | 'win32' | ''
    architecture: 'x64' | 'arm' | ''
    prefersDarkMode: boolean
  }> => ipcRenderer.invoke('system:get-system-info'),
  closeWindow: () => ipcRenderer.send('window-controls:close'),
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),
  maximizeWindow: () => ipcRenderer.send('window-controls:maximize'),
  reloadWindow: () => ipcRenderer.send('window:reload'),
  // WIP: Refactoring
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  // setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  // createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
}
export default rendererProcessBridge
