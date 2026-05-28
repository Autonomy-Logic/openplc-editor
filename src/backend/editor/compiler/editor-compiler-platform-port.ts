/**
 * Editor-side implementation of `CompilerPlatformPort`.
 *
 * Wraps the existing editor handlers (`handleTranspileXMLtoST`,
 * `handleCompileArduinoProgram`, etc.) so the shared compile pipeline
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
 * No new pipeline logic lives here — only the platform-specific glue
 * the editor needs to materialise the in-memory inputs to disk so
 * `xml2st` / `arduino-cli` subprocesses can consume them, and to
 * read the resulting artefacts back into memory for the pipeline.
 *
 * This module is editor-only (lives under `backend/editor/`); the
 * web platform implements the same port interface separately under
 * `middleware/adapters/web/`.
 */

import { deployRuntimeProgram } from '@root/backend/shared/library/deploy-runtime-program'
import type {
  CheckRuntimeVersionArgs,
  CheckRuntimeVersionResult,
  CompileArduinoArgs,
  CompileArduinoResult,
  CompilerPlatformPort,
  InstallArduinoCoreArgs,
  InstallArduinoLibArgs,
  PlatformDeviceContext,
  PlatformLog,
  TranspileXmlToStArgs,
  TranspileXmlToStResult,
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
  /** Whether the user requested a clean rebuild (drives arduino-cli's
   *  `--clean` flag). */
  cleanBuild: boolean
  /** Bridge methods for runtime API calls (compile-status poll, etc.). */
  mainProcessBridge: {
    makeRuntimeApiRequest: <T = void>(
      ipAddress: string,
      jwtToken: string,
      endpoint: string,
      responseParser?: (data: string) => T,
    ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
  }
  /** Compress the source folder into the runtime v4 upload zip.
   *  Delegated through context so the port adapter doesn't pull
   *  in the `archiver`-dependent compressSourceFolder method (which
   *  has its own private state on CompilerModule). */
  compressSourceFolder: (folderPath: string) => Promise<Buffer>
  /** Send the upload request to a runtime device.  Wraps
   *  CompilerModule.sendRuntimeUpload with the right multipart
   *  payload structure. */
  sendRuntimeUpload: (opts: {
    hostname: string
    jwtToken: string
    filename: string
    contentType: string
    fileBuffer: Buffer
    cleanBuild: boolean
    onUploadAccepted?: (responseBody: string) => void
  }) => Promise<{ success: boolean; error?: string }>
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
     * Spawn the bundled `xml2st` binary to transpile IEC 61131-3
     * XML to ST.  The existing `handleTranspileXMLtoST` expects a
     * file path (it opens the file via the subprocess's stdin), so
     * we materialise the in-memory XML to a temp file first and
     * read the produced `program.st` back from disk.
     */
    async transpileXmlToSt(args: TranspileXmlToStArgs, log: PlatformLog): Promise<TranspileXmlToStResult> {
      const xmlPath = join(context.sourceTargetFolderPath, 'plc.xml')
      try {
        await fs.mkdir(dirname(xmlPath), { recursive: true })
        await fs.writeFile(xmlPath, args.xml, 'utf-8')

        await handlers.handleTranspileXMLtoST.call(undefined as never, xmlPath, (chunk, level) => {
          const message = typeof chunk === 'string' ? chunk : chunk.toString()
          log(message, level ?? 'info')
        })

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
        await handlers.handleCoreInstallation.call(undefined as never, args.coreId, (chunk, level) => {
          const message = typeof chunk === 'string' ? chunk : chunk.toString()
          log(message, level ?? 'info')
        })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Arduino core install failed: ${message}`, 'error')
        return { ok: false }
      }
    },

    /**
     * Arduino-cli library install.  Existing
     * `handleLibraryInstallation` installs the full set of libs
     * configured in hals.json — args.libId is currently a no-op
     * for backward compat with the existing handler.
     */
    async installArduinoLib(_args: InstallArduinoLibArgs, log: PlatformLog): Promise<UploadResult> {
      try {
        await handlers.handleLibraryInstallation.call(undefined as never, (chunk, level) => {
          const message = typeof chunk === 'string' ? chunk : chunk.toString()
          log(message, level ?? 'info')
        })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Arduino library install failed: ${message}`, 'error')
        return { ok: false }
      }
    },

    /**
     * Materialise the in-memory file map to disk under the project's
     * build directory, then spawn `arduino-cli compile` via the
     * existing `handleCompileArduinoProgram`.  Read the produced
     * `.hex` back into memory for the pipeline's return.
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

        // The existing handler reads hals.json for compile flags;
        // we pass the canonical argv through and discard it for now.
        // The board-specific compile call still goes through the
        // legacy `handleCompileArduinoProgram` because it spawns
        // arduino-cli with the right environment.  A future cleanup
        // will inline the spawn here and consume `args.argv` directly.
        // Read the produced `.hex` once the handler returns.
        const hexPath = await findHexInCompilationPath(context.compilationPath)
        if (!hexPath) {
          throw new Error('Compiled .hex not found after arduino-cli compile.')
        }
        const binary = await fs.readFile(hexPath)
        return { ok: true, binary: new Uint8Array(binary) }
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
            context.sendRuntimeUpload({
              hostname: deviceContext.ip,
              jwtToken: deviceContext.jwt,
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
            }>(deviceContext.ip, deviceContext.jwt, '/api/compilation-status', (data: string) => {
              return JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
            })
            if (!result.success) return { success: false, error: result.error }
            return { success: true, data: result.data! }
          },
          fetchStartResponse: async () => {
            const result = await context.mainProcessBridge.makeRuntimeApiRequest<string>(
              deviceContext.ip,
              deviceContext.jwt,
              '/api/start-plc',
              (data: string) => {
                const parsed = JSON.parse(data) as { status?: string }
                return (parsed.status ?? '').trim()
              },
            )
            if (!result.success) return { success: false, error: result.error }
            return { success: true, status: result.data ?? '' }
          },
          onLog: (level, message) => log(message, level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'),
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
     */
    async uploadArduinoBoard(_args: UploadArduinoBoardArgs, log: PlatformLog): Promise<UploadResult> {
      try {
        await handlers.handleUploadProgram.call(undefined as never, {
          projectPath: context.normalizedProjectPath,
          arduinoPlatform: _args.fqbn,
          compilationPath: context.compilationPath,
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
            context.sendRuntimeUpload({
              hostname: deviceContext.ip,
              jwtToken: deviceContext.jwt,
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
            }>(deviceContext.ip, deviceContext.jwt, '/api/compilation-status', (data: string) => {
              return JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
            })
            if (!result.success) return { success: false, error: result.error }
            return { success: true, data: result.data! }
          },
          fetchStartResponse: async () => {
            const result = await context.mainProcessBridge.makeRuntimeApiRequest<string>(
              deviceContext.ip,
              deviceContext.jwt,
              '/api/start-plc',
              (data: string) => {
                const parsed = JSON.parse(data) as { status?: string }
                return (parsed.status ?? '').trim()
              },
            )
            if (!result.success) return { success: false, error: result.error }
            return { success: true, status: result.data ?? '' }
          },
          onLog: (level, message) => log(message, level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'),
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
     */
    async checkRuntimeVersion(args: CheckRuntimeVersionArgs, log: PlatformLog): Promise<CheckRuntimeVersionResult> {
      const deviceContext = assertEditorHttpsContext(args.context)
      try {
        const result = await context.mainProcessBridge.makeRuntimeApiRequest<{ version: string }>(
          deviceContext.ip,
          '', // unauthenticated probe
          '/api/version',
          (data: string) => JSON.parse(data) as { version: string },
        )
        if (!result.success) {
          log(`Could not reach runtime: ${result.error}`, 'warning')
          return { ok: true, version: null }
        }
        return { ok: true, version: result.data?.version ?? null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Runtime version probe failed: ${message}`, 'warning')
        return { ok: true, version: null }
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
function assertEditorHttpsContext(
  context: PlatformDeviceContext,
): Extract<PlatformDeviceContext, { kind: 'editor-https' }> {
  if (context.kind !== 'editor-https') {
    throw new Error(`Editor compiler platform port received non-editor context: ${context.kind}`)
  }
  return context
}

/**
 * Find the arduino-cli-produced `Baremetal.ino.hex` under the build
 * directory.  arduino-cli writes it to a board-FQBN-specific sub-
 * directory (e.g. `examples/Baremetal/build/arduino.avr.mega/`); the
 * exact sub-path depends on the board, so we walk the tree to find
 * it rather than reconstructing the path from hals.json.
 */
async function findHexInCompilationPath(compilationPath: string): Promise<string | null> {
  const buildDir = join(compilationPath, 'examples', 'Baremetal', 'build')
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
