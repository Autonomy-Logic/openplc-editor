import type { CompileProgramIpcArgs } from '@root/middleware/adapters/editor/compile-program-flow'
import type { CompileLibraryIpcArgs } from '@root/middleware/adapters/editor/compiler-adapter'
import type {
  DiscoveredRuntimeDevice,
  RuntimeLogEntry,
  RuntimeProjectSnapshotMetadata,
} from '@root/middleware/shared/ports'
import type {
  DeviceConnectionStatusPayload,
  DeviceLicenseReport,
  DeviceLicenseRequest,
} from '@root/middleware/shared/ports/device-port'
import type { EdgeSignInOutcome, EdgeUserRead } from '@root/middleware/shared/ports/edge-account-port'
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
  CloudFoldersResult,
  CloudProjectsResult,
  RawProjectFiles,
  UploadProjectParams,
  UploadProjectResult,
  WriteProjectFiles,
} from '@root/middleware/shared/ports/project-port'
import type {
  ListPublicLibrariesArgs,
  ListPublicLibrariesResponse,
  PublicLibrary,
} from '@root/middleware/shared/ports/public-catalog-types'
import type {
  ListUsersResult,
  RetainConfigResult,
  RuntimeUserRole,
  UpdateRetainConfigParams,
  UpdateUserParams,
  WhoAmIResult,
} from '@root/middleware/shared/ports/runtime-port'
import type { DebugConnectionConfig } from '@root/middleware/shared/ports/types'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'
import type {
  Branch,
  BranchDiffWithBase,
  Commit,
  CommitFile,
  CommitInfo,
  MergeResult,
  PendingChange,
  Stash,
  VersionControlResult,
} from '@root/middleware/shared/ports/version-control-port'
import { CreatePouFileProps, PouServiceResponse } from '@root/types/IPC/pou-service'
import { CreateProjectFileProps, IProjectServiceResponse } from '@root/types/IPC/project-service'
import { ipcRenderer, IpcRendererEvent } from 'electron'

type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: unknown[]) => void

/**
 * Register an IPC listener and hand back a per-listener unsubscribe.
 *
 * `removeAllListeners(channel)` would drop sibling subscribers on the same
 * channel, so every `on`-style bridge method routes through here and returns
 * the disposer instead. Callers that mount the same subscription repeatedly
 * (React effects re-running on dependency changes) must call it on cleanup —
 * otherwise dead listeners pile up until Node warns past ten.
 */
