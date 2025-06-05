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

export type ISaveDataResponse = {
  success: boolean
  reason: {
    title: string
    description: string
  }
}

export type CreateProjectFileProps = {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
  type: 'plc-project' | 'plc-library'
  name: string
  path: string
}
export type CreateProjectFileResponse = ReturnType<typeof CreateProjectFile>

/**
 * A bridge for communication between the renderer process and the main process in an Electron application.
 * Provides various methods for handling project creation, opening, saving, and other operations.
 */
const rendererProcessBridge = {
  /**
   * Registers a callback for the 'project:create-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  createProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:create-accelerator', (_event) => callback(_event)),

  /**
   * Removes all listeners for the 'project:create-accelerator' event.
   */
  removeCreateProjectAccelerator: () => ipcRenderer.removeAllListeners('project:create-accelerator'),

  /**
   * Invokes the 'project:create' event and returns a promise with the response.
   * @returns A promise that resolves with the project service response.
   */
  createProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('project:create'),

  /**
   * Invokes the 'project:create-project-file' event with the provided data and returns a promise with the response.
   * @param dataToCreateProjectFile - The data required to create the project file.
   * @returns A promise that resolves with the create project file response.
   */
  createProjectFile: (dataToCreateProjectFile: CreateProjectFileProps): Promise<CreateProjectFileResponse> =>
    ipcRenderer.invoke('project:create-project-file', dataToCreateProjectFile),

  /**
   * Invokes the 'project:path-picker' event and returns a promise with the response.
   * @returns A promise that resolves with the path picker response.
   */
  pathPicker: (): Promise<{ success: boolean; error?: { title: string; description: string }; path?: string }> =>
    ipcRenderer.invoke('project:path-picker'),

  /**
   * Registers a callback for the 'project:open-project-request' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  handleOpenProjectRequest: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open-project-request', (_event) => callback(_event)),

  /**
   * Removes all listeners for the 'project:open-project-request' event.
   */
  removeOpenProjectAccelerator: () => ipcRenderer.removeAllListeners('project:open-project-request'),

  /**
   * Invokes the 'project:open' event and returns a promise with the response.
   * @returns A promise that resolves with the project service response.
   */
  openProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('project:open'),

  /**
   * Invokes the 'project:open-by-path' event with the provided project path and returns a promise with the response.
   * @param projectPath - The path of the project to open.
   * @returns A promise that resolves with the project service response.
   */
  openProjectByPath: (projectPath: string): Promise<IProjectServiceResponse> =>
    ipcRenderer.invoke('project:open-by-path', projectPath),

  /**
   * Registers a callback for the 'project:open-recent-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  openRecentAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open-recent-accelerator', (_event, val: IProjectServiceResponse) => callback(_event, val)),

  /**
   * Removes all listeners for the 'project:open-recent-accelerator' event.
   */
  removeOpenRecentListener: () => ipcRenderer.removeAllListeners('project:open-recent-accelerator'),

  /**
   * Invokes the 'open-external-link' event with the provided link and returns a promise with the response.
   * @param link - The external link to open.
   * @returns A promise that resolves with the success status.
   */
  openExternalLinkAccelerator: (link: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-external-link', link),

  /**
   * Registers a callback for the 'project:save-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  saveProjectAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-accelerator', callback),
  removeSaveProjectAccelerator: () => ipcRenderer.removeAllListeners('project:save-accelerator'),

  /**
   * Invokes the 'project:save' event with the provided data and returns a promise with the response.
   * @param dataToWrite - The data to write to the project.
   * @returns A promise that resolves with the save data response.
   */
  saveProject: (dataToWrite: IDataToWrite): Promise<ISaveDataResponse> =>
    ipcRenderer.invoke('project:save', dataToWrite),

  /**
   * Registers a callback for the 'workspace:close-tab-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  closeTabAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('workspace:close-tab-accelerator', callback),

  /**
   * Registers a callback for the 'workspace:close-project-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  closeProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:close-project-accelerator', callback),

  /**
   * Removes all listeners for the 'workspace:close-project-accelerator' event.
   */
  removeCloseProjectListener: () => ipcRenderer.removeAllListeners('workspace:close-project-accelerator'),

  /**
   * Registers a callback for the 'workspace:delete-pou-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  deletePouAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:delete-pou-accelerator', callback),

  /**
   * Registers a callback for the 'workspace:switch-perspective-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  switchPerspective: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:switch-perspective-accelerator', callback),

  /**
   * Removes all listeners for the 'workspace:delete-pou-accelerator' event.
   */
  removeDeletePouListener: () => ipcRenderer.removeAllListeners('workspace:delete-pou-accelerator'),

  /**
   * Removes all listeners for the 'workspace:close-tab-accelerator' event.
   */
  removeCloseTabListener: () => ipcRenderer.removeAllListeners('workspace:close-tab-accelerator'),

  /**
   * Registers a callback for the 'project:find-in-project-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  findInProjectAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:find-in-project-accelerator', callback),

  /**
   * Registers a callback for the 'about:open-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  aboutModalAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('about:open-accelerator', callback),

  /**
   * Registers a callback for the 'website:about-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  aboutAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('website:about-accelerator', callback),

  /**
   * Invokes the 'app:store-get' event with the provided key and returns a promise with the value.
   * @param key - The key to retrieve the value for.
   * @returns A promise that resolves with the store value.
   */
  getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),

  /**
   * Sends the 'app:store-set' event with the provided key and value.
   * @param key - The key to set the value for.
   * @param val - The value to set.
   */
  setStoreValue: (key: string, val: string) => ipcRenderer.send('app:store-set', key, val),

  /**
   * Invokes the 'app:store-get' event and returns a promise with the recent items.
   * @returns A promise that resolves with the recent items.
   */
  getRecent: (): Promise<string[]> => ipcRenderer.invoke('app:store-get'),

  /**
   * Invokes the 'system:get-system-info' event and returns a promise with the system information.
   * @returns A promise that resolves with the system information.
   */
  getSystemInfo: (): Promise<{
    OS: 'linux' | 'darwin' | 'win32' | ''
    architecture: 'x64' | 'arm' | ''
    prefersDarkMode: boolean
    isWindowMaximized: boolean
  }> => ipcRenderer.invoke('system:get-system-info'),

  /**
   * Invokes the 'app:store-retrieve-recent' event and returns a promise with the recent items.
   * @returns A promise that resolves with the recent items.
   */
  retrieveRecent: (): Promise<{ name: string; path: string; lastOpenedAt: string; createdAt: string }[]> =>
    ipcRenderer.invoke('app:store-retrieve-recent'),

  /**
   * Sends the 'window-controls:close' event to close the window.
   */
  handleCloseOrHideWindowAccelerator: () =>
    ipcRenderer.on('window-controls:request-close', () => ipcRenderer.send('window-controls:close')),
  removeHandleCloseOrHideWindowAccelerator: () => ipcRenderer.removeAllListeners('window-controls:request-close'),
  handleCloseOrHideWindow: () => ipcRenderer.send('window-controls:close'),

  /**
   * Check if window is closing
   */
  windowIsClosing: (callback: IpcRendererCallbacks) => ipcRenderer.on('window-controls:is-closing', callback),

  /**
   * Sends the 'window-controls:closed' event to close the window.
   */
  closeWindow: () => ipcRenderer.send('window-controls:closed'),

  /**
   * Sends the 'window-controls:minimize' event to minimize the window.
   */
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),

  /**
   * Sends the 'window-controls:maximize' event to maximize the window.
   */
  maximizeWindow: () => ipcRenderer.send('window-controls:maximize'),

  /**
   * Registers a callback for the 'window-controls:toggle-maximized' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  isMaximizedWindow: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('window-controls:toggle-maximized', (_event) => callback(_event)),

  /**
   * Sends the 'window:reload' event to reload the window.
   */
  reloadWindow: () => ipcRenderer.send('window:reload'),

  /**
   * Registers a callback for the 'system:update-theme' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  handleUpdateTheme: (callback: IpcRendererCallbacks) => ipcRenderer.on('system:update-theme', callback),

  /**
   * Sends the 'system:update-theme' event to update the theme.
   */
  winHandleUpdateTheme: () => ipcRenderer.send('system:update-theme'),

  /**
   * Registers a callback for the 'app:quit-accelerator' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */
  quitAppRequest: (callback: IpcRendererCallbacks) => ipcRenderer.on('app:quit-accelerator', callback),
  removeQuitAppListener: () => ipcRenderer.removeAllListeners('app:quit-accelerator'),

  darwinAppIsClosing: (callback: IpcRendererCallbacks) => ipcRenderer.on('app:darwin-is-closing', callback),
  handleQuitApp: () => ipcRenderer.send('app:quit'),

  /**
   * Sends the 'window-controls:hide' event to hide the window.
   */
  hideWindow: () => ipcRenderer.send('window-controls:hide'),

  /**
   * Sends the 'window:rebuild-menu' event to rebuild the window menu.
   */
  rebuildMenu: () => ipcRenderer.send('window:rebuild-menu'),

  /**
   * Creates a build directory for the compiler.
   * @param pathToUserProject - The path to the user's project.
   * @returns A promise that resolves with the success status and message.
   */
  createBuildDirectory: async (pathToUserProject: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:create-build-directory', pathToUserProject),
  exportProjectXml: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
    parseTo: 'old-editor' | 'codesys',
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:export-project-xml', pathToUserProject, dataToCreateXml, parseTo),

  /**
   * Creates an XML file for the build.
   * @param pathToUserProject - The path to the user's project.
   * @param dataToCreateXml - The data required to create the XML file.
   * @returns A promise that resolves with the success status and message.
   */
  createXmlFileToBuild: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:build-xml-file', pathToUserProject, dataToCreateXml),

  /**
   * Registers a callback for the 'compiler:export-project-request' event.
   * @param callback - The callback to be invoked when the event is triggered.
   */exportProjectRequest: (callback: IpcRendererCallbacks) =>

    ipcRenderer.on('compiler:export-project-request', (_event, value) => callback(_event, value)),

  /**
   * Removes all listeners for the 'compiler:export-project-request' event.
   */
  removeExportProjectListener: () => ipcRenderer.removeAllListeners('compiler:export-project-request'),

  /**
   * Mock implementation for compiling a request.
   * @param xmlPath - The path to the XML file.
   * @param callback - The callback to be invoked with the compilation result.
   */
  compileRequest: (xmlPath: string, callback: (args: any) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:build-st-program', xmlPath, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data)
    rendererProcessPort.addEventListener('close', () => console.log('Port closed'))
  },

  // !! UNDER DEVELOPMENT !!
  setupCompilerEnvironment: (callback: (args: any) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:setup-environment', '', [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data)
    rendererProcessPort.addEventListener('close', () => console.log('Port closed'))
  },
  /**
   * Execute the generation of the C files.
   * Creates an instance using the MessageChannel API to establish a communication between the two Electron processes to generate the C files.
   * @param pathToStProgram - The path to the ST program generated.
   * @todo This function should be refactored to handle the response and call the next stages in the compilation process.
   */
  generateCFilesRequest: (pathToStProgram: string, callback: (args: any) => void) => {
    /**
     * Create a new MessageChannel instance to establish communication between the renderer and main processes.
     */
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()

    /**
     * Send a message to the main process to generate the C files, passing the path to the ST program and the main process port.
     */
    ipcRenderer.postMessage('compiler:generate-c-files', pathToStProgram, [mainProcessPort])

    /**
     * Listen for messages from the main process.
     */
    rendererProcessPort.onmessage = (event) => callback(event.data)

    /**
     * Listen for the close event on the channel.
     */
    rendererProcessPort.addEventListener('close', () => console.log('Port closed'))
  },
  /**
   * Requests the device configuration options from the main process.
   */
  getDeviceConfigurationOptions: (): Promise<{
    ports: string[]
    boards: Map<
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
      }
    >
  }> => ipcRenderer.invoke('hardware:device-configuration-options'),
  /**
   * Requests the refresh of the communication ports from the main process.
   */
  refreshCommunicationPorts: (): Promise<string[]> => ipcRenderer.invoke('hardware:refresh-communication-ports'),
  /**
   * Requests the refresh of the available boards from the main process.
   */
  refreshAvailableBoards: (): Promise<{ board: string; version: string }[]> =>
    ipcRenderer.invoke('hardware:refresh-available-boards'),
  /**
   * Request the preview images folder from the main process.
   */
  getPreviewImage: (image: string): Promise<string> => ipcRenderer.invoke('util:get-preview-image', image),
}
export default rendererProcessBridge
