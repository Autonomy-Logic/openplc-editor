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

  /** True if the app is a native desktop application (Electron editor). */
  isNativeApplication: boolean

  /** True if the app supports native file dialogs (open, save, pick directory). */
  hasNativeFileDialogs: boolean

  // --- Authentication ---

  /** True if the app requires user authentication to access the workspace. */
  hasAuthentication: boolean

  /**
   * True if the Edge account UI belongs in this build — the profile menu in the
   * title bar and the sign-in gate, both talking to the Edge API.
   *
   * Distinct from {@link hasAuthentication} on purpose. The autonomy-node build
   * shares WEB_CAPABILITIES and is also authenticated, but its API is node's own,
   * not Edge's: showing Edge's account UI there would offer a sign-in that cannot
   * work. Gate the account UI on THIS flag, never on `hasAuthentication`.
   */
  hasEdgeAccount: boolean
  /**
   * Whether the build is UNUSABLE without an Edge account.
   *
   * Distinct from `hasEdgeAccount`, and the distinction is load-bearing. The web
   * editor reaches a project only through Edge's API, so a visitor who is not signed
   * in has nothing to look at and the sign-in dialog opens on its own. The desktop
   * editor opens local projects from disk and works offline: an account is how you
   * reach CLOUD projects, and forcing a dialog on someone editing a local file would
   * block an editor that needs nothing from Edge at all.
   *
   * Both builds show the same account control in the same place. This only decides
   * whether the sign-in dialog opens by itself or when the user asks for it.
   */
  requiresEdgeAccount: boolean

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

  /** True if the app supports importing a project from a PLCopen XML file. */
  hasProjectImport: boolean

  /** True if the app supports version control (branches, commits, change tracking). */
  hasVersionControl: boolean

  /** True if the app supports the "About" dialog. */
  hasAboutDialog: boolean

  // --- Editor Features ---

  /** True if the app has a Python LSP (language server protocol) for code completion. */
  hasPythonLSP: boolean

  /**
   * True if the app hosts the STruC++ language server for Structured
   * Text (`.st`) editors.  Both the Electron and web builds will
   * eventually flip this on as their host-side wiring lands; while
   * the flag is false, ST Monaco editors fall back to plain text
   * (no autocomplete, no diagnostics) — there is no hand-written
   * legacy provider any more.
   */
  hasStLSP: boolean

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

  // --- Packages ---

  /** True if the app supports installing/managing VPP board packages. */
  hasPackageManager: boolean

  // --- EtherCAT ---

  /** True if the app supports EtherCAT device configuration and ESI repository. */
  hasEthercat: boolean

  // --- Debugging ---

  /**
   * Polling interval (ms) for the debugger's HTTP fallback transport (used
   * when WebRTC is unavailable). Each poll is a full proxied round-trip, so
   * this is deployment-tunable rather than a fixed constant — e.g.
   * autonomy-node runs no WebRTC signaling relay and wants this to match
   * its general-purpose poll rate.
   */
  debugRelayPollIntervalMs: number

  // --- Environment ---

  /** True when running in a development build (Vite DEV / webpack development mode). */
  isDevMode: boolean
}

// ---------------------------------------------------------------------------
// Default capability profiles
// ---------------------------------------------------------------------------

export const EDITOR_CAPABILITIES: PlatformCapabilities = {
  isNativeApplication: true,
  hasNativeFileDialogs: true,
  hasAuthentication: false,
  // The desktop editor has an Edge account, for cloud projects...
  hasEdgeAccount: true,
  // ...but never demands one: local projects and offline work need no sign-in.
  requiresEdgeAccount: false,
  hasLocalSerialPorts: true,
  hasOrchestratorDevices: false,
  hasWebRTC: false,
  hasInProcessSimulator: true,
  hasLocalFilesystem: true,
  hasProjectExport: true,
  hasProjectImport: true,
  // On for cloud projects only, which the shared gate enforces by asking whether the
  // open project lives on Edge. The repository sits beside the project on the server,
  // so a project opened from disk has no history to show — see `isRemoteProjectPath`.
  hasVersionControl: true,
  hasAboutDialog: true,
  hasPythonLSP: true,
  // Worker wired via src/frontend/services/st-lsp/boot.ts, started
  // from App.tsx at module load.  Web build keeps this off until
  // their HTTP-backed stlibSource adapter ships.
  hasStLSP: true,
  hasUndoRedoHistory: true,
  hasFileWatcher: true,
  hasAIAssistant: false,
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
  // Default for the web build; the autonomy-node build turns this off via env.
  hasEdgeAccount: true,
  // The web editor reaches a project only through Edge's API, so without a session
  // there is nothing to show and the dialog opens on its own.
  requiresEdgeAccount: true,
  hasLocalSerialPorts: false,
  hasOrchestratorDevices: true,
  hasWebRTC: true,
  hasInProcessSimulator: true,
  hasLocalFilesystem: false,
  // Browser-download implementation makes export just as viable on web
  // as on desktop — no reason to keep this gated off.
  hasProjectExport: true,
  hasProjectImport: true,
  hasVersionControl: true,
  hasAboutDialog: true,
  // `monaco-pyright-lsp` ships its own ESM worker via
  // `new Worker(new URL('./worker.js', import.meta.url))` which Vite
  // resolves to an emitted chunk at build time — no `MonacoEnvironment`
  // worker-URL handoff required (unlike STruC++, which we pre-warm
  // through `bootStLsp` with a `?url` import).  Pyright bundle is
  // ~MB-scale; web users editing Python POUs pay the load once on the
  // first Python file open since the import is at module-evaluation
  // time in the body Monaco editor.  Lazy-loading is a follow-up
  // optimisation if first-paint cost becomes a real concern.
  hasPythonLSP: true,
  // The STruC++ worker bundle runs in any modern browser; web's
  // stlib-source adapter (HTTP-backed, mirror of editor's IPC-backed
  // one) lands alongside the library port and lets `bootStLsp`
  // populate the worker with the user's enabled archives.  Web only
  // compiles to Runtime v4 targets — the matiec / iec2c flow is
  // Electron-only — so there's no scenario where the LSP isn't the
  // right tool for ST tooling on web.
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
