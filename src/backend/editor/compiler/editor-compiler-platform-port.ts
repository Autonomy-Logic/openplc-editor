/**
 * Editor-side implementation of `CompilerPlatformPort`.
 *
 * Wraps the existing editor handlers (`handleCompileArduinoProgram`,
 * etc.) so the shared compile pipeline
 * (`backend/shared/compile/pipeline.ts`) can drive editor's compile
 * flow through the canonical platform-port contract.
 *
 * Each port method is a thin shim:
 *   - Receives the port's canonical args (an in-memory file map,
 *     pre-rendered argv, etc.)
 *   - Resolves whatever filesystem paths the editor's handler
 *     expects (the handlers were written before the port abstraction
 *     existed and assume on-disk layouts)
 *   - Calls the existing handler
 *   - Translates the handler's return value back into the port's
 *     canonical result shape
 *
 * `transpileToSt` selects between two backends at runtime via
 * `isNewTranspilerEnabled()` (env: `OPENPLC_USE_NEW_TRANSPILER`):
 * the in-process JSON-fed transpiler
 * (`backend/shared/transpilers/st-transpiler/`) when the flag is on,
 * or the bundled `xml2st` subprocess (default) — serialising the
 * project IR via `XmlGenerator` and running it through
 * `handleTranspileXMLtoST` on disk, the same way the editor handled
 * compilation before Phase 2.
 *
 * This module is editor-only (lives under `backend/editor/`); the
 * web platform implements the same port interface separately under
 * `middleware/adapters/web/`.
 */

import { isNewTranspilerEnabled } from '@root/backend/editor/utils/transpiler-mode'
import { deployRuntimeProgram } from '@root/backend/shared/library/deploy-runtime-program'
import { probeRuntimeVersion } from '@root/backend/shared/library/probe-runtime-version'
import {
  fromSchemaShape,
  type SchemaProjectData,
  transpileToSt as runJsonTranspiler,
} from '@root/backend/shared/transpilers/st-transpiler'
import { XmlGenerator } from '@root/backend/shared/utils/PLC/xml-generator'
import type {
  CheckRuntimeVersionArgs,
  CheckRuntimeVersionResult,
  CompileArduinoArgs,
  CompileArduinoResult,
  CompilerPlatformPort,
  InstallArduinoCoreArgs,
  InstallArduinoLibArgs,
  PackageVppPluginArgs,
  PackageVppPluginResult,
  PlatformDeviceContext,
  PlatformLog,
  TranspileToStArgs,
  TranspileToStResult,
  UploadArduinoBoardArgs,
  UploadResult,
  UploadRuntimeV3Args,
  UploadRuntimeV4Args,
} from '@root/middleware/shared/ports/compiler-platform-port'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'

import type { CompilerModule } from './compiler-module'

/**
 * Subset of `CompilerModule` the port adapter calls into.  Declared
 * explicitly rather than typing as `CompilerModule` directly so the
 * port stays free of the wider class surface (logging internals,
 * file-watching, etc.).
 */
export interface EditorCompilerHandlers {
  handleTranspileXMLtoST: CompilerModule['handleTranspileXMLtoST']
  handleCompileArduinoProgram: CompilerModule['handleCompileArduinoProgram']
  handleUploadProgram: CompilerModule['handleUploadProgram']
  handleCoreInstallation: CompilerModule['handleCoreInstallation']
  handleLibraryInstallation: CompilerModule['handleLibraryInstallation']
  handleVendorPluginPackaging: CompilerModule['handleVendorPluginPackaging']
}

/**
 * Editor-specific context the port methods need: the project's
 * resolved paths, the JWT bridge for runtime API calls, and timing
 * constants for the deploy poller.
 */
