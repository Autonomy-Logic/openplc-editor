/** Feature toggles the shared UI uses to branch on platform (editor vs web) instead of platform detection. */

export interface PlatformCapabilities {
  /** True if the app is a native desktop application (Electron editor). */
  isNativeApplication: boolean

  /** True if the app supports native file dialogs (open, save, pick directory). */
  hasNativeFileDialogs: boolean

  /** True if the app requires user authentication to access the workspace. */
  hasAuthentication: boolean

  /** Whether the Edge account UI belongs in this build. Distinct from `hasAuthentication`: autonomy-node authenticates against its own API, not Edge's. */
  hasEdgeAccount: boolean
  /** The build is UNUSABLE without an Edge account, so the sign-in dialog is forced open. The editor is not: it works offline on local projects. */
  requiresEdgeAccount: boolean

  /** True if the app can detect local serial/communication ports. */
  hasLocalSerialPorts: boolean

  /** True if the app supports orchestrator-managed devices (cloud device fleet). */
  hasOrchestratorDevices: boolean

  /** True if the app supports WebRTC connections to runtime devices. */
  hasWebRTC: boolean

  /** True if the simulator runs in the same process (web: in-browser, editor: main process). */
  hasInProcessSimulator: boolean

  /** True if the app supports a local filesystem project structure (directories, files). */
  hasLocalFilesystem: boolean

  /** True if the app supports exporting projects as XML files (Codesys, old-editor formats). */
  hasProjectExport: boolean

  /** True if the app supports importing a project from a PLCopen XML file. */
  hasProjectImport: boolean

  /** True if the app supports version control (branches, commits, change tracking). */
  hasVersionControl: boolean
  /** Separate from `hasVersionControl`: a build can have one without the other. */
  hasBranchMerge: boolean

  /** True if the app supports the "About" dialog. */
  hasAboutDialog: boolean

  /** True if the app has a Python LSP (language server protocol) for code completion. */
  hasPythonLSP: boolean

  /** While false, ST Monaco editors fall back to plain text — no autocomplete, no diagnostics. */
  hasStLSP: boolean

  /** True if the app supports undo/redo history tracking. */
  hasUndoRedoHistory: boolean

  /** True if the app can watch files for external changes. */
  hasFileWatcher: boolean

  /** True if the app has AI-assisted coding (inline completions, chat panel, telemetry). */
  hasAIAssistant: boolean

  /** True if the runtime connection goes through an orchestrator/agent proxy. */
  hasProxiedRuntimeConnection: boolean

  hasDirectProgramUpload: boolean

  /** True if the app supports installing/managing VPP board packages. */
  hasPackageManager: boolean

  /** True if the app supports EtherCAT device configuration and ESI repository. */
  hasEthercat: boolean

  /** Polling interval in milliseconds for the debugger's HTTP fallback transport. */
  debugRelayPollIntervalMs: number

  /** True when running in a development build (Vite DEV / webpack development mode). */
  isDevMode: boolean
}

export const EDITOR_CAPABILITIES: PlatformCapabilities = {
  isNativeApplication: true,
  hasNativeFileDialogs: true,
  hasAuthentication: false,
  hasEdgeAccount: true,
  requiresEdgeAccount: false,
  hasLocalSerialPorts: true,
  hasOrchestratorDevices: false,
  hasWebRTC: false,
  hasInProcessSimulator: true,
  hasLocalFilesystem: true,
  hasProjectExport: true,
  hasProjectImport: true,
  // On for cloud projects only; see `isRemoteProjectPath`.
  hasVersionControl: true,
  hasBranchMerge: true,
  hasAboutDialog: true,
  hasPythonLSP: true,
  hasStLSP: true,
  hasUndoRedoHistory: true,
  hasFileWatcher: true,
  hasAIAssistant: true,
  hasProxiedRuntimeConnection: false,
  hasDirectProgramUpload: false,
  hasPackageManager: true,
  hasEthercat: true,
  debugRelayPollIntervalMs: 1000,
  isDevMode: false,
}

export const WEB_CAPABILITIES: PlatformCapabilities = {
  isNativeApplication: false,
  hasNativeFileDialogs: false,
  hasAuthentication: true,
  // Default for the web build; autonomy-node turns this off via env.
  hasEdgeAccount: true,
  requiresEdgeAccount: true,
  hasLocalSerialPorts: false,
  hasOrchestratorDevices: true,
  hasWebRTC: true,
  hasInProcessSimulator: true,
  hasLocalFilesystem: false,
  hasProjectExport: true,
  hasProjectImport: true,
  hasVersionControl: true,
  hasBranchMerge: true,
  hasAboutDialog: true,
  hasPythonLSP: true,
  // Web only compiles to Runtime v4 (matiec/iec2c is Electron-only), so the LSP is always right here.
  hasStLSP: true,
  hasUndoRedoHistory: false,
  hasFileWatcher: false,
  hasAIAssistant: true,
  hasProxiedRuntimeConnection: true,
  hasDirectProgramUpload: true,
  hasPackageManager: false,
  hasEthercat: false,
  debugRelayPollIntervalMs: 1000,
  isDevMode: false,
}
