/**
 * Thin platform-bridge for the shared compile pipeline.
 *
 * The shared compile pipeline orchestrator (`backend/shared/compile/
 * pipeline.ts`) drives the full editor-canonical build flow — ST
 * transpile, strucpp compile, conf authoring, defines authoring,
 * firmware-bundle composition, arduino-cli invocation, runtime
 * upload.  ST transpilation runs in-process on both platforms (the
 * shared `st-transpiler/`); the only places that genuinely depend on
 * the platform are:
 *
 *  1. `arduino-cli` compile — editor spawns arduino-cli, web POSTs
 *     to the centralised compiler-service backend (which spawns it
 *     server-side).
 *  2. Runtime upload — editor HTTPS-POSTs to the device's
 *     `/api/upload`, web pipes through the orchestrator
 *     (WebRTC data channel with HTTP fallback).
 *
 * Plus the supporting Arduino-CLI lifecycle calls on editor that
 * the web platform's pre-provisioned compiler image makes redundant:
 * `installArduinoCore` and `installArduinoLib` are no-ops on web.
 *
 * Each method on this port takes the same canonical arguments
 * regardless of platform and returns the same canonical result
 * shape.  The pipeline orchestrator is fully platform-agnostic —
 * it never knows whether it's running in Electron's main process
 * or a browser tab.  Each platform's adapter implements this port
 * once and wires it into its `compiler-adapter.ts`.
 *
 * Editor-canonical contract: web's no-op implementations of
 * `installArduinoCore` / `installArduinoLib` / `uploadArduinoBoard`
 * / `uploadRuntimeV3` MUST resolve to `{ ok: true }` so the
 * pipeline's ordering and downstream steps run identically on both
 * platforms.  Web simply skips work that's already handled
 * server-side, but the pipeline never knows.
 */

import type { PLCProjectData, StructuredCompileError } from './types'

/**
 * Canonical progress callback the pipeline passes to every port
 * method.  Wraps both informational progress and error logging
 * through one channel — adapters translate to their native log
 * shape (editor: `_mainProcessPort.postMessage`; web:
 * `onProgress({ stage, message, level, ... })`).
 *
 * `level: 'error'` carries diagnostic text for the user; the actual
 * compile-error STRUCTURE travels in `errors[]` on the method's
 * return value, where the renderer's navigation can key off it.
 */
export type PlatformLog = (message: string, level: 'info' | 'warning' | 'error') => void

/**
 * Discriminated device-context shape.  Each adapter picks the
 * variant that matches its transport.  The pipeline never inspects
 * the contents — it just forwards `context` through to the upload
 * methods.
 */
export type PlatformDeviceContext =
  | {
      /** Editor: direct HTTPS to the device.  `ip` is the device's
       *  reachable IP from the desktop; `jwt` is the auth token the
       *  user obtained via the desktop login flow. */
      kind: 'editor-https'
      ip: string
      jwt: string
    }
  | {
      /** Web: bundle is piped through the orchestrator agent that
       *  fronts the device.  `agentId` identifies the orchestrator
       *  agent; `sessionId` (when present) carries a WebRTC session
       *  the adapter can attach to; otherwise the adapter falls
       *  back to the orchestrator's HTTP proxy. */
      kind: 'web-orchestrator'
      agentId: string
      sessionId?: string
    }

// ---------------------------------------------------------------------------
// Per-method I/O contracts
// ---------------------------------------------------------------------------

/**
 * Input to the in-process JSON → ST transpiler.  Each adapter
 * projects this into the transpiler's `TranspileProject` IR with
 * its own helper — editor: `fromSchemaShape` (IPC schema-shape);
 * web: `fromPortShape` after a port→schema conversion at the
 * adapter boundary.  Transpilation runs in-process against the
 * JSON IR on both platforms.
 *
 * The declared type is port-shape because that's the renderer
 * store's shape; pipeline callers that hold schema-shape data
 * cast through `never` at the call site (see `pipeline.ts` Step 1
 * and `library-build-orchestrator.ts` Stage 2). */
