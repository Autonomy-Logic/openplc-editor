/**
 * CompilerPort — Abstracts the PLC compilation pipeline.
 *
 * Editor adapter: Delegates to main process via IPC (local tools: xml2st, STruC++, arduino-cli).
 * Web adapter:    Delegates to remote API at compile.getedge.me (callGenerateSt, callCompileSt, etc.).
 *
 * The UI only knows "compile this project" and receives progress events.
 * The adapter decides whether to call local binaries or remote HTTP endpoints.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.runCompileProgram()
 *   - window.bridge.runDebugCompilation()
 *   - window.bridge.exportProjectXml()
 *   - window.bridge.createBuildDirectory()
 *   - window.bridge.createXmlFileToBuild()
 *   - window.bridge.compileRequest()
 *   - window.bridge.generateCFilesRequest()
 *   - window.bridge.setupCompilerEnvironment()
 *
 * ## Web service methods replaced:
 *   - callGenerateSt()
 *   - callCompileSt()
 *   - callGenerateDebug()
 *   - callGenerateGlueVars()
 *   - callCompileArduino()
 */

import type {
  CompileLibraryResult,
  CompileProgressEvent,
  CompileResult,
  DebugCompileResult,
  PLCProjectData,
  Result,
  Unsubscribe,
} from './types'

export interface CompileProgramArgs {
  projectData: PLCProjectData
  boardTarget: string
  projectPath: string
  communicationPort?: string
  compileOnly?: boolean
  cleanBuild?: boolean
  isSimulator?: boolean
  runtimeIpAddress?: string | null
  runtimeJwtToken?: string | null
  /** User-authored configuration-screen data
   *  (`DeviceConfiguration.vendorScreenData`).  Threaded through the
   *  port so the shared `runCompilePipeline` can emit `vpp_config.h`
   *  for arduino-cli VPP boards (Arduino Opta, P1AM).  The pipeline
   *  gates emission on the board's resolved `vppIo` capability;
   *  non-VPP boards ignore this. */
  vendorScreenData?: Record<string, unknown>
}

export interface DebugCompileArgs {
  projectData: PLCProjectData
  boardTarget: string
  projectPath: string
}

export interface ExportXmlArgs {
  projectData: PLCProjectData
  projectPath: string
  format: 'old-editor' | 'codesys'
}

/**
 * Inputs for a library build.  The backend reads `library.json` from
 * the project root fresh on each invocation (the manifest tab's
 * surgical-save flow writes it ahead of the build click), so this
 * struct only needs the in-memory project data and the path; the
 * adapter doesn't have to round-trip the manifest contents through
 * the bridge.
 */
export interface CompileLibraryArgs {
  projectData: PLCProjectData
  projectPath: string
  /**
   * Skip the verification-result cache for this run.  The MD5 cache
   * normally short-circuits the slow simulator-target verification
   * when the program.st coming out of xml2st hasn't changed since
   * the last successful (or failed) verify; `cleanBuild: true`
   * forces a fresh compile.
   *
   * Pure UX gate — the artefact build itself is always fresh; only
   * the verification step is cached.
   */
  cleanBuild?: boolean
}

export interface CompilerPort {
  /**
   * Run the full compilation pipeline (XML -> ST -> C -> binary).
   * Emits progress events for UI feedback.
   */
  compileProgram(args: CompileProgramArgs, onProgress: (event: CompileProgressEvent) => void): Promise<CompileResult>

  /**
   * Run a debug-mode compilation that produces debug symbols.
   * Used before connecting the debugger to verify program integrity.
   */
  compileForDebug(
    args: DebugCompileArgs,
    onProgress: (event: CompileProgressEvent) => void,
  ): Promise<DebugCompileResult>

  /**
   * Export the project as IEC 61131-3 XML.
   * Editor: writes XML file to disk.
   * Web: returns XML string (or triggers download).
   */
  exportProjectXml(args: ExportXmlArgs): Promise<Result<{ message: string }>>

  /**
   * Build a `.stlib` archive from a Library Project on disk.
   * Editor: validates the manifest, runs the local xml2st binary,
   *   pipes the result through strucpp's library compiler, and
   *   writes the archive to `<projectPath>/build/<name>.stlib`.
   * Web (future): posts the project + manifest to a remote service
   *   that performs the same flow on the server side.
   *
   * Library builds are only valid for projects with `meta.type ===
   * 'plc-library'`.  Caller is expected to gate the invocation via
   * `projectCapabilities(meta).hasLibraryBuild`.
   *
   * Returns the artefact path on success, or an error string the
   * console renders directly.  The optional `verification` field
   * reports the Phase-8 avr-gcc verification result when wired —
   * a verification failure does NOT fail the build.
   */
  compileLibrary?(
    args: CompileLibraryArgs,
    onProgress: (event: CompileProgressEvent) => void,
  ): Promise<CompileLibraryResult>

  /**
   * Subscribe to compilation output logs (stdout/stderr streaming).
   * Returns unsubscribe function.
   */
  onCompileOutput?(callback: (line: string) => void): Unsubscribe
}