const subscribe = (channel: string, callback: IpcRendererCallbacks): (() => void) => {
  const listener: IpcRendererCallbacks = (event, ...args) => callback(event, ...args)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

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
  /** The build's verdict, carried on the `closePort` message. Sourced from
   *  `runCompilePipeline`, which reduces every step's process exit code to one
   *  boolean, so it — not the presence of error-level log lines — is what
   *  decides whether a build failed.
   *
   *  Declared here because the seam is typed: `onmessage` currently forwards
   *  `event.data` wholesale, so a consumer reading a `Record<string, unknown>`
   *  sees the field regardless. A bridge refactor that reconstructs the
   *  message field-by-field (the shape the `libraryBuildResult` path already
   *  uses) would otherwise drop it silently, and `compileProgramFlow` would
   *  fall back to its `hasError` heuristic — reintroducing a resolved bug with
   *  no compile error and no failing test. */
  success?: boolean
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
  aboutAccelerator: (callback: IpcRendererCallbacks) => subscribe('website:about-accelerator', callback),
  aboutModalAccelerator: (callback: IpcRendererCallbacks) => subscribe('about:open-accelerator', callback),
  closeProjectAccelerator: (callback: IpcRendererCallbacks) =>
    subscribe('workspace:close-project-accelerator', callback),
  closeTabAccelerator: (callback: IpcRendererCallbacks) => subscribe('workspace:close-tab-accelerator', callback),
  createProject: (data: CreateProjectFileProps): Promise<IProjectServiceResponse> =>
    ipcRenderer.invoke('project:create', data),
  createProjectAccelerator: (callback: IpcRendererCallbacks) => subscribe('project:create-accelerator', callback),
  deleteFileAccelerator: (callback: IpcRendererCallbacks) => subscribe('workspace:delete-file-accelerator', callback),
  findInProjectAccelerator: (callback: IpcRendererCallbacks) =>
    subscribe('project:find-in-project-accelerator', callback),
  handleOpenProjectRequest: (callback: IpcRendererCallbacks) => subscribe('project:open-project-request', callback),
  openProject: (): Promise<IProjectServiceResponse> => ipcRenderer.invoke('project:open'),
  openProjectByPath: (projectPath: string): Promise<IProjectServiceResponse> =>
    ipcRenderer.invoke('project:open-by-path', projectPath),
  openRecentAccelerator: (callback: IpcRendererCallbacks) => subscribe('project:open-recent-accelerator', callback),
  pathPicker: (): Promise<{ success: boolean; error?: { title: string; description: string }; path?: string }> =>
    ipcRenderer.invoke('project:path-picker'),
  openPathPicker: (): Promise<{ success: boolean; error?: { title: string; description: string }; path?: string }> =>
    ipcRenderer.invoke('project:open-path-picker'),
  readProjectFiles: (projectPath: string): Promise<unknown> => ipcRenderer.invoke('project:read-files', projectPath),
  pickPlcopenImportFile: (): Promise<{
    success: boolean
    content?: string
    error?: { title: string; description: string }
  }> => ipcRenderer.invoke('project:pick-plcopen-import-file'),
  exportPlcopenFile: (
    defaultFileName: string,
    xml: string,
  ): Promise<{ success: boolean; error?: { title: string; description: string } }> =>
    ipcRenderer.invoke('project:export-plcopen-file', defaultFileName, xml),
  saveFile: (filePath: string, content: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('project:save-file', filePath, content),
  saveFileAccelerator: (callback: IpcRendererCallbacks) => subscribe('project:save-file-accelerator', callback),
  writeProjectFiles: (files: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('project:write-files', files),
  saveProjectAccelerator: (callback: IpcRendererCallbacks) => subscribe('project:save-accelerator', callback),
  saveProjectAsAccelerator: (callback: IpcRendererCallbacks) => subscribe('project:save-as-accelerator', callback),
  switchPerspective: (callback: IpcRendererCallbacks) =>
    subscribe('workspace:switch-perspective-accelerator', callback),

  // ===================== POU METHODS =====================
  createPouFile: (props: CreatePouFileProps): Promise<PouServiceResponse> => ipcRenderer.invoke('pou:create', props),
  deletePouFile: (filePath: string): Promise<PouServiceResponse> => ipcRenderer.invoke('pou:delete', filePath),
  renamePouFile: (data: {
    filePath: string
    newFileName: string
    fileContent?: unknown
  }): Promise<PouServiceResponse> => ipcRenderer.invoke('pou:rename', data),

  // ===================== EDIT METHODS =====================
  handleUndoRequest: (callback: IpcRendererCallbacks) => subscribe('edit:undo-request', callback),
  handleRedoRequest: (callback: IpcRendererCallbacks) => subscribe('edit:redo-request', callback),

  // ===================== APP & SYSTEM METHODS =====================
  darwinAppIsClosing: (callback: IpcRendererCallbacks) => subscribe('app:darwin-is-closing', callback),
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
    libraries: PublicLibrary[],
  ): Promise<{
    results: Array<{
      publishedLibraryId: string
      success: boolean
      name?: string
      version?: string
      error?: string
    }>
  }> => ipcRenderer.invoke('catalog:install-many', libraries),
  // ----- Edge account (optional sign-in, autonomy-edge) -----
  // Every call crosses to the main process because the desktop holds its own session:
  // the renderer is not on Edge's origin, so it can neither inherit the shared-domain
  // cookie the web editor uses nor issue the request itself.
  edgeAccountFetchUser: (): Promise<EdgeUserRead> => ipcRenderer.invoke('edge-account:fetch-user'),
  edgeAccountFetchPlanCaption: (): Promise<string | null> => ipcRenderer.invoke('edge-account:fetch-plan-caption'),
  edgeAccountSignIn: (email: string, password: string): Promise<EdgeSignInOutcome> =>
    ipcRenderer.invoke('edge-account:sign-in', { email, password }),
  edgeAccountSignOut: (): Promise<void> => ipcRenderer.invoke('edge-account:sign-out'),
  edgeAccountIsSessionPersistent: (): Promise<boolean> => ipcRenderer.invoke('edge-account:is-session-persistent'),
  // ----- Edge projects -----
  edgeProjectsListRecent: (limit: number): Promise<CloudProjectsResult> =>
    ipcRenderer.invoke('edge-projects:list-recent', limit),
  edgeProjectsRead: (projectId: string): Promise<RawProjectFiles> =>
    ipcRenderer.invoke('edge-projects:read', projectId),
  edgeProjectsSaveProject: (files: WriteProjectFiles): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('edge-projects:save-project', files),
  edgeProjectsSaveFile: (filePath: string, content: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('edge-projects:save-file', filePath, content),
  // ----- Publishing a local project to Edge -----
  edgeUploadListFolders: (): Promise<CloudFoldersResult> => ipcRenderer.invoke('edge-upload:list-folders'),
  edgeUploadProject: (params: UploadProjectParams): Promise<UploadProjectResult> =>
    ipcRenderer.invoke('edge-upload:project', params),
  // ----- Edge version control -----
  // One channel per operation, matching how `edge-account:*` and `edge-projects:*` are
  // laid out. `EdgeVcResult` rather than a thrown error because a typed error class does
  // not survive IPC: the adapter rebuilds the real error on the other side.
  edgeVcListBranches: (projectId: string): Promise<VersionControlResult<{ branches: Branch[] }>> =>
    ipcRenderer.invoke('edge-vc:list-branches', projectId),
  edgeVcCreateBranch: (projectId: string, name: string): Promise<VersionControlResult<{ branch: Branch }>> =>
    ipcRenderer.invoke('edge-vc:create-branch', projectId, name),
  edgeVcDeleteBranch: (projectId: string, branchId: string): Promise<VersionControlResult<null>> =>
    ipcRenderer.invoke('edge-vc:delete-branch', projectId, branchId),
  edgeVcSwitchBranch: (
    projectId: string,
    branchName: string,
    strategy: 'discard' | 'carry',
  ): Promise<VersionControlResult<{ message: string; branch: string }>> =>
    ipcRenderer.invoke('edge-vc:switch-branch', projectId, branchName, strategy),
  edgeVcPreviewSwitchCarry: (
    projectId: string,
    targetBranch: string,
  ): Promise<VersionControlResult<{ conflicts: string[] }>> =>
    ipcRenderer.invoke('edge-vc:preview-switch-carry', projectId, targetBranch),
  edgeVcListCommits: (
    projectId: string,
    options: { limit?: number; offset?: number; branch?: string },
  ): Promise<VersionControlResult<{ commits: Commit[]; total: number; page: number }>> =>
    ipcRenderer.invoke('edge-vc:list-commits', projectId, options),
  edgeVcCreateCommit: (
    projectId: string,
    message: string,
    files?: string[],
    branch?: string,
  ): Promise<VersionControlResult<Commit>> =>
    ipcRenderer.invoke('edge-vc:create-commit', projectId, message, files, branch),
  edgeVcGetCommitFiles: (
    projectId: string,
    hash: string,
    branch?: string,
  ): Promise<VersionControlResult<{ files: CommitFile[]; parentFiles: CommitFile[]; commit: CommitInfo }>> =>
    ipcRenderer.invoke('edge-vc:get-commit-files', projectId, hash, branch),
  edgeVcRestoreCommit: (
    projectId: string,
    hash: string,
    branch?: string,
  ): Promise<VersionControlResult<{ message: string; restoredCommit: Commit }>> =>
    ipcRenderer.invoke('edge-vc:restore-commit', projectId, hash, branch),
  edgeVcGetChanges: (
    projectId: string,
    includeContent?: boolean,
  ): Promise<VersionControlResult<{ changes: PendingChange[]; hasChanges: boolean }>> =>
    ipcRenderer.invoke('edge-vc:get-changes', projectId, includeContent),
  edgeVcDiscardChanges: (projectId: string, files?: string[]): Promise<VersionControlResult<null>> =>
    ipcRenderer.invoke('edge-vc:discard-changes', projectId, files),
  edgeVcListStashes: (projectId: string): Promise<VersionControlResult<{ stashes: Stash[] }>> =>
    ipcRenderer.invoke('edge-vc:list-stashes', projectId),
  edgeVcCreateStash: (
    projectId: string,
    message?: string,
    files?: string[],
  ): Promise<VersionControlResult<{ stash: Stash }>> =>
    ipcRenderer.invoke('edge-vc:create-stash', projectId, message, files),
  edgeVcApplyStash: (projectId: string, ref: string): Promise<VersionControlResult<{ message: string }>> =>
    ipcRenderer.invoke('edge-vc:apply-stash', projectId, ref),
  edgeVcPopStash: (projectId: string, ref: string): Promise<VersionControlResult<{ message: string }>> =>
    ipcRenderer.invoke('edge-vc:pop-stash', projectId, ref),
  edgeVcDropStash: (projectId: string, ref: string): Promise<VersionControlResult<null>> =>
    ipcRenderer.invoke('edge-vc:drop-stash', projectId, ref),
  edgeVcBranchDiffWithBase: (
    projectId: string,
    source: string,
    target: string,
  ): Promise<VersionControlResult<BranchDiffWithBase>> =>
    ipcRenderer.invoke('edge-vc:branch-diff-with-base', projectId, source, target),
  edgeVcMergeBranches: (params: {
    projectId: string
    sourceBranch: string
    targetBranch: string
    commitMessage?: string
    resolutions?: Record<string, string>
  }): Promise<VersionControlResult<MergeResult>> => ipcRenderer.invoke('edge-vc:merge-branches', params),
  onLibrariesChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('libraries:changed', listener)
    return () => ipcRenderer.removeListener('libraries:changed', listener)
  },
  handleQuitApp: () => ipcRenderer.send('app:quit'),
  openExternalLinkAccelerator: (link: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-external-link', link),
  quitAppRequest: (callback: IpcRendererCallbacks) => subscribe('app:quit-accelerator', callback),
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
    subscribe('window-controls:request-close', () => ipcRenderer.send('window-controls:close')),
  hideWindow: () => ipcRenderer.send('window-controls:hide'),
  isMaximizedWindow: (callback: IpcRendererCallbacks) => subscribe('window-controls:toggle-maximized', callback),
  maximizeWindow: () => ipcRenderer.send('window-controls:maximize'),
  minimizeWindow: () => ipcRenderer.send('window-controls:minimize'),
  rebuildMenu: () => ipcRenderer.send('window:rebuild-menu'),
  reloadWindow: () => ipcRenderer.send('window:reload'),
  windowIsClosing: (callback: IpcRendererCallbacks) => subscribe('window-controls:is-closing', callback),

  // ===================== THEME =====================
  handleUpdateTheme: (callback: IpcRendererCallbacks) => subscribe('system:update-theme', callback),
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
  runCompileProgram: (compileProgramArgs: CompileProgramIpcArgs, callback: (args: CompilerPortMessage) => void) => {
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
   *  MessageChannel pattern as `runCompileProgram`; the tuple shape
   *  is `CompileLibraryIpcArgs`, declared next to the adapter that
   *  fills it.  Callback receives a stream of log messages and a
   *  final `libraryBuildResult`. */
  runCompileLibrary: (compileArgs: CompileLibraryIpcArgs, callback: (args: CompilerPortMessage) => void) => {
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
  exportProjectRequest: (callback: IpcRendererCallbacks) => subscribe('compiler:export-project-request', callback),
  generateCFilesRequest: (pathToStProgram: string, callback: (args: CompilerPortMessage) => void) => {
    const { port1: rendererProcessPort, port2: mainProcessPort } = new MessageChannel()
    ipcRenderer.postMessage('compiler:generate-c-files', pathToStProgram, [mainProcessPort])
    rendererProcessPort.onmessage = (event) => callback(event.data as CompilerPortMessage)
    rendererProcessPort.addEventListener('close', () => {})
  },
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
  getAvailableCommunicationPorts: (): Promise<{ address: string; boardName?: string; manufacturer?: string }[]> =>
    ipcRenderer.invoke('hardware:get-available-communication-ports'),
  refreshAvailableBoards: (): Promise<{ board: string; version: string }[]> =>
    ipcRenderer.invoke('hardware:refresh-available-boards'),
  refreshCommunicationPorts: (): Promise<{ address: string; boardName?: string; manufacturer?: string }[]> =>
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
    expectedMd5: string,
  ): Promise<{ success: boolean; match?: boolean; targetMd5?: string; error?: string }> =>
    ipcRenderer.invoke('debugger:verify-md5', expectedMd5),

  /** FC 0x4b run/stop command. Reads come from `onDevicePlcState` (the device
   *  status poll), not from here. */
  debuggerPlcControl: (
    action: 'run' | 'stop',
  ): Promise<{
    success: boolean
    state?: number
    switchPosition?: number
    refusedBySwitch?: boolean
    unsupported?: boolean
    error?: string
  }> => ipcRenderer.invoke('debugger:plc-control', action),

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

  debuggerConnect: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('debugger:connect'),

  debuggerDisconnect: (): Promise<{ success: boolean }> => ipcRenderer.invoke('debugger:disconnect'),

  // Persistent device connection (D72): try the ordered candidates and HOLD the
  // first that answers, returning how the kept channel classified.
  deviceConnect: (
    candidates: DebugConnectionConfig[],
  ): Promise<{
    status: 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'
    error?: string
  }> => ipcRenderer.invoke('device:connect', candidates),

  // Close the held serial link (Disconnect).
  deviceDisconnect: (): Promise<{ success: boolean }> => ipcRenderer.invoke('device:disconnect'),

  // A Runtime v3/v4 session: control over REST at `address`, debug over the channel
  // the board declares (opened later, on the debugger's request).
  openRuntimeSession: (params: {
    address: string
    debug: DebugConnectionConfig
  }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('session:open-runtime', params),

  closeRuntimeSession: (): Promise<{ success: boolean }> => ipcRenderer.invoke('session:close-runtime'),

  // Upload handoff: give up the link ONLY if it is the serial one holding `port`.
  deviceReleaseSerialPort: (port: string | null | undefined): Promise<{ released: boolean }> =>
    ipcRenderer.invoke('device:release-serial-port', port),

  // VPP licensing over the HELD link. `read` is local-only (read + verify) and
  // cheap; `refresh` may reach the network and write, which is why they are
  // separate channels and neither is part of `device:connect`.
  deviceReadLicense: (request: DeviceLicenseRequest): Promise<DeviceLicenseReport> =>
    ipcRenderer.invoke('device:read-license', request),

  deviceRefreshLicense: (request: DeviceLicenseRequest): Promise<DeviceLicenseReport> =>
    ipcRenderer.invoke('device:refresh-license', request),

  // Diagnostic trace of the device connection (candidate attempts, poll verdicts,
  // which connection served each command), mirrored into the editor console so it
  // can be read and copied while reproducing a problem.
  onDeviceLinkLog: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: unknown, message: string) => callback(message)
    ipcRenderer.on('device:link-log', listener)
    return () => ipcRenderer.removeListener('device:link-log', listener)
  },

  // Main pushes live link status here (liveness failure, upload/debug handoff).
  onDeviceConnectionStatus: (callback: (payload: DeviceConnectionStatusPayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: DeviceConnectionStatusPayload) => callback(payload)
    ipcRenderer.on('device:connection-status', listener)
    return () => ipcRenderer.removeListener('device:connection-status', listener)
  },

  /**
   * Subscribe to run/stop state pushed from the held device link. Emitted on
   * every liveness tick (FC 0x46 carries the state), so a switch flipped by hand
   * at the panel surfaces within one interval without any extra traffic.
   */
  onDevicePlcState: (
    callback: (payload: { port: string; plcState?: number; switchPosition?: number }) => void,
  ): (() => void) => {
    const listener = (_event: unknown, payload: { port: string; plcState?: number; switchPosition?: number }) =>
      callback(payload)
    ipcRenderer.on('device:plc-state', listener)
    return () => ipcRenderer.removeListener('device:plc-state', listener)
  },

  // ===================== RUNTIME API METHODS =====================
  runtimeGetUsersInfo: (ipAddress: string): Promise<{ hasUsers: boolean; runtimeVersion?: string; error?: string }> =>
    ipcRenderer.invoke('runtime:get-users-info', ipAddress),
  runtimeCreateUser: (
    ipAddress: string,
    username: string,
    password: string,
    role?: RuntimeUserRole,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('runtime:create-user', ipAddress, username, password, role),
  runtimeListUsers: (ipAddress: string): Promise<ListUsersResult> =>
    ipcRenderer.invoke('runtime:list-users', ipAddress),
  runtimeGetRetainConfig: (ipAddress: string): Promise<RetainConfigResult> =>
    ipcRenderer.invoke('runtime:get-retain-config', ipAddress),
  runtimeUpdateRetainConfig: (ipAddress: string, params: UpdateRetainConfigParams): Promise<RetainConfigResult> =>
    ipcRenderer.invoke('runtime:update-retain-config', ipAddress, params),
  runtimeWhoAmI: (ipAddress: string): Promise<WhoAmIResult> => ipcRenderer.invoke('runtime:whoami', ipAddress),
  runtimeUpdateUser: (
    ipAddress: string,
    userId: number,
    params: UpdateUserParams,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('runtime:update-user', ipAddress, userId, params),
  runtimeDeleteUser: (ipAddress: string, userId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('runtime:delete-user', ipAddress, userId),
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
    /** Run/stop mode-switch position; absent on older runtimes. */
    switchPosition?: 'run' | 'stop'
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
  /**
   * Retrieve the stored project and unpack it to a scratch directory.
   *
   * Returns a path, never the archive: those are untrusted bytes from a device,
   * and every check deciding whether they are safe to write lives beside the
   * write in the main process.
   */
  runtimeRetrieveProject: (
    ipAddress: string,
  ): Promise<{
    success: boolean
    projectPath?: string
    projectName?: string
    metadata?: RuntimeProjectSnapshotMetadata
    libraries?: Array<{ name: string; version: string; status: 'installed' | 'differs' | 'missing' }>
    error?: string
  }> => ipcRenderer.invoke('runtime:retrieve-project', ipAddress),
  /** Install libraries a retrieved project brought with it, by name. */
  runtimeInstallRetrievedLibraries: (
    projectPath: string,
    names: string[],
  ): Promise<{ success: boolean; installed: string[]; failed: Array<{ name: string; error: string }> }> =>
    ipcRenderer.invoke('runtime:install-retrieved-libraries', projectPath, names),
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
