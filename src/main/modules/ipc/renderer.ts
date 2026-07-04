import type { DiscoveredRuntimeDevice, RuntimeLogEntry } from '@root/middleware/shared/ports'
import type { ESIDevice, ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import type {
  EtherCATRuntimeStatusResponse,
  EtherCATScanRequest,
  EtherCATScanResponse,
  EtherCATServiceStatusResponse,
  EtherCATTestRequest,
  EtherCATTestResponse,
  EtherCATValidateRequest,
  EtherCATValidateResponse,
  NetworkInterface,
} from '@root/middleware/shared/ports/ethercat-types'
import type {
  ListPublicLibrariesArgs,
  ListPublicLibrariesResponse,
} from '@root/middleware/shared/ports/public-catalog-types'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'
import { CreatePouFileProps, PouServiceResponse } from '@root/types/IPC/pou-service'
import { CreateProjectFileProps, IProjectServiceResponse } from '@root/types/IPC/project-service'
import { ipcRenderer, IpcRendererEvent } from 'electron'

type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: unknown[]) => void

/** Data posted through the MessagePort by the compiler module.
 *  `compileError` carries strucpp's structured `CompileError` (pouName,
 *  section, bodyLine, …) when the message is one of the per-error log
 *  entries emitted by the strucpp compile failure path — the renderer
 *  uses it to attach a click-to-open handler to the rendered line.
 *  Absent for plain progress messages. */