export interface TranspileToStArgs {
  projectData: PLCProjectData
}

export interface TranspileToStResult {
  ok: boolean
  /** ST source emitted by the JSON transpiler when transpilation
   *  succeeded.  Empty / undefined on failure. */
  programSt?: string
  /** Structured diagnostics from the transpiler.  Forwarded to the
   *  pipeline caller via `errors[]` on `CompileResult`. */
  errors?: StructuredCompileError[]
  /** Same shape as `errors[]` but for non-fatal warnings. */
  warnings?: StructuredCompileError[]
}

/** Arduino compile input: the full source tree as a file map plus
 *  the argv arduino-cli should be invoked with.  Both already shared
 *  (`composeFirmwareBundle` produces `files`,
 *  `buildArduinoCliCompileArgs` produces `argv`). */
export interface CompileArduinoArgs {
  /** Project-root-relative path → file content.  Includes
   *  `examples/Baremetal/Baremetal.ino`, `src/generated.cpp`,
   *  `src/c_blocks.h`, `examples/Baremetal/c_blocks_code.cpp`,
   *  `src/defines.h`, and the bundled firmware skeleton + strucpp
   *  runtime headers.  On editor: written to disk before
   *  arduino-cli runs.  On web: POSTed in the request body. */
  files: Record<string, string>
  /** Argv suffix for arduino-cli compile (after the `compile`
   *  subcommand).  Comes from the shared `buildArduinoCliCompileArgs`
   *  helper. */
  argv: string[]
  /** When `false`, arduino-cli is invoked with `--jobs 1` (web
   *  default — backend runs many clients in sandboxes, so saturating
   *  cores would starve concurrents).  When `true`, arduino-cli
   *  defaults to `--jobs 0` (editor default — uses every core). */
  parallel: boolean
}

export interface CompileArduinoResult {
  ok: boolean
  /** Compiled firmware bytes (`.hex` for AVR).  Editor: read from
   *  the build output directory.  Web: base64-decoded from the
   *  server response.  Caller decides whether to write to disk
   *  (editor: stores the path; web: holds in memory and hands to
   *  the simulator). */
  binary?: Uint8Array
  errors?: StructuredCompileError[]
}

/** Runtime v4 upload: the full v4 bundle file map (output of
 *  `composeRuntimeV4Bundle`).  Both platforms send the same bytes
 *  to the runtime — the difference is just the transport. */
export interface UploadRuntimeV4Args {
  /** File map the runtime extracts on the device.  Already
   *  composed by `composeRuntimeV4Bundle`; the pipeline passes it
   *  straight through. */
  bundle: Record<string, string>
  /** Discriminated device context; see `PlatformDeviceContext`. */
  context: PlatformDeviceContext
  /**
   * Whether this runtime stores the source project sent beside a program, as
   * declared at `GET /api/capabilities` and read by the pre-upload version
   * check.
   *
   * `false` means do not build one: a runtime that does not support snapshots
   * discards the extra parts silently, so sending one costs the user upload
   * time for an archive that is thrown away, and leaves them a device they
   * cannot retrieve from with nothing said about why.
   */
  supportsProjectSnapshot: boolean
}

export interface UploadResult {
  ok: boolean
  errors?: StructuredCompileError[]
}

/** Arduino direct-upload (editor-only, used for non-simulator
 *  Arduino targets).  Web's adapter MUST no-op this with
 *  `{ ok: true }` — web only targets the simulator (avr8js, no
 *  device upload step) or runtime v4 (handled separately). */
export interface UploadArduinoBoardArgs {
  /** Path arduino-cli reads the compiled artefacts from.  Editor:
   *  the build output dir.  Web: ignored (no-op). */
  compilationPath: string
  /** Fully-qualified Arduino board name (e.g. `arduino:avr:mega`). */
  fqbn: string
  /** Serial port for upload (e.g. `/dev/cu.usbmodem1101`).  Editor
   *  resolves; web's adapter receives but ignores. */
  port: string
}

