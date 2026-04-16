/**
 * PlatformCapabilities — Feature toggles for platform-specific UI behavior.
 *
 * The shared UI uses these flags to conditionally render or enable features
 * that differ between the Electron editor and the web application.
 * This replaces branching on platform detection and keeps the UI code clean.
 *
 * Each adapter provides its own PlatformCapabilities instance:
 *   - Editor: native window controls, local filesystem, no auth, etc.
 *   - Web: browser-based, cloud auth, WebRTC, orchestrator management, etc.
 */

export interface PlatformCapabilities {
  // --- Window & Chrome ---

  /** True if the app has native window controls (minimize, maximize, close buttons in title bar). */
  hasNativeWindowControls: boolean

  /** True if the app has a native application menu (Electron menu bar). */
  hasNativeMenu: boolean

  /** True if the app supports native file dialogs (open, save, pick directory). */
  hasNativeFileDialogs: boolean

  // --- Authentication ---

  /** True if the app requires user authentication to access the workspace. */
  hasAuthentication: boolean

  // --- Device & Hardware ---

  /** True if the app can detect local serial/communication ports. */
  hasLocalSerialPorts: boolean

  /** True if the app supports orchestrator-managed devices (cloud device fleet). */
  hasOrchestratorDevices: boolean

  /** True if the app supports WebRTC connections to runtime devices. */
  hasWebRTC: boolean

  // --- Simulator ---

  /** True if the simulator runs in the same process (web: in-browser, editor: main process). */
  hasInProcessSimulator: boolean

  // --- Project Management ---

  /** True if the app supports a local filesystem project structure (directories, files). */
  hasLocalFilesystem: boolean

  /** True if the app supports exporting projects as XML files (Codesys, old-editor formats). */
  hasProjectExport: boolean

  /** True if the app supports the "About" dialog. */
  hasAboutDialog: boolean

  // --- Editor Features ---

  /** True if the app has a Python LSP (language server protocol) for code completion. */
  hasPythonLSP: boolean

  /** True if the app supports undo/redo history tracking. */
  hasUndoRedoHistory: boolean

  /** True if the app can watch files for external changes. */
  hasFileWatcher: boolean

  // --- AI Features ---

  /** True if the app has AI-assisted coding (inline completions, chat panel, telemetry). */
  hasAIAssistant: boolean

  // --- Runtime Connection ---

  /** True if the runtime connection goes through an orchestrator/agent proxy. */
  hasProxiedRuntimeConnection: boolean

  /**
   * True if the app can upload compiled programs directly to the runtime.
   * Web: uploads zip via API. Editor: runtime compiles from uploaded source.
   */
  hasDirectProgramUpload: boolean
}

// ---------------------------------------------------------------------------
// Default capability profiles
// ---------------------------------------------------------------------------

export const EDITOR_CAPABILITIES: PlatformCapabilities = {
  hasNativeWindowControls: true,
  hasNativeMenu: true,
  hasNativeFileDialogs: true,
  hasAuthentication: false,
  hasLocalSerialPorts: true,
  hasOrchestratorDevices: false,
  hasWebRTC: false,
  hasInProcessSimulator: true,
  hasLocalFilesystem: true,
  hasProjectExport: true,
  hasAboutDialog: true,
  hasPythonLSP: true,
  hasUndoRedoHistory: true,
  hasFileWatcher: true,
  hasAIAssistant: false,
  hasProxiedRuntimeConnection: false,
  hasDirectProgramUpload: false,
}

export const WEB_CAPABILITIES: PlatformCapabilities = {
  hasNativeWindowControls: false,
  hasNativeMenu: false,
  hasNativeFileDialogs: false,
  hasAuthentication: true,
  hasLocalSerialPorts: false,
  hasOrchestratorDevices: true,
  hasWebRTC: true,
  hasInProcessSimulator: true,
  hasLocalFilesystem: false,
  hasProjectExport: false,
  hasAboutDialog: false,
  hasPythonLSP: false,
  hasUndoRedoHistory: false,
  hasFileWatcher: false,
  hasAIAssistant: true,
  hasProxiedRuntimeConnection: true,
  hasDirectProgramUpload: true,
}
