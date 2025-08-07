/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { CreateProjectFileProps, IProjectServiceResponse } from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { ipcRenderer, IpcRendererEvent } from 'electron'

import { ProjectState } from '../../../renderer/store/slices'
import { PLCProject } from '../../../types/PLC/open-plc'

type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: any) => void

type IDataToWrite = {
  projectPath: string
  content: {
    projectData: PLCProject
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
  }
}

export type ISaveDataResponse = {
  success: boolean
  reason: {
    title: string
    description: string
  }
}

/**
 * A bridge for communication between the renderer process and the main process in an Electron application.
 * Provides various methods for handling project creation, opening, saving, and other operations.
 */
const rendererProcessBridge = {
  // ===================== PROJECT METHODS =====================
  aboutAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('website:about-accelerator', callback),
  aboutModalAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('about:open-accelerator', callback),
  closeProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:close-project-accelerator', callback),
  closeTabAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('workspace:close-tab-accelerator', callback),
  createProject: (data: CreateProjectFileProps): Promise<IProjectServiceResponse> =>
    ipcRenderer.invoke('project:create', data),
  createProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:create-accelerator', (_event) => callback(_event)),
  deletePouAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:delete-pou-accelerator', callback),
  findInProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:find-in-project-accelerator', callback),
  handleOpenProjectRequest: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open-project-request', (_event) => callback(_event)),
  openProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('project:open'),
  openProjectByPath: (projectPath: string): Promise<IProjectServiceResponse> =>
    ipcRenderer.invoke('project:open-by-path', projectPath),
  openRecentAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open-recent-accelerator', (_event, val: IProjectServiceResponse) => callback(_event, val)),
  pathPicker: (): Promise<{ success: boolean; error?: { title: string; description: string }; path?: string }> =>
    ipcRenderer.invoke('project:path-picker'),
  removeCloseProjectListener: () => ipcRenderer.removeAllListeners('workspace:close-project-accelerator'),
  removeCloseTabListener: () => ipcRenderer.removeAllListeners('workspace:close-tab-accelerator'),
  removeCreateProjectAccelerator: () => ipcRenderer.removeAllListeners('project:create-accelerator'),
  removeDeletePouListener: () => ipcRenderer.removeAllListeners('workspace:delete-pou-accelerator'),
  removeOpenProjectAccelerator: () => ipcRenderer.removeAllListeners('project:open-project-request'),
  removeOpenRecentListener: () => ipcRenderer.removeAllListeners('project:open-recent-accelerator'),
  removeSaveProjectAccelerator: () => ipcRenderer.removeAllListeners('project:save-accelerator'),
  saveProject: (dataToWrite: IDataToWrite): Promise<ISaveDataResponse> =>
    ipcRenderer.invoke('project:save', dataToWrite),
  saveProjectAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-accelerator', callback),
  switchPerspective: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:switch-perspective-accelerator', callback),

  // ===================== APP & SYSTEM METHODS =====================
  darwinAppIsClosing: (callback: IpcRendererCallbacks) => ipcRenderer.on('app:darwin-is-closing', callback),
  getRecent: (): Promise<string[]> => ipcRenderer.invoke('app:store-get'),
  getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),
  getSystemInfo: (): Promise<{
    OS: 'linux' | 'darwin' | 'win32' | ''
    architecture: 'x64' | 'arm' | ''
    prefersDarkMode: boolean
    isWindowMaximized: boolean
  }> => ipcRenderer.invoke('system:get-system-info'),
  handleQuitApp: () => ipcRenderer.send('app:quit'),
  openExternalLinkAccelerator: (link: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-external-link', link),
  quitAppRequest: (callback: IpcRendererCallbacks) => ipcRenderer.on('app:quit-accelerator', callback),
  removeQuitAppListener: () => ipcRenderer.removeAllListeners('app:quit-accelerator'),
  retrieveRecent: (): Promise<{ name: string; path: string; lastOpenedAt: string; createdAt: string }[]> =>
    ipcRenderer.invoke('app:store-retrieve-recent'),
  setStoreValue: (key: string, val: string) => ipcRenderer.send('app:store-set', key, val),

  // ===================== WINDOW CONTROLS =====================
  closeWindow: () => ipcRenderer.send('window-controls:closed'),
  handleCloseOrHideWindow: () => ipcRenderer.send('window-controls:close'),
  handleCloseOrHideWindowAccelerator: () =>
    ipcRenderer.on('window-controls:request-close', () => ipcRenderer.send('window-controls:close')),
  hideWindow: () => ipcRenderer.send('window-controls:hide'),
  isMaximizedWindow: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('window-controls:toggle-maximized', (_event) => callback(_event)),
  maximizeWindow: () => ipcRenderer.send('window-controls:maximize'),
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),
  rebuildMenu: () => ipcRenderer.send('window:rebuild-menu'),
  reloadWindow: () => ipcRenderer.send('window:reload'),
  removeHandleCloseOrHideWindowAccelerator: () => ipcRenderer.removeAllListeners('window-controls:request-close'),
  windowIsClosing: (callback: IpcRendererCallbacks) => ipcRenderer.on('window-controls:is-closing', callback),

  // ===================== THEME =====================
  handleUpdateTheme: (callback: IpcRendererCallbacks) => ipcRenderer.on('system:update-theme', callback),
  winHandleUpdateTheme: () => ipcRenderer.send('system:update-theme'),

  // ===================== COMPILER/BUILD METHODS =====================
  // !! Deprecated: This method is an outdated implementation and should be substituted.
  exportProjectXml: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
    parseTo: 'old-editor' | 'codesys',
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:export-project-xml', pathToUserProject, dataToCreateXml, parseTo),
  // =================== Work in Progress ===================
  // This method is a placeholder for running the compile program.
  runCompileProgram: (
    compileProgramArgs: Array<string | null | ProjectState['data']>,
    callback: (args: any) => void,
  ) => {
    // Create a MessageChannel to communicate between the renderer and main process
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    // Send to the main process a message to run the compile program
    // The main process will handle the compilation and send the result back through the port
    ipcRenderer.postMessage('compiler:run-compile-program', compileProgramArgs, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data)
    rendererProcessPort.addEventListener('close', () =>
      callback({
        closePort: true,
      }),
    )
    // rendererProcessPort.start()
    // Set up the renderer process port to listen for messages from the main process
  },

  // !! Deprecated: These methods are an outdated implementation and should be removed.
  compileRequest: (xmlPath: string, callback: (args: any) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:build-st-program', xmlPath, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data)
    rendererProcessPort.addEventListener('close', () => console.log('Port closed'))
  },
  createBuildDirectory: async (pathToUserProject: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:create-build-directory', pathToUserProject),
  createXmlFileToBuild: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:build-xml-file', pathToUserProject, dataToCreateXml),
  exportProjectRequest: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('compiler:export-project-request', (_event, value) => callback(_event, value)),
  generateCFilesRequest: (pathToStProgram: string, callback: (args: any) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:generate-c-files', pathToStProgram, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data)
    rendererProcessPort.addEventListener('close', () => console.log('Port closed'))
  },
  removeExportProjectListener: () => ipcRenderer.removeAllListeners('compiler:export-project-request'),
  setupCompilerEnvironment: (callback: (args: any) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:setup-environment', '', [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data)
    rendererProcessPort.addEventListener('close', () => console.log('Port closed'))
  },

  // ===================== HARDWARE METHODS =====================
  getAvailableBoards: (): Promise<
    Map<
      string,
      {
        core: string
        preview: string
        specs: {
          CPU: string
          RAM: string
          Flash: string
          DigitalPins: string
          AnalogPins: string
          PWMPins: string
          WiFi: string
          Bluetooth: string
          Ethernet: string
        }
        isCoreInstalled: boolean
        pins: {
          defaultAin?: string[]
          defaultAout?: string[]
          defaultDin?: string[]
          defaultDout?: string[]
        }
      }
    >
  > => ipcRenderer.invoke('hardware:get-available-boards'),
  getAvailableCommunicationPorts: (): Promise<string[]> =>
    ipcRenderer.invoke('hardware:get-available-communication-ports'),
  refreshAvailableBoards: (): Promise<{ board: string; version: string }[]> =>
    ipcRenderer.invoke('hardware:refresh-available-boards'),
  refreshCommunicationPorts: (): Promise<string[]> => ipcRenderer.invoke('hardware:refresh-communication-ports'),

  // ===================== UTILITY METHODS =====================
  getPreviewImage: (image: string): Promise<string> => ipcRenderer.invoke('util:get-preview-image', image),
  log: (level: 'info' | 'error', message: string) => ipcRenderer.send('util:log', { level, message }),
}
export default rendererProcessBridge