/** Runtime v3 upload (legacy, editor-only).  Web's adapter MUST
 *  no-op this with `{ ok: true }` — v3 is end-of-life and the web
 *  frontend never offers v3 as a target. */
export interface UploadRuntimeV3Args {
  /** Concatenated `program.st` content with embedded C-blocks
   *  (output of `embedCBlocksInProgramSt`).  Editor sends to the
   *  device's v3 `/api/upload`. */
  programSt: string
  context: PlatformDeviceContext
}

/** Arduino-CLI core install (editor-only.  Web's adapter MUST
 *  no-op with `{ ok: true }` — web's compiler-service backend
 *  ships with every core preinstalled). */
export interface InstallArduinoCoreArgs {
  /** Core identifier (e.g. `arduino:avr`).  Editor invokes
   *  `arduino-cli core install <id>`. */
  coreId: string
  /** Optional exact core version (e.g. `1.8.8`).  When set, the editor runs
   *  `core install <id>@<version>`, which installs exactly that version and
   *  fails if it is unavailable — required for prebuilt arduino-hal boards
   *  whose precompiled `.a` is ABI-locked to that core version. */
  coreVersion?: string
  /** Optional third-party board-manager index URL (e.g. a vendor's
   *  `package_<vendor>_index.json`).  Sourced from the VPP manifest's
   *  `target.boardManagerUrl` (or `board_manager_url` in hals.json) and
   *  forwarded to arduino-cli as `--additional-urls`.
   *
   *  Cores outside arduino-cli's built-in index are invisible without it:
   *  `core install industrialshields:esp32` fails with "Platform not found"
   *  unless the vendor index is supplied AND `core update-index` has been
   *  run against it.  The editor does both; web ignores this field. */
  boardManagerUrl?: string
}

/** Arduino-CLI library install (editor-only.  Same no-op
 *  contract as core install for web). */
export interface InstallArduinoLibArgs {
  /** Legacy single-library id (kept for the placeholder call sites
   *  that pre-date `extraLibraries`).  Empty string when the caller
   *  is driving the install entirely from `extraLibraries`. */
  libId: string
  /** Per-board library list.  Sourced from the selected board's
   *  `hals.json` `extra_libraries` (static boards) or its VPP
   *  manifest `hal.extraArduinoLibraries` (VPP boards) — both feed
   *  the same `BoardBuildInfo.extraArduinoLibraries` field.  The
   *  editor adapter installs each name via `arduino-cli lib install`;
   *  web no-ops (its compile-service backend pre-installs every lib).
   *
   *  A library declared here that arduino-cli can't resolve MUST
   *  fail the install so the build aborts before generating a sketch
   *  that won't link.  Per-device libs are the source of truth: if
   *  the Opta package declares `Arduino_Opta_Blueprint` and
   *  arduino-cli can't find it, the user needs to know now, not
   *  during the arduino-cli compile step. */
  extraLibraries?: string[]
}

/** Runtime-version probe (used for the v4 strucpp-compatibility
 *  gate that aborts uploads to a pre-4.1.0 runtime).  Editor: GETs
 *  the device's unauthenticated `/api/version`.  Web: queries the
 *  orchestrator's device-info endpoint. */
export interface CheckRuntimeVersionArgs {
  context: PlatformDeviceContext
}

