/**
 * CompilerPort — Abstracts the PLC compilation pipeline.
 *
 * Editor adapter: Delegates to main process via IPC (local binaries: xml2st, iec2c, arduino-cli).
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

export interface CompilerPort {
  /**
   * Run the full compilation pipeline (XML -> ST -> C -> binary).
   * Emits progress events for UI feedback.
   */
  compileProgram(
    args: CompileProgramArgs,
    onProgress: (event: CompileProgressEvent) => void,
  ): Promise<CompileResult>

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
   * Subscribe to compilation output logs (stdout/stderr streaming).
   * Returns unsubscribe function.
   */
  onCompileOutput?(callback: (line: string) => void): Unsubscribe
}