export interface EditorCompilerPlatformPortContext {
  /** Project path on disk (without the trailing `project.json`). */
  normalizedProjectPath: string
  /** `<projectPath>/build/<boardTarget>/`. */
  compilationPath: string
  /** `<compilationPath>/src/`. */
  sourceTargetFolderPath: string
  /** Resolved `boardTarget` (e.g. `'OpenPLC Simulator'`). */
  boardTarget: string
  /** Resolved `boardCore` from hals.json (e.g. `'arduino:avr'`). */
  boardCore: string | null
  /** Per-board entry from `hals.json` for the current target.  Passed
   *  through to `handleCompileArduinoProgram` so the existing handler
   *  can pull out `platform` / `c_flags` / `max_data_size` / etc. */
  boardHalsContent: unknown
  /** Whether the user requested a clean rebuild (drives arduino-cli's
   *  `--clean` flag). */
  cleanBuild: boolean
  /** Bridge methods for runtime API calls (compile-status poll, etc.). */
  mainProcessBridge: {
    makeRuntimeApiRequest: <T = void>(
      ipAddress: string,
      endpoint: string,
      responseParser?: (data: string) => T,
    ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
    /** Upload the runtime-v4 program bundle. Owns token refresh internally
     *  (via the token authority), so the upload self-heals on expiry like every
     *  other runtime call. */
    makeRuntimeApiUpload: (opts: {
      ipAddress: string
      fileBuffer: Buffer
      filename: string
      contentType: string
      cleanBuild: boolean
      onUploadAccepted?: (responseBody: string) => void
    }) => Promise<{ success: true; data: string } | { success: false; error: string }>
  }
  /** Compress the source folder into the runtime v4 upload zip.
   *  Delegated through context so the port adapter doesn't pull
   *  in the `archiver`-dependent compressSourceFolder method (which
   *  has its own private state on CompilerModule). */
  compressSourceFolder: (folderPath: string) => Promise<Buffer>
  /** Timeout for the post-upload compile-status poll. */
  pollTimeoutMs: number
  /** Interval for the post-upload compile-status poll. */
  pollIntervalMs: number
  /** Timeout for the post-build PLC-start poll. */
  startTimeoutMs: number
  /** Interval for the post-build PLC-start poll. */
  startIntervalMs: number
}

/**
 * Build the editor's `CompilerPlatformPort` from existing handlers.
 *
 * Returns a port object the shared pipeline can drive without
 * knowing it's running in Electron's main process.  Each method
 * receives the pipeline's canonical inputs (file maps, byte
 * arrays, device context) and shims them onto the existing
 * handlers' filesystem-and-subprocess shape.
 */
export function createEditorCompilerPlatformPort(
  handlers: EditorCompilerHandlers,
  context: EditorCompilerPlatformPortContext,
): CompilerPlatformPort {
  return {
    /**
     * Node's `crypto.createHash('md5')` produces the canonical MD5
     * hex digest that defines.h embeds as `PROGRAM_MD5`.  Web's
     * adapter computes the same hash via `spark-md5`; both outputs
     * are byte-identical.
     */
    async computeMd5(input: string): Promise<string> {
      return createHash('md5').update(input).digest('hex')
    },

    /**
     * Transpile the project IR to Structured Text. The toggle —
     * `OPENPLC_USE_NEW_TRANSPILER` via `isNewTranspilerEnabled()` — selects
     * between the in-process JSON-fed transpiler (new path, opt-in)
     * and the bundled `xml2st` subprocess (legacy path, default).
     *
     * The legacy branch reproduces the pre-Phase-2 behaviour:
     * serialise the project to IEC 61131-3 XML via the shared
     * `XmlGenerator`, materialise it to `<sourceTargetFolder>/plc.xml`,
     * run `handleTranspileXMLtoST` (which spawns the bundled `xml2st`
     * binary), then read `program.st` back from disk.
     */
    async transpileToSt(args: TranspileToStArgs, log: PlatformLog): Promise<TranspileToStResult> {
      if (isNewTranspilerEnabled()) {
        try {
          // Editor IPC delivers the schema-shape project data
          // (discriminated-union POUs + singular `configuration`).
          // The port's declared `projectData` type is port-shape, but
          // the pipeline reaches us with the editor's schema-shape IPC
          // payload (matching `compileProgram`'s actual contract).  The
          // double cast bridges the static mismatch without serialising
          // through `unknown` at runtime.
          const ir = fromSchemaShape(args.projectData as unknown as SchemaProjectData)
          const result = runJsonTranspiler(ir)
          if (result.programSt === null || result.errors.length > 0) {
            const message = result.errors.join('\n') || 'Failed to generate Structured Text'
            log(message, 'error')
            return { ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] }
          }
          for (const warning of result.warnings) {
            log(warning, 'info')
          }
          return { ok: true, programSt: result.programSt }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(`st-transpiler failed: ${message}`, 'error')
          return { ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] }
        }
      }

      const xmlResult = XmlGenerator(args.projectData as never, 'old-editor')
      if (!xmlResult.ok || !xmlResult.data) {
        log(`XML generation failed: ${xmlResult.message}`, 'error')
        return { ok: false, errors: [{ message: xmlResult.message, line: 0, column: 0, severity: 'error' }] }
      }
      const xmlPath = join(context.sourceTargetFolderPath, 'plc.xml')
      try {
        await fs.mkdir(dirname(xmlPath), { recursive: true })
        await fs.writeFile(xmlPath, xmlResult.data, 'utf-8')

        await handlers.handleTranspileXMLtoST(
          xmlPath,
          (chunk, level) => {
            const message = typeof chunk === 'string' ? chunk : chunk.toString()
            log(message, level ?? 'info')
          },
          ['--keep-structs'],
        )

        const programStPath = join(context.sourceTargetFolderPath, 'program.st')
        const programSt = await fs.readFile(programStPath, 'utf-8')
        return { ok: true, programSt }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`xml2st failed: ${message}`, 'error')
        return { ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] }
      }
    },

    /**
     * Arduino-cli core install.  The existing
     * `handleCoreInstallation` already takes a core id and a log
     * callback — direct passthrough modulo the log-shape
     * translation.
     */
    async installArduinoCore(args: InstallArduinoCoreArgs, log: PlatformLog): Promise<UploadResult> {
      try {
        await handlers.handleCoreInstallation(
          args.coreId,
          (chunk, level) => {
            const message = typeof chunk === 'string' ? chunk : chunk.toString()
            log(message, level ?? 'info')
          },
          args.coreVersion,
        )
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Arduino core install failed: ${message}`, 'error')
        return { ok: false }
      }
    },

    /**
     * Arduino-cli library install.  Forwards `args.extraLibraries`
     * (the per-board library list from `BoardBuildInfo`) to
     * `handleLibraryInstallation`, which combines them with the
     * editor's `GLOBAL_LIBRARIES` and runs `arduino-cli lib install`
     * for whatever's missing.  `args.libId` is unused on this path —
     * kept in the port shape for the legacy single-library callers.
     */
    async installArduinoLib(args: InstallArduinoLibArgs, log: PlatformLog): Promise<UploadResult> {
      try {
        await handlers.handleLibraryInstallation(args.extraLibraries ?? [], (chunk, level) => {
          const message = typeof chunk === 'string' ? chunk : chunk.toString()
          log(message, level ?? 'info')
        })
        return { ok: true }
      } catch (error) {
        // Reached only when the install machinery itself can't run
        // (arduino-cli binary missing, spawn failure, etc.).  Non-
        // zero `arduino-cli lib install` exits are warnings inside
        // `handleLibraryInstallation` and don't throw.  Either way
        // the build continues — arduino-cli compile is the source of
        // truth for whether a required header can be found.
        const message = error instanceof Error ? error.message : String(error)
        log(`Warning: library install machinery failed: ${message}. Continuing build.`, 'warning')
        return { ok: true }
      }
    },

    /**
     * Materialise the in-memory file map to disk under the project's
     * build directory, then spawn `arduino-cli compile` via the
     * existing `handleCompileArduinoProgram`.
     *
     * When a `Baremetal.ino.hex` exists under the FQBN build folder
     * we read it back into the result `binary` field — the simulator
     * path needs it in memory to hand to avr8js.  Non-AVR cores
     * (RP2040 → `.uf2`, ESP32 / mbed → `.bin`) don't produce a `.hex`
     * and don't need an in-memory binary: arduino-cli's separate
     * `upload` step finds the right artefact on disk under whatever
     * extension the core produced.  In that case we return
     * `{ ok: true, binary: undefined }` and the shared pipeline
     * proceeds — the simulator branch is the only one that requires
     * a non-empty binary and it bails there with a clearer error if
     * .hex is somehow missing on AVR.
     */
    async compileArduino(args: CompileArduinoArgs, log: PlatformLog): Promise<CompileArduinoResult> {
      try {
        // Materialise every entry in the in-memory file map under
        // the project's build directory.  Editor's existing flow
        // wrote these files in scattered places throughout the
        // compile pipeline; doing it here once preserves the same
        // on-disk layout arduino-cli expects.
        await Promise.all(
          Object.entries(args.files).map(async ([relPath, content]) => {
            const absPath = join(context.compilationPath, relPath)
            await fs.mkdir(dirname(absPath), { recursive: true })
            await fs.writeFile(absPath, content, 'utf-8')
          }),
        )

        // Invoke the existing handler — it spawns arduino-cli compile
        // with the per-board hals entry's flags.  The canonical
        // `args.argv` from the shared `buildArduinoCliCompileArgs` is
        // available for a future cleanup that inlines the spawn here
        // and consumes it directly; for now the legacy handler builds
        // its own argv from `boardHalsContent`.
        await handlers.handleCompileArduinoProgram({
          boardTarget: context.boardTarget,
          boardHalsContent: context.boardHalsContent as never,
          compilationPath: context.compilationPath,
          cleanBuild: context.cleanBuild,
          handleOutputData: (chunk, level) => {
            const message = typeof chunk === 'string' ? chunk : chunk.toString()
            log(message, level ?? 'info')
          },
        })

        // Derive the FQBN from the board's hals.json entry — the
        // simulator branch in compileProgram uses the exact same
        // derivation (`platform.replaceAll(':', '.')`), so the two
        // paths agree on which `.hex` belongs to the current build.
        const boardPlatform =
          context.boardHalsContent !== null &&
          typeof context.boardHalsContent === 'object' &&
          'platform' in (context.boardHalsContent as Record<string, unknown>) &&
          typeof (context.boardHalsContent as { platform?: unknown }).platform === 'string'
            ? (context.boardHalsContent as { platform: string }).platform
            : ''
        // .hex lookup is best-effort here.  Found → load it for the
        // simulator path.  Not found → arduino-cli still produced an
        // artefact (the compile would have thrown otherwise); the
        // physical-upload paths read it from disk themselves, so we
        // hand the pipeline `{ ok: true, binary: undefined }` and let
        // the simulator branch surface a clearer error if it actually
        // needed those bytes.
        const hexPath = await findHexInCompilationPath(context.compilationPath, boardPlatform)
        if (hexPath) {
          const binary = await fs.readFile(hexPath)
          return { ok: true, binary: new Uint8Array(binary) }
        }
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Arduino compile failed: ${message}`, 'error')
        return { ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] }
      }
    },

    /**
     * Compress the source folder and POST it to the runtime via the
     * editor's HTTPS upload helper.  Delegates the full upload →
     * poll → start sequence to the shared `deployRuntimeProgram`.
     */
    async uploadRuntimeV4(args: UploadRuntimeV4Args, log: PlatformLog): Promise<UploadResult> {
      const deviceContext = assertEditorHttpsContext(args.context)
      try {
        // Materialise the bundle to disk under sourceTargetFolderPath
        // so the existing `compressSourceFolder` can zip it.
        await Promise.all(
          Object.entries(args.bundle).map(async ([relPath, content]) => {
            const absPath = join(context.sourceTargetFolderPath, relPath)
            await fs.mkdir(dirname(absPath), { recursive: true })
            await fs.writeFile(absPath, content, 'utf-8')
          }),
        )
        const fileBuffer = await context.compressSourceFolder(context.sourceTargetFolderPath)

        const deployOutcome = await deployRuntimeProgram({
          uploadProgram: () =>
            context.mainProcessBridge.makeRuntimeApiUpload({
              ipAddress: deviceContext.ip,
              filename: 'program.zip',
              contentType: 'application/zip',
              fileBuffer,
              cleanBuild: context.cleanBuild,
              onUploadAccepted: (responseBody) => {
                try {
                  const response = JSON.parse(responseBody) as { CompilationStatus?: string }
                  log(`Runtime compilation started: ${response.CompilationStatus || 'COMPILING'}`, 'info')
                } catch {
                  log('Could not parse runtime response', 'warning')
                }
              },
            }),
          fetchCompilationStatus: async () => {
            const result = await context.mainProcessBridge.makeRuntimeApiRequest<{
              status: string
              logs: string[]
              exit_code: number | null
            }>(deviceContext.ip, '/api/compilation-status', (data: string) => {
              return JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
            })
            if (!result.success) return { success: false, error: result.error }
            return { success: true, data: result.data! }
          },
          fetchStartResponse: async () => {
            const result = await context.mainProcessBridge.makeRuntimeApiRequest<string>(
              deviceContext.ip,
              '/api/start-plc',
              (data: string) => {
                const parsed = JSON.parse(data) as { status?: string }
                return (parsed.status ?? '').trim()
              },
            )
            if (!result.success) return { success: false, error: result.error }
            return { success: true, status: result.data ?? '' }
          },
          onLog: (level, message) =>
            log(message, level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'),
          pollTimeoutMs: context.pollTimeoutMs,
          pollIntervalMs: context.pollIntervalMs,
          startTimeoutMs: context.startTimeoutMs,
          startIntervalMs: context.startIntervalMs,
        })

        return { ok: deployOutcome === 'STARTED' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Runtime v4 upload failed: ${message}`, 'error')
        return { ok: false }
      }
    },

    /**
     * arduino-cli upload to a physical Arduino board.  Delegates to
     * the existing `handleUploadProgram` handler.
     *
     * The serial port comes from the renderer's device-board picker
     * via the pipeline's `communicationPort` arg → `args.port`.  We
     * forward it explicitly so a port change made in the UI takes
     * effect on this build without waiting for a project save —
     * `handleUploadProgram` historically read the value from
     * `devices/configuration.json` on disk, which lags the live store
     * by a save round-trip.  When `args.port` is empty (callers that
     * predate the explicit-port plumbing), the handler still falls
     * back to its disk read.
     */
    async uploadArduinoBoard(args: UploadArduinoBoardArgs, log: PlatformLog): Promise<UploadResult> {
      try {
        await handlers.handleUploadProgram({
          projectPath: context.normalizedProjectPath,
          arduinoPlatform: args.fqbn,
          compilationPath: context.compilationPath,
          communicationPort: args.port || undefined,
          handleOutputData: (chunk, level) => {
            const message = typeof chunk === 'string' ? chunk : chunk.toString()
            log(message, level ?? 'info')
          },
        })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Arduino upload failed: ${message}`, 'error')
        return { ok: false }
      }
    },

    /**
     * Runtime v3 upload — sends the raw `program.st` (with embedded
     * c_blocks markers) to the device's v3 endpoint.  v3 is end-of-
     * life; web's adapter no-ops this (web doesn't expose v3 as a
     * frontend option).
     */
    async uploadRuntimeV3(args: UploadRuntimeV3Args, log: PlatformLog): Promise<UploadResult> {
      const deviceContext = assertEditorHttpsContext(args.context)
      try {
        const fileBuffer = Buffer.from(args.programSt, 'utf-8')
        const deployOutcome = await deployRuntimeProgram({
          uploadProgram: () =>
            context.mainProcessBridge.makeRuntimeApiUpload({
              ipAddress: deviceContext.ip,
              filename: 'program.st',
              contentType: 'text/plain',
              fileBuffer,
              cleanBuild: context.cleanBuild,
              onUploadAccepted: (responseBody) => {
                try {
                  const response = JSON.parse(responseBody) as { CompilationStatus?: string }
                  log(`Runtime compilation started: ${response.CompilationStatus || 'COMPILING'}`, 'info')
                } catch {
                  log('Could not parse runtime response', 'warning')
                }
              },
            }),
          fetchCompilationStatus: async () => {
            const result = await context.mainProcessBridge.makeRuntimeApiRequest<{
              status: string
              logs: string[]
              exit_code: number | null
            }>(deviceContext.ip, '/api/compilation-status', (data: string) => {
              return JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
            })
            if (!result.success) return { success: false, error: result.error }
            return { success: true, data: result.data! }
          },
          fetchStartResponse: async () => {
            const result = await context.mainProcessBridge.makeRuntimeApiRequest<string>(
              deviceContext.ip,
              '/api/start-plc',
              (data: string) => {
                const parsed = JSON.parse(data) as { status?: string }
                return (parsed.status ?? '').trim()
              },
            )
            if (!result.success) return { success: false, error: result.error }
            return { success: true, status: result.data ?? '' }
          },
          onLog: (level, message) =>
            log(message, level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'),
          pollTimeoutMs: context.pollTimeoutMs,
          pollIntervalMs: context.pollIntervalMs,
          startTimeoutMs: context.startTimeoutMs,
          startIntervalMs: context.startIntervalMs,
        })
        return { ok: deployOutcome === 'STARTED' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Runtime v3 upload failed: ${message}`, 'error')
        return { ok: false }
      }
    },

    /**
     * Probe the device's `/api/version` (unauthenticated) so the
     * pipeline can short-circuit uploads to pre-4.1.0 runtimes.
     *
     * Transport: Electron's HTTPS bridge → device IP.
     * Response parsing + null-fallback live in the shared
     * `probeRuntimeVersion` helper so editor and web give the gate
     * an equivalent answer against the same runtime container.
     */
    async checkRuntimeVersion(args: CheckRuntimeVersionArgs, log: PlatformLog): Promise<CheckRuntimeVersionResult> {
      const deviceContext = assertEditorHttpsContext(args.context)
      const { version } = await probeRuntimeVersion({
        fetchVersion: async () => {
          const result = await context.mainProcessBridge.makeRuntimeApiRequest<{ version: string }>(
            deviceContext.ip,
            '/api/version',
            (data: string) => JSON.parse(data) as { version: string },
          )
          if (!result.success) return { success: false, error: result.error }
          return { success: true, body: result.data }
        },
        log,
      })
      return { ok: true, version }
    },

    /**
     * VPP runtime-v4 packaging.  Delegates to the existing
     * `handleVendorPluginPackaging` handler, which:
     *   - Self-gates: emits `Board "<name>" is not from a VPP package,
     *     skipping VPP packaging` and returns early for plain
     *     runtime-v4 boards (Runtime v4, SLM-RP4 was the original
     *     test target).  This matches the pre-refactor invariant
     *     that the orchestrator calls the handler unconditionally
     *     for runtime-v4 and the handler decides whether to act.
     *   - For VPP boards: generates `conf/<plugin>.json` + emits
     *     `vpp_plugins.conf` to enable the driver + copies the
     *     plugin source under `vpp_plugin/` with a SHA-256 checksum
     *     so the runtime's `compile.sh` can skip a rebuild when the
     *     driver source hasn't changed.
     *
     * All writes go directly to `sourceTargetFolderPath` on disk —
     * the editor's `uploadRuntimeV4` zips that directory in full, so
     * VPP files end up in the upload alongside the in-memory bundle's
     * materialised entries.  We return `{ files: {} }` because the
     * disk layer is already the source of truth for the editor; web's
     * adapter will need to surface them in the returned map instead.
     */
    async packageVppPlugin(args: PackageVppPluginArgs, log: PlatformLog): Promise<PackageVppPluginResult> {
      try {
        await handlers.handleVendorPluginPackaging(
          args.boardTarget,
          context.normalizedProjectPath,
          context.sourceTargetFolderPath,
          // The handler's callback signature accepts `Buffer | string`
          // for the chunk and `'info' | 'error' | undefined` for the
          // log level; PlatformLog wants `string` + `'info' | 'warning'
          // | 'error'`.  Coerce both — the handler never emits
          // Buffers for VPP packaging (only string log lines), and an
          // undefined level falls back to 'info' to match the
          // pre-refactor postMessage default.
          (data, logLevel) => {
            const message = typeof data === 'string' ? data : data.toString('utf-8')
            log(message, logLevel ?? 'info')
          },
        )
        return { files: {} }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          files: {},
          errors: [{ message, line: 0, column: 0, severity: 'error' }],
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Discriminator narrow: the editor adapter only handles
 * `editor-https` contexts.  Throws on `web-orchestrator` (which
 * should never be passed to the editor port).
 */
export function assertEditorHttpsContext(
  context: PlatformDeviceContext,
): Extract<PlatformDeviceContext, { kind: 'editor-https' }> {
  if (context.kind !== 'editor-https') {
    throw new Error(`Editor compiler platform port received non-editor context: ${context.kind}`)
  }
  return context
}

/**
 * Find the arduino-cli-produced `Baremetal.ino.hex` under the build
 * directory.  arduino-cli writes it to a board-FQBN-specific
 * sub-directory (e.g. `examples/Baremetal/build/arduino.avr.mega/`)
 * derived from the hals.json `platform` field with `:` replaced by
 * `.` — same derivation `compileProgram`'s simulator branch uses to
 * locate the `.hex` it hands to avr8js.
 *
 * **Only meaningful for AVR / simulator builds.**  Other cores emit
 * different artefact formats — RP2040 writes `.uf2`, ESP32 / mbed
 * write `.bin` — so this helper returns `null` for those and the
 * caller MUST treat null-with-successful-compile as "no in-memory
 * binary to surface, but arduino-cli succeeded."  The simulator path
 * is the only consumer that actually loads the bytes (avr8js
 * requires Intel HEX); for real-board uploads arduino-cli's separate
 * `upload` step finds its own artefact on disk under whatever
 * extension the core produced, so the editor doesn't need to read
 * it back into memory at all.
 *
 * `fqbn` MUST be the canonical platform string (e.g.
 * `arduino:avr:mega`); the helper does the `:`→`.` translation
 * itself.  When the canonical path doesn't exist (a stale build with
 * a different FQBN layout, manual fiddling with the build dir), the
 * helper falls back to walking the build directory and returning
 * the first match — preserves the pre-fix behaviour as a safety
 * net rather than failing outright.
 *
 * Without the deterministic path, a stale FQBN sub-directory left
 * over from a prior board target (e.g. user compiled for Mega, then
 * switched to Uno without cleaning) would cause the walk to return
 * the wrong binary alphabetically.  Real scenario: compile for Mega,
 * then Uno, then upload → arduino-cli ends up flashing the Mega hex
 * to the Uno because `arduino.avr.mega` comes before `arduino.avr.uno`
 * in `readdir`.
 */
export async function findHexInCompilationPath(compilationPath: string, fqbn: string): Promise<string | null> {
  const buildDir = join(compilationPath, 'examples', 'Baremetal', 'build')

  // Deterministic path first — the canonical layout for the
  // current build's FQBN.
  if (fqbn.length > 0) {
    const fqbnSubDir = fqbn.replaceAll(':', '.')
    const canonicalPath = join(buildDir, fqbnSubDir, 'Baremetal.ino.hex')
    try {
      await fs.access(canonicalPath)
      return canonicalPath
    } catch {
      // Fall through to the walk-fallback below.
    }
  }

  // Safety net: walk the build dir for the first matching .hex.
  // Reached when the canonical path is absent (FQBN string differs
  // from the directory arduino-cli produced — observed historically
  // with cores that mangle the FQBN through aliases).
  try {
    const fqbnDirs = await fs.readdir(buildDir)
    for (const fqbnDir of fqbnDirs) {
      const hexPath = join(buildDir, fqbnDir, 'Baremetal.ino.hex')
      try {
        await fs.access(hexPath)
        return hexPath
      } catch {
        // Try next fqbn dir.
      }
    }
  } catch {
    // No build/ dir — compile didn't run.
  }
  return null
}