export interface CheckRuntimeVersionResult {
  ok: boolean
  /** Reported version string (semver-ish; e.g. `'4.1.0'`).  `null`
   *  when the runtime is unreachable or doesn't expose the
   *  endpoint (very old v3 runtimes). */
  version: string | null
  /**
   * Whether this runtime stores the source project an upload carries, from
   * `projectSnapshot` at `GET /api/capabilities`. `false` for every runtime
   * predating the feature or the endpoint, which is the honest default: one
   * that stores snapshots says so.
   */
  supportsProjectSnapshot: boolean
  /**
   * Oldest editor this runtime accepts programs from, declared at
   * `GET /api/capabilities` (DOPE-448).  `null` means the runtime
   * declares no floor — it predates the endpoint, or this platform
   * has no transport for it.
   *
   * `null` is "no constraint", never "too old": every runtime
   * currently deployed answers `null`, and the runtime only
   * advertises this value — the editor is what compares and refuses.
   */
  minEditorVersion?: string | null
}

/** VPP (Vendor Plugin Package) runtime-v4 packaging.  Boards that
 *  come from an installed `.vpp` package ship a vendor I/O driver
 *  alongside the program — the driver's source files, a generated
 *  plugin config JSON, and `vpp_plugins.conf` (which enables the
 *  driver) must land in the v4 upload bundle so the runtime's
 *  `compile.sh` builds the driver and `apply_vpp_plugin_conf()`
 *  loads it.  Without this step the program uploads but the device
 *  runs as a generic runtime with no physical I/O. */
export interface PackageVppPluginArgs {
  /** Selected board name, looked up against installed VPP packages. */
  boardTarget: string
}

export interface PackageVppPluginResult {
  /** Extra files to merge into the runtime-v4 upload bundle.  Keys
   *  are paths relative to the bundle root (matching
   *  `composeRuntimeV4Bundle`'s convention).  Empty record means
   *  the board isn't a VPP board, the package lacks the necessary
   *  HAL metadata, or VPP integration is skipped on this platform —
   *  in any of those cases the pipeline proceeds with the unchanged
   *  bundle.  Errors that should abort the upload are reported via
   *  `errors[]`; soft skips emit log lines via the `log` callback
   *  and return an empty record without errors. */
  files: Record<string, string>
  errors?: StructuredCompileError[]
  /**
   * `package.minRuntimeVersion` from the manifest of the VPP this
   * board came from (DOPE-448) — the oldest runtime whose plugin API
   * the package's HAL was built against.
   *
   * `null`/absent for non-VPP boards, for packages that declare no
   * floor, and on platforms without VPP integration. The pipeline
   * compares it against the connected runtime's reported version
   * right after the version probe, which is the earliest point where
   * both halves are known — a VPP plugin is built against a runtime
   * API, so an older runtime loads it and fails at scan time, on a
   * live PLC.
   *
   * This cannot be enforced at install time: the target device is
   * unknown until the user connects to one.
   */
  minRuntimeVersion?: string | null
}

// ---------------------------------------------------------------------------
// The port itself
// ---------------------------------------------------------------------------

/**
 * Every method takes a `log` callback so the pipeline orchestrator
 * can stream progress events through the same channel regardless of
 * platform.  The adapters are responsible for translating
 * `PlatformLog` calls to their native log shape (editor:
 * `_mainProcessPort.postMessage`; web: `onProgress({ stage, ... })`).
 *
 * Method return values carry the canonical `CompileError[]` shape so
 * the pipeline can decide what to surface to the user — the log
 * channel is for progress + diagnostic text, the return value's
 * `errors[]` is for structured navigation-ready diagnostics.
 *
 * Every method is asynchronous because at least one platform
 * implementation has to wait on a subprocess or HTTP round-trip.
 */
export interface CompilerPlatformPort {
  /** Compute the MD5 hex digest of an arbitrary string.  Editor:
   *  Node's `crypto.createHash('md5')`.  Web: `spark-md5` (already
   *  a web dep).  Both produce byte-identical output.  The pipeline
   *  uses this to compute `program.st`'s MD5 — embedded in
   *  `defines.h` as `PROGRAM_MD5` for the v4 runtime's stale-program
   *  detection.  Kept in the port (rather than hardcoding either
   *  library in shared code) so the shared module ships without a
   *  hash-impl dependency. */
  computeMd5(input: string): Promise<string>