type CompilerPortMessage = {
  message?: string
  logLevel?: string
  compileError?: import('strucpp').CompileError
  simulatorFirmwarePath?: string
  plcStatus?: string
  closePort?: boolean
  /** Final structured outcome of a library build.  Set only on the
   *  close-port message emitted by `compileLibrary`; absent from
   *  intermediate log entries and from program-build / debug-build
   *  callbacks. */
  libraryBuildResult?: import('@root/middleware/shared/ports/types').CompileLibraryResult
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
  openPathPicker: (): Promise<{ success: boolean; error?: { title: string; description: string }; path?: string }> =>
    ipcRenderer.invoke('project:open-path-picker'),
  readProjectFiles: (projectPath: string): Promise<unknown> => ipcRenderer.invoke('project:read-files', projectPath),
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
  writeProjectFiles: (files: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('project:write-files', files),
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
  /**
   * Load all bundled .stlib archives. Returns parsed `StlibArchive`
   * objects in alphabetical-filename order. Typed as `unknown[]` here
   * so the IPC layer stays free of strucpp type imports — the
   * LibraryPort consumer narrows to `StlibArchiveDTO[]`.
   */
  // ===================== LIBRARY MANAGER METHODS =====================
  loadAllLibraries: (): Promise<unknown[]> => ipcRenderer.invoke('libraries:load-all'),
  listInstalledLibraries: (): Promise<
    Array<{
      name: string
      version: string
      bundled: boolean
      installedAt: string
      origin: 'stlib' | 'codesys' | 'bundled'
      displayName?: string
      description?: string
      author?: string
    }>
  > => ipcRenderer.invoke('libraries:list-installed'),
  installLibraryFromFile: (): Promise<
    | { success: true; canceled?: false; name: string; version: string; origin: 'stlib' | 'codesys' }
    | { success: true; canceled: true }
    | { success: false; error: string }
  > => ipcRenderer.invoke('libraries:install-from-file'),
  uninstallLibrary: (name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('libraries:uninstall', name),
  // ----- Public-library catalog (autonomy-edge) -----
  queryPublicCatalog: (
    args: ListPublicLibrariesArgs,
  ): Promise<{ success: true; data: ListPublicLibrariesResponse } | { success: false; error: string }> =>
    ipcRenderer.invoke('catalog:list', args),
  installLibrariesFromCatalog: (
    publishedLibraryIds: string[],
  ): Promise<{
    results: Array<{
      publishedLibraryId: string
      success: boolean
      name?: string
      version?: string
      error?: string
    }>
  }> => ipcRenderer.invoke('catalog:install-many', publishedLibraryIds),
  onLibrariesChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('libraries:changed', listener)
    return () => ipcRenderer.removeListener('libraries:changed', listener)
  },
  handleQuitApp: () => ipcRenderer.send('app:quit'),
  openExternalLinkAccelerator: (link: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-external-link', link),
  quitAppRequest: (callback: IpcRendererCallbacks) => ipcRenderer.on('app:quit-accelerator', callback),
  removeQuitAppListener: () => ipcRenderer.removeAllListeners('app:quit-accelerator'),
  retrieveRecent: (): Promise<{ name: string; path: string; lastOpenedAt: string; createdAt: string }[]> =>
    ipcRenderer.invoke('app:store-retrieve-recent'),
  /** Drop a recent-projects entry without touching disk — used by the
   *  start screen's "Remove from list" action. */
  removeProjectFromRecent: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('project:remove-from-recent', projectPath),
  /** Recursively delete a project directory AND drop it from the recent
   *  list. Gated by the main-process service's `project.json` safety
   *  check — see `ProjectService.deleteProject`. */
  deleteProject: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('project:delete', projectPath),
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
  winHandleUpdateTheme: (theme?: 'light' | 'dark' | 'nineties') => ipcRenderer.send('system:update-theme', theme),
  winGetTheme: (): Promise<'light' | 'dark' | 'nineties' | null> => ipcRenderer.invoke('system:get-theme'),

  // ===================== COMPILER/BUILD METHODS =====================
  // !! Deprecated: This method is an outdated implementation and should be substituted.
  exportProjectXml: async (
    pathToUserProject: string,
    dataToCreateXml: PLCProjectData,
    parseTo: 'old-editor' | 'codesys',
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:export-project-xml', pathToUserProject, dataToCreateXml, parseTo) as Promise<{
      success: boolean
      message: string
    }>,
  // =================== Work in Progress ===================
  // This method is a placeholder for running the compile program.
  runCompileProgram: (
    compileProgramArgs: Array<string | boolean | null | PLCProjectData | Record<string, unknown>>,
    callback: (args: CompilerPortMessage) => void,
  ) => {
    // Create a MessageChannel to communicate between the renderer and main process
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    // Send to the main process a message to run the compile program
    // The main process will handle the compilation and send the result back through the port
    ipcRenderer.postMessage('compiler:run-compile-program', compileProgramArgs, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data as CompilerPortMessage)
    rendererProcessPort.addEventListener('close', () =>
      callback({
        closePort: true,
      }),
    )
    // rendererProcessPort.start()
    // Set up the renderer process port to listen for messages from the main process
  },

  runDebugCompilation: (compileArgs: Array<string | PLCProjectData>, callback: (args: CompilerPortMessage) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:run-debug-compilation', compileArgs, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data as CompilerPortMessage)
    rendererProcessPort.addEventListener('close', () =>
      callback({
        closePort: true,
      }),
    )
  },

  /** Build the open Library Project into a `.stlib` archive.  Same
   *  MessageChannel pattern as `runCompileProgram`.  Args:
   *    [0] projectPath
   *    [1] projectData preprocessed with `isSimulator: false` (full
   *        Python-as-ST), used for the library build proper.
   *    [2] projectData preprocessed with `isSimulator: true` (Python
   *        as no-op stubs), used as input to the simulator-target
   *        verification compile so it doesn't try to link Python
   *        loader externs the AVR simulator runtime doesn't ship.
   *    [3] cleanBuild flag (skips the verification cache).
   *  Callback receives a stream of log messages and a final
   *  `libraryBuildResult`. */
  runCompileLibrary: (
    compileArgs: Array<string | PLCProjectData | boolean>,
    callback: (args: CompilerPortMessage) => void,
  ) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:run-compile-library', compileArgs, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data as CompilerPortMessage)
    rendererProcessPort.addEventListener('close', () => callback({ closePort: true }))
  },

  // !! Deprecated: These methods are an outdated implementation and should be removed.
  compileRequest: (xmlPath: string, callback: (args: CompilerPortMessage) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:build-st-program', xmlPath, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data as CompilerPortMessage)
    rendererProcessPort.addEventListener('close', () => {})
  },
  createBuildDirectory: async (pathToUserProject: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:create-build-directory', pathToUserProject) as Promise<{
      success: boolean
      message: string
    }>,
  createXmlFileToBuild: async (
    pathToUserProject: string,
    dataToCreateXml: PLCProjectData,
  ): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('compiler:build-xml-file', pathToUserProject, dataToCreateXml) as Promise<{
      success: boolean
      message: string
    }>,
  exportProjectRequest: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('compiler:export-project-request', (_event, value) => callback(_event, value)),
  generateCFilesRequest: (pathToStProgram: string, callback: (args: CompilerPortMessage) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:generate-c-files', pathToStProgram, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data as CompilerPortMessage)
    rendererProcessPort.addEventListener('close', () => {})
  },
  removeExportProjectListener: () => ipcRenderer.removeAllListeners('compiler:export-project-request'),
  setupCompilerEnvironment: (callback: (args: CompilerPortMessage) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:setup-environment', '', [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data as CompilerPortMessage)
    rendererProcessPort.addEventListener('close', () => {})
  },

  // ===================== HARDWARE METHODS =====================
  getAvailableBoards: (): Promise<
    Map<
      string,
      {
        compiler: 'arduino-cli' | 'openplc-compiler' | 'simulator'
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

  // ===================== PACKAGE MANAGER METHODS =====================
  importPackageFromFile: (): Promise<{
    success: boolean
    canceled?: boolean
    packageId?: string
    packageName?: string
    devices?: string[]
    error?: string
  }> => ipcRenderer.invoke('packages:import-from-file'),
  installPackageFromUrl: (args: {
    packageId: string
    version: string
    downloadUrl: string
  }): Promise<{
    success: boolean
    canceled?: boolean
    packageId?: string
    packageName?: string
    devices?: string[]
    error?: string
  }> => ipcRenderer.invoke('packages:install-from-url', args),
  listInstalledPackages: (): Promise<
    Array<{ packageId: string; version: string; installedAt: string; path: string; devices: string[] }>
  > => ipcRenderer.invoke('packages:list-installed'),
  uninstallPackage: (packageId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('packages:uninstall', packageId),
  getPackageManifest: (packageId: string): Promise<unknown> => ipcRenderer.invoke('packages:get-manifest', packageId),
  verifyInstalledPackageSignatures: (): Promise<string[]> => ipcRenderer.invoke('packages:verify-signatures'),
  onOpenPackageManager: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('packages:open-manager', listener)
    return () => ipcRenderer.removeListener('packages:open-manager', listener)
  },
  onBoardsUpdated: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('packages:boards-updated', listener)
    return () => ipcRenderer.removeListener('packages:boards-updated', listener)
  },

  // ===================== UTILITY METHODS =====================
  getPreviewImage: (image: string, packagePath?: string): Promise<string> =>
    ipcRenderer.invoke('util:get-preview-image', image, packagePath),
  log: (level: 'info' | 'error', message: string) => ipcRenderer.send('util:log', { level, message }),
  readDebugFile: (
    projectPath: string,
    boardTarget: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('util:read-debug-file', projectPath, boardTarget),

  debuggerVerifyMd5: (
    connectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator',
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
    connectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator',
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
    includeStats?: boolean,
  ): Promise<{
    success: boolean
    status?: string
    timingStats?: {
      tasks: Array<{
        name: string
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
      }>
    }
    error?: string
  }> => ipcRenderer.invoke('runtime:get-status', ipAddress, includeStats),
  runtimeStartPlc: (ipAddress: string): Promise<{ success: boolean; error?: string; status?: string }> =>
    ipcRenderer.invoke('runtime:start-plc', ipAddress),
  runtimeStopPlc: (ipAddress: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('runtime:stop-plc', ipAddress),
  runtimeGetCompilationStatus: (
    ipAddress: string,
  ): Promise<{
    success: boolean
    data?: { status: string; logs: string[]; exit_code: number | null }
    error?: string
  }> => ipcRenderer.invoke('runtime:get-compilation-status', ipAddress),
  runtimeGetLogs: (
    ipAddress: string,
    minId?: number,
  ): Promise<{ success: boolean; logs?: string | RuntimeLogEntry[]; error?: string }> =>
    ipcRenderer.invoke('runtime:get-logs', ipAddress, minId),
  runtimeClearCredentials: (): Promise<{ success: boolean }> => ipcRenderer.invoke('runtime:clear-credentials'),
  runtimeGetSerialPorts: (
    ipAddress: string,
  ): Promise<{ success: boolean; ports?: Array<{ device: string; description?: string }>; error?: string }> =>
    ipcRenderer.invoke('runtime:get-serial-ports', ipAddress),
  runtimeDiscoverDevices: (opts?: {
    durationMs?: number
  }): Promise<{ success: boolean; devices?: DiscoveredRuntimeDevice[]; error?: string }> =>
    ipcRenderer.invoke('runtime:discover-devices', opts),
  onRuntimeDeviceDiscovered: (callback: (_event: IpcRendererEvent, device: DiscoveredRuntimeDevice) => void) => {
    ipcRenderer.on('runtime:device-discovered', callback)
    return () => ipcRenderer.removeListener('runtime:device-discovered', callback)
  },
  onRuntimeTokenRefreshed: (callback: (_event: IpcRendererEvent, newToken: string) => void) => {
    ipcRenderer.on('runtime:token-refreshed', callback)
    return () => ipcRenderer.removeListener('runtime:token-refreshed', callback)
  },

  // ===================== ETHERCAT DISCOVERY METHODS =====================
  etherCATGetInterfaces: (
    ipAddress: string,
  ): Promise<{ success: boolean; data?: NetworkInterface[]; error?: string }> =>
    ipcRenderer.invoke('ethercat:get-interfaces', ipAddress),

  etherCATGetStatus: (
    ipAddress: string,
  ): Promise<{ success: boolean; data?: EtherCATServiceStatusResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:get-status', ipAddress),

  etherCATScan: (
    ipAddress: string,
    scanRequest: EtherCATScanRequest,
  ): Promise<{ success: boolean; data?: EtherCATScanResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:scan', ipAddress, scanRequest),

  etherCATTest: (
    ipAddress: string,
    testRequest: EtherCATTestRequest,
  ): Promise<{ success: boolean; data?: EtherCATTestResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:test', ipAddress, testRequest),

  etherCATValidate: (
    ipAddress: string,
    validateRequest: EtherCATValidateRequest,
  ): Promise<{ success: boolean; data?: EtherCATValidateResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:validate', ipAddress, validateRequest),

  etherCATGetRuntimeStatus: (
    ipAddress: string,
  ): Promise<{ success: boolean; data?: EtherCATRuntimeStatusResponse; error?: string }> =>
    ipcRenderer.invoke('ethercat:get-runtime-status', ipAddress),

  // ===================== ESI REPOSITORY METHODS =====================
  esiLoadRepositoryIndex: (
    projectPath: string,
  ): Promise<{
    success: boolean
    data?: { version: number; items: Array<Record<string, unknown>> }
    error?: string
  }> => ipcRenderer.invoke('esi:load-repository-index', projectPath),

  esiSaveXmlFile: (
    projectPath: string,
    itemId: string,
    xmlContent: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:save-xml-file', projectPath, itemId, xmlContent),

  esiLoadXmlFile: (
    projectPath: string,
    itemId: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('esi:load-xml-file', projectPath, itemId),

  esiDeleteXmlFile: (projectPath: string, itemId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:delete-xml-file', projectPath, itemId),

  esiParseAndSaveFile: (
    projectPath: string,
    filename: string,
    content: string,
  ): Promise<{ success: boolean; item?: ESIRepositoryItemLight; duplicate?: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:parse-and-save-file', projectPath, filename, content),

  esiClearRepository: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:clear-repository', projectPath),

  esiLoadDeviceFull: (
    projectPath: string,
    itemId: string,
    deviceIndex: number,
  ): Promise<{ success: boolean; device?: ESIDevice; error?: string }> =>
    ipcRenderer.invoke('esi:load-device-full', projectPath, itemId, deviceIndex),

  esiLoadRepositoryLight: (
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; needsMigration?: boolean; error?: string }> =>
    ipcRenderer.invoke('esi:load-repository-light', projectPath),

  esiMigrateRepository: (
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; error?: string }> =>
    ipcRenderer.invoke('esi:migrate-repository', projectPath),

  // ===================== SIMULATOR METHODS =====================
  simulatorLoadFirmware: (hexPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('simulator:load-firmware', hexPath),
  simulatorStop: (): Promise<{ success: boolean }> => ipcRenderer.invoke('simulator:stop'),
  simulatorIsRunning: (): Promise<boolean> => ipcRenderer.invoke('simulator:is-running'),
  onSimulatorStopped: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('simulator:stopped', listener)
    return () => ipcRenderer.removeListener('simulator:stopped', listener)
  },

  // ===================== FILE WATCHER METHODS =====================
  fileWatchStart: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('file:watch-start', filePath),
  fileWatchStop: (filePath: string): Promise<{ success: boolean }> => ipcRenderer.invoke('file:watch-stop', filePath),
  fileWatchStopAll: (): Promise<{ success: boolean }> => ipcRenderer.invoke('file:watch-stop-all'),
  fileReadContent: (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('file:read-content', filePath),
  onFileExternalChange: (callback: (_event: IpcRendererEvent, data: { filePath: string }) => void) => {
    ipcRenderer.on('file:external-change', callback)
    return () => ipcRenderer.removeListener('file:external-change', callback)
  },
}
export default rendererProcessBridge
