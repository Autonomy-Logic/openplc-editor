/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import type {
  EtherCATScanRequest,
  EtherCATScanResponse,
  EtherCATServiceStatusResponse,
  EtherCATTestRequest,
  EtherCATTestResponse,
  EtherCATValidateRequest,
  EtherCATValidateResponse,
  NetworkInterface,
} from '@root/types/ethercat'
import type { ESIDevice, ESIRepositoryItem, ESIRepositoryItemLight } from '@root/types/ethercat/esi-types'
import { CreatePouFileProps, PouServiceResponse } from '@root/types/IPC/pou-service'
import { CreateProjectFileProps, IProjectServiceResponse } from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { RuntimeLogEntry } from '@root/types/PLC/runtime-logs'
import { ipcRenderer, IpcRendererEvent } from 'electron'

import { ProjectState } from '../../../renderer/store/slices'
import { PLCPou, PLCProject } from '../../../types/PLC/open-plc'

type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: any) => void

type IDataToWrite = {
  projectPath: string
  content: {
    projectData: PLCProject
    pous: PLCPou[]
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
    servers?: ProjectState['data']['servers']
    remoteDevices?: ProjectState['data']['remoteDevices']
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
  deleteFileAccelerator: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:delete-file-accelerator', callback),
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
  removeDeleteFileListener: () => ipcRenderer.removeAllListeners('workspace:delete-file-accelerator'),
  removeOpenProjectAccelerator: () => ipcRenderer.removeAllListeners('project:open-project-request'),
  removeOpenRecentListener: () => ipcRenderer.removeAllListeners('project:open-recent-accelerator'),
  removeSaveFileAccelerator: () => ipcRenderer.removeAllListeners('project:save-file-accelerator'),
  removeSaveProjectAccelerator: () => ipcRenderer.removeAllListeners('project:save-accelerator'),
  saveFile: (filePath: string, content: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('project:save-file', filePath, content),
  saveFileAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-file-accelerator', callback),
  saveProject: (dataToWrite: IDataToWrite): Promise<ISaveDataResponse> =>
    ipcRenderer.invoke('project:save', dataToWrite),
  saveProjectAccelerator: (callback: IpcRendererCallbacks) => ipcRenderer.on('project:save-accelerator', callback),
  switchPerspective: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('workspace:switch-perspective-accelerator', callback),

  // ===================== POU METHODS =====================
  createPouFile: (props: CreatePouFileProps): Promise<PouServiceResponse> => ipcRenderer.invoke('pou:create', props),
  deletePouFile: (filePath: string): Promise<PouServiceResponse> => ipcRenderer.invoke('pou:delete', filePath),
  renamePouFile: (data: {
    filePath: string
    newFileName: string
    fileContent?: unknown
  }): Promise<PouServiceResponse> => ipcRenderer.invoke('pou:rename', data),

  // ===================== EDIT METHODS =====================
  handleUndoRequest: (callback: IpcRendererCallbacks) => ipcRenderer.on('edit:undo-request', callback),
  removeUndoRequestListener: () => ipcRenderer.removeAllListeners('edit:undo-request'),
  handleRedoRequest: (callback: IpcRendererCallbacks) => ipcRenderer.on('edit:redo-request', callback),
  removeRedoRequestListener: () => ipcRenderer.removeAllListeners('edit:redo-request'),

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
    compileProgramArgs: Array<string | boolean | null | ProjectState['data']>,
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

  runDebugCompilation: (compileArgs: Array<string | ProjectState['data']>, callback: (args: any) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:run-debug-compilation', compileArgs, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data)
    rendererProcessPort.addEventListener('close', () =>
      callback({
        closePort: true,
      }),
    )
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
        compiler: 'arduino-cli' | 'openplc-compiler'
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
  getAvailableCommunicationPorts: (): Promise<{ name: string; address: string }[]> =>
    ipcRenderer.invoke('hardware:get-available-communication-ports'),
  refreshAvailableBoards: (): Promise<{ board: string; version: string }[]> =>
    ipcRenderer.invoke('hardware:refresh-available-boards'),
  refreshCommunicationPorts: (): Promise<{ name: string; address: string }[]> =>
    ipcRenderer.invoke('hardware:refresh-communication-ports'),

  // ===================== UTILITY METHODS =====================
  getPreviewImage: (image: string): Promise<string> => ipcRenderer.invoke('util:get-preview-image', image),
  log: (level: 'info' | 'error', message: string) => ipcRenderer.send('util:log', { level, message }),
  readDebugFile: (
    projectPath: string,
    boardTarget: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('util:read-debug-file', projectPath, boardTarget),

  debuggerVerifyMd5: (
    connectionType: 'tcp' | 'rtu' | 'websocket',
    connectionParams: {
      ipAddress?: string
      port?: string
      baudRate?: number
      slaveId?: number
      jwtToken?: string
    },
    expectedMd5: string,
  ): Promise<{ success: boolean; match?: boolean; targetMd5?: string; error?: string }> =>
    ipcRenderer.invoke('debugger:verify-md5', connectionType, connectionParams, expectedMd5),

  debuggerReadProgramStMd5: (
    projectPath: string,
    boardTarget: string,
  ): Promise<{ success: boolean; md5?: string; error?: string }> =>
    ipcRenderer.invoke('debugger:read-program-st-md5', projectPath, boardTarget),

  debuggerGetVariablesList: (
    variableIndexes: number[],
  ): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    data?: number[]
    error?: string
    needsReconnect?: boolean
  }> => ipcRenderer.invoke('debugger:get-variables-list', variableIndexes),

  debuggerSetVariable: (
    variableIndex: number,
    force: boolean,
    valueBuffer?: Uint8Array,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('debugger:set-variable', variableIndex, force, valueBuffer),

  debuggerConnect: (
    connectionType: 'tcp' | 'rtu' | 'websocket',
    connectionParams: {
      ipAddress?: string
      port?: string
      baudRate?: number
      slaveId?: number
      jwtToken?: string
    },
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('debugger:connect', connectionType, connectionParams),

  debuggerDisconnect: (): Promise<{ success: boolean }> => ipcRenderer.invoke('debugger:disconnect'),

  // ===================== RUNTIME API METHODS =====================
  runtimeGetUsersInfo: (ipAddress: string): Promise<{ hasUsers: boolean; runtimeVersion?: string; error?: string }> =>
    ipcRenderer.invoke('runtime:get-users-info', ipAddress),
  runtimeCreateUser: (
    ipAddress: string,
    username: string,
    password: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('runtime:create-user', ipAddress, username, password),
  runtimeLogin: (
    ipAddress: string,
    username: string,
    password: string,
  ): Promise<{ success: boolean; accessToken?: string; error?: string }> =>
    ipcRenderer.invoke('runtime:login', ipAddress, username, password),
  runtimeGetStatus: (
    ipAddress: string,
    jwtToken: string,
    includeStats?: boolean,
  ): Promise<{
    success: boolean
    status?: string
    timingStats?: {
      scan_count: number
      scan_time_min: number | null
      scan_time_max: number | null
      scan_time_avg: number | null
      cycle_time_min: number | null
      cycle_time_max: number | null
      cycle_time_avg: number | null
      cycle_latency_min: number | null
      cycle_latency_max: number | null
      cycle_latency_avg: number | null
      overruns: number
    }
    error?: string
  }> => ipcRenderer.invoke('runtime:get-status', ipAddress, jwtToken, includeStats),
  runtimeStartPlc: (ipAddress: string, jwtToken: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('runtime:start-plc', ipAddress, jwtToken),
  runtimeStopPlc: (ipAddress: string, jwtToken: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('runtime:stop-plc', ipAddress, jwtToken),
  runtimeGetCompilationStatus: (
    ipAddress: string,
    jwtToken: string,
  ): Promise<{
    success: boolean
    data?: { status: string; logs: string[]; exit_code: number | null }
    error?: string
  }> => ipcRenderer.invoke('runtime:get-compilation-status', ipAddress, jwtToken),
  runtimeGetLogs: (
    ipAddress: string,
    jwtToken: string,
    minId?: number,
  ): Promise<{ success: boolean; logs?: string | RuntimeLogEntry[]; error?: string }> =>
    ipcRenderer.invoke('runtime:get-logs', ipAddress, jwtToken, minId),
  runtimeClearCredentials: (): Promise<{ success: boolean }> => ipcRenderer.invoke('runtime:clear-credentials'),
  runtimeGetSerialPorts: (
    ipAddress: string,
    jwtToken: string,
  ): Promise<{ success: boolean; ports?: Array<{ device: string; description?: string }>; error?: string }> =>
    ipcRenderer.invoke('runtime:get-serial-ports', ipAddress, jwtToken),
  onRuntimeTokenRefreshed: (callback: (_event: IpcRendererEvent, newToken: string) => void) => {
    ipcRenderer.on('runtime:token-refreshed', callback)
    return () => ipcRenderer.removeListener('runtime:token-refreshed', callback)
  },

  // ===================== ETHERCAT DISCOVERY METHODS =====================
  /**
   * Get list of network interfaces available for EtherCAT communication
   */
  etherCATGetInterfaces: (
    ipAddress: string,
    jwtToken: string,
  ): Promise<{ success: boolean; data?: NetworkInterface[]; error?: string }> =>
    ipcRenderer.invoke('ethercat:get-interfaces', ipAddress, jwtToken),

  /**
   * Check if EtherCAT discovery service is available on the runtime
   */
  etherCATGetStatus: (
    ipAddress: string,
    jwtToken: string,
  ): Promise<{ success: boolean; data?: EtherCATServiceStatusResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:get-status', ipAddress, jwtToken),

  /**
   * Scan for EtherCAT devices on a network interface
   */
  etherCATScan: (
    ipAddress: string,
    jwtToken: string,
    scanRequest: EtherCATScanRequest,
  ): Promise<{ success: boolean; data?: EtherCATScanResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:scan', ipAddress, jwtToken, scanRequest),

  /**
   * Test connection to a specific EtherCAT slave
   */
  etherCATTest: (
    ipAddress: string,
    jwtToken: string,
    testRequest: EtherCATTestRequest,
  ): Promise<{ success: boolean; data?: EtherCATTestResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:test', ipAddress, jwtToken, testRequest),

  /**
   * Validate an EtherCAT configuration
   */
  etherCATValidate: (
    ipAddress: string,
    jwtToken: string,
    validateRequest: EtherCATValidateRequest,
  ): Promise<{ success: boolean; data?: EtherCATValidateResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:validate', ipAddress, jwtToken, validateRequest),

  // ===================== ESI REPOSITORY METHODS =====================

  /**
   * Load ESI repository index from project
   */
  esiLoadRepositoryIndex: (
    projectPath: string,
  ): Promise<{
    success: boolean
    data?: {
      version: number
      items: Array<{
        id: string
        filename: string
        vendorId: string
        vendorName: string
        deviceCount: number
        loadedAt: number
        warnings?: string[]
      }>
    } | null
    error?: string
  }> => ipcRenderer.invoke('esi:load-repository-index', projectPath),

  /**
   * Save ESI repository index to project
   */
  esiSaveRepositoryIndex: (
    projectPath: string,
    items: ESIRepositoryItem[],
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:save-repository-index', projectPath, items),

  /**
   * Save an ESI XML file to project
   */
  esiSaveXmlFile: (
    projectPath: string,
    itemId: string,
    xmlContent: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:save-xml-file', projectPath, itemId, xmlContent),

  /**
   * Load an ESI XML file from project
   */
  esiLoadXmlFile: (
    projectPath: string,
    itemId: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('esi:load-xml-file', projectPath, itemId),

  /**
   * Delete an ESI XML file from project
   */
  esiDeleteXmlFile: (projectPath: string, itemId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:delete-xml-file', projectPath, itemId),

  /**
   * Save a complete ESI repository item (XML + update index)
   */
  esiSaveRepositoryItem: (
    projectPath: string,
    item: ESIRepositoryItem,
    xmlContent: string,
    existingItems: ESIRepositoryItem[],
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:save-repository-item', projectPath, item, xmlContent, existingItems),

  /**
   * Delete an ESI repository item (XML + update index)
   */
  esiDeleteRepositoryItem: (
    projectPath: string,
    itemId: string,
    existingItems: ESIRepositoryItem[],
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:delete-repository-item', projectPath, itemId, existingItems),

  // ===================== ESI OPTIMIZED (v2) METHODS =====================

  /**
   * Parse and save a single ESI file in the main process
   */
  esiParseAndSaveFile: (
    projectPath: string,
    filename: string,
    content: string,
  ): Promise<{ success: boolean; item?: ESIRepositoryItemLight; error?: string }> =>
    ipcRenderer.invoke('esi:parse-and-save-file', projectPath, filename, content),

  /**
   * Clear the entire ESI repository (bulk delete all files + reset index)
   */
  esiClearRepository: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:clear-repository', projectPath),

  /**
   * Load a full ESI device on-demand (with PDOs, SM, FMMU)
   */
  esiLoadDeviceFull: (
    projectPath: string,
    itemId: string,
    deviceIndex: number,
  ): Promise<{ success: boolean; device?: ESIDevice; error?: string }> =>
    ipcRenderer.invoke('esi:load-device-full', projectPath, itemId, deviceIndex),

  /**
   * Load repository as lightweight items (instant from v2 cache)
   */
  esiLoadRepositoryLight: (
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; needsMigration?: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:load-repository-light', projectPath),

  /**
   * Migrate v1 repository to v2 with device summaries
   */
  esiMigrateRepository: (
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; error?: string }> =>
    ipcRenderer.invoke('esi:migrate-repository', projectPath),
}
export default rendererProcessBridge
