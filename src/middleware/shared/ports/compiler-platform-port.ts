/**
 * Thin platform-bridge for the shared compile pipeline.
 *
 * The shared compile pipeline orchestrator (`backend/shared/compile/
 * pipeline.ts`) drives the full editor-canonical build flow — XML
 * generation, ST transpile, strucpp compile, conf authoring, defines
 * authoring, firmware-bundle composition, arduino-cli invocation,
 * runtime upload.  Every step is shared and pure EXCEPT for three
 * places that genuinely depend on the platform:
 *
 *  1. `xml2st` transpile — editor spawns the bundled binary,
 *     web HTTP-POSTs to the centralised compiler-service backend.
 *  2. `arduino-cli` compile — editor spawns arduino-cli, web POSTs
 *     to the same backend (which spawns it server-side).
 *  3. Runtime upload — editor HTTPS-POSTs to the device's
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

/** `xml2st` input: a single XML string (the IEC 61131-3 PLC XML the
 *  shared `XmlGenerator` produces) plus an array of extra CLI tokens
 *  to append to the xml2st invocation.  Defined here (not on either
 *  adapter) because xml2st flag drift was the root cause of the
 *  initial cross-platform STRUCT bug — editor's local xml2st passed
 *  `--keep-structs` but the web's compile-service `/generate-st`
 *  endpoint hardcoded an unflagged invocation, so structs declared
 *  in the project compiled fine on the desktop and blew up on the
 *  web with `Undefined type 'MY_STRUCT'` errors out of strucpp.
 *  Pushing the flag set into a single shared field means any future
 *  xml2st option is a one-line pipeline change with no per-platform
 *  drift possible.
 *
 *  Editor's adapter passes `xml2stArgs` verbatim to the local
 *  binary (trusted).  Web's adapter filters against its own
 *  known-args allowlist before forwarding to the compile-service
 *  `/generate-st` endpoint, logging a warning for anything it
 *  doesn't recognise (defence in depth — service has its own
 *  allowlist too). */
/**
 * Input to the in-process JSON → ST transpiler.  Each adapter
 * projects this into the transpiler's `TranspileProject` IR with
 * its own helper — editor: `fromSchemaShape` (IPC schema-shape);
 * web: `fromPortShape` after a port→schema conversion at the
 * adapter boundary.  Replaces the legacy XML-fed surface that
 * routed through a bundled `xml2st` binary; transpilation now
 * runs in-process against the JSON IR.
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
}