  /** Step 3 of the editor pipeline.  Transpile project IR to ST. */
  transpileToSt(args: TranspileToStArgs, log: PlatformLog): Promise<TranspileToStResult>

  /** Step 5 of the editor pipeline.  Arduino-CLI core install.
   *  Web returns `{ ok: true }` immediately. */
  installArduinoCore(args: InstallArduinoCoreArgs, log: PlatformLog): Promise<UploadResult>

  /** Step 9 of the editor pipeline.  Arduino-CLI library install.
   *  Web returns `{ ok: true }` immediately. */
  installArduinoLib(args: InstallArduinoLibArgs, log: PlatformLog): Promise<UploadResult>

  /** Step 12 of the editor pipeline.  Arduino-CLI compile. */
  compileArduino(args: CompileArduinoArgs, log: PlatformLog): Promise<CompileArduinoResult>

  /** Step 13a of the editor pipeline (runtime v4 path).  Upload
   *  the strucpp bundle. */
  uploadRuntimeV4(args: UploadRuntimeV4Args, log: PlatformLog): Promise<UploadResult>

  /** Step 13b of the editor pipeline (Arduino direct path).
   *  Web no-ops. */
  uploadArduinoBoard(args: UploadArduinoBoardArgs, log: PlatformLog): Promise<UploadResult>

  /** Step 13c of the editor pipeline (runtime v3 path).
   *  Web no-ops. */
  uploadRuntimeV3(args: UploadRuntimeV3Args, log: PlatformLog): Promise<UploadResult>

  /** Pre-upload gate for runtime v4.  Used to short-circuit
   *  uploads to incompatible (pre-4.1.0) runtimes. */
  checkRuntimeVersion(args: CheckRuntimeVersionArgs, log: PlatformLog): Promise<CheckRuntimeVersionResult>

  /** Runtime-v4 VPP plugin packaging.  Returns the extra files to
   *  merge into the v4 upload bundle when the selected board comes
   *  from an installed VPP package (driver source, plugin config,
   *  `vpp_plugins.conf`, checksum).  Returns `{ files: {} }` for
   *  non-VPP boards or when VPP integration is unavailable on this
   *  platform (web defaults to this until its adapter wires up
   *  remote VPP packages).  The pipeline calls this between
   *  `composeRuntimeV4Bundle` and `uploadRuntimeV4`. */
  packageVppPlugin(args: PackageVppPluginArgs, log: PlatformLog): Promise<PackageVppPluginResult>

  /**
   * Persist a composed runtime-v4 bundle to the platform's build location.
   *
   * Split out of `uploadRuntimeV4`, which used to be the only thing that wrote
   * the bundle anywhere. That made `compileOnly` produce almost nothing on disk
   * for a v4 target: the bundle is composed in memory, and the compile-only path
   * returned before the upload that happened to materialise it. A build folder
   * left holding only the VPP files (which `packageVppPlugin` writes directly)
   * looked plausible enough to be mistaken for a complete build — and stale
   * files from an earlier upload made it look complete outright.
   *
   * Called for every v4 compile, upload or not, so `compile` and `upload` leave
   * byte-identical artifacts.
   *
   * Optional: a platform with no project build directory can omit it, and the
   * pipeline simply skips the write.
   */
  materializeRuntimeV4Bundle?(
    args: MaterializeRuntimeV4BundleArgs,
    log: PlatformLog,
  ): Promise<MaterializeRuntimeV4BundleResult>
}

export interface MaterializeRuntimeV4BundleArgs {
  /** Path → file content, as composed by `composeRuntimeV4Bundle`. */
  bundle: Record<string, string>
}

export interface MaterializeRuntimeV4BundleResult {
  /** Number of files written, for the progress line. */
  written: number
  errors?: StructuredCompileError[]
}
