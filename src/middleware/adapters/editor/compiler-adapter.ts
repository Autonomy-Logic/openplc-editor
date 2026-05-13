/**
 * Editor CompilerPort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process CompilerModule via MessageChannel IPC.
 * The main process handles the full pipeline: XML generation, ST transpilation,
 * C code generation, and binary compilation.
 *
 * Type mapping:
 *   - Port POUs use flat format: { name, pouType, ... }
 *   - Editor IPC uses discriminated union: { type, data: { name, ... } }
 *   - Port uses `configurations` (plural), IPC uses `configuration` (singular)
 */

import { preprocessPous } from '../../../backend/shared/utils/PLC/preprocess-pous'
import type {
  CompileLibraryArgs,
  CompileProgramArgs,
  CompilerPort,
  DebugCompileArgs,
  ExportXmlArgs,
} from '../../shared/ports/compiler-port'
import type {
  CompileLibraryResult,
  CompileProgressEvent,
  CompileResult,
  DebugCompileResult,
  PLCPou,
  PLCProjectData,
  Result,
} from '../../shared/ports/types'

/** Shape of the project data expected by the editor's IPC bridge. */
interface IpcProjectData {
  dataTypes: PLCProjectData['dataTypes']
  pous: Array<{
    type: string
    data: {
      name: string
      variables: unknown[]
      returnType?: string
      body: { language: string; value: unknown }
      documentation: string
    }
  }>
  configuration: PLCProjectData['configurations']
  servers?: PLCProjectData['servers']
  remoteDevices?: PLCProjectData['remoteDevices']
  libraries?: PLCProjectData['libraries']
  originalCppPous?: Array<{ name: string; code: string; variables: unknown[] }>
}

/** Converts a flat port POU to the editor's discriminated-union IPC format. */
function portPouToIpcPou(pou: PLCPou) {
  return {
    type: pou.pouType,
    data: {
      name: pou.name,
      variables: (pou.interface?.variables ?? []) as unknown[],
      ...(pou.interface?.returnType ? { returnType: pou.interface.returnType } : {}),
      body: pou.body as { language: string; value: unknown },
      documentation: pou.documentation ?? '',
    },
  }
}

/** Converts PLCProjectData (port format) to the editor's IPC format. */
function toIpcProjectData(data: PLCProjectData & { originalCppPous?: unknown[] }): IpcProjectData {
  return {
    dataTypes: data.dataTypes,
    pous: data.pous.map(portPouToIpcPou),
    configuration: data.configurations,
    servers: data.servers,
    remoteDevices: data.remoteDevices,
    libraries: data.libraries,
    ...(data.originalCppPous ? { originalCppPous: data.originalCppPous as IpcProjectData['originalCppPous'] } : {}),
  }
}

/** Decode a Buffer/Uint8Array message to string lines. */
function decodeMessage(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(raw)
  }
  if (raw && typeof raw === 'object' && 'type' in raw) {
    const obj = raw as Record<string, unknown>
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      // Electron serializes Node Buffers as { type: 'Buffer', data: number[] }
      return new TextDecoder().decode(new Uint8Array(obj.data as number[]))
    }
  }
  return String(raw)
}

/** Best-effort stage inference from compiler log messages. */
function inferStage(message: string): CompileProgressEvent['stage'] {
  const lower = message.toLowerCase()
  if (lower.includes('xml') || lower.includes('generating xml')) return 'xml'
  // C++ check before ST — STruC++ messages like "Compiling ST to C++" contain both keywords
  if (lower.includes('struc++') || lower.includes('c++') || lower.includes('c code')) return 'c'
  if (lower.includes('structured text') || lower.includes('.st') || lower.includes('transpil')) return 'st'
  if (lower.includes('arduino') || lower.includes('compiling') || lower.includes('uploading')) return 'arduino'
  return 'st'
}

export function createEditorCompilerAdapter(): CompilerPort {
  return {
    async compileProgram(
      args: CompileProgramArgs,
      onProgress: (event: CompileProgressEvent) => void,
    ): Promise<CompileResult> {
      const boards = await window.bridge.getAvailableBoards()
      const boardInfo = boards.get(args.boardTarget)
      const boardCore = boardInfo?.core ?? null
      const isSimulator = args.isSimulator ?? boardInfo?.compiler === 'simulator'

      // Preprocess POUs (comment wrapping, Python->ST stubs, C++ validation/ST generation)
      const { projectData: processedData, validationFailed } = preprocessPous(
        args.projectData,
        isSimulator,
        (level, message) => {
          onProgress({ stage: 'st', message, level })
        },
      )

      if (validationFailed) {
        return {
          success: false,
          error: 'POU validation failed. Check C/C++ code for missing setup()/loop() functions.',
        }
      }

      const ipcData = toIpcProjectData(processedData)

      return new Promise<CompileResult>((resolve) => {
        let hasError = false
        let lastError = ''
        let hexPath: string | undefined

        window.bridge.runCompileProgram(
          [
            args.projectPath,
            args.boardTarget,
            boardCore,
            args.compileOnly ?? false,
            ipcData as never,
            args.runtimeIpAddress ?? null,
            args.runtimeJwtToken ?? null,
            args.cleanBuild ?? false,
          ],
          (data: Record<string, unknown>) => {
            // Extract simulator firmware path BEFORE the closePort early return,
            // because the backend sends both fields in the same message.
            if (data.simulatorFirmwarePath) {
              hexPath = data.simulatorFirmwarePath as string
              onProgress({ stage: 'done', message: 'Simulator firmware ready', firmwarePath: hexPath })
            }

            if (data.closePort) {
              onProgress({ stage: 'done', message: 'Compilation complete' })
              resolve(
                hasError
                  ? { success: false, error: lastError }
                  : { success: true, message: 'Compilation complete', hexPath },
              )
              return
            }

            // Forward plcStatus for runtime status updates
            if (data.plcStatus) {
              onProgress({ stage: 'arduino', message: '', plcStatus: data.plcStatus as string })
            }

            if (data.message) {
              const message = decodeMessage(data.message)
              // Structured CompileError travels alongside the formatted
              // text whenever the compiler-module's strucpp failure
              // path emits a per-error log entry.  Forward it as-is
              // so the console can drive click-to-open from the
              // structured fields rather than parsing text.
              const compileError = data.compileError as
                | CompileProgressEvent['compileError']
                | undefined

              if (data.logLevel === 'error') {
                hasError = true
                lastError = message
                onProgress({
                  stage: 'error',
                  message,
                  level: 'error',
                  ...(compileError ? { compileError } : {}),
                })
              } else {
                onProgress({
                  stage: inferStage(message),
                  message,
                  level: (data.logLevel as string) ?? 'info',
                  ...(compileError ? { compileError } : {}),
                })
              }
            }
          },
        )
      })
    },

    async compileForDebug(
      args: DebugCompileArgs,
      onProgress: (event: CompileProgressEvent) => void,
    ): Promise<DebugCompileResult> {
      // Preprocess for debug compilation too
      const { projectData: processedData, validationFailed } = preprocessPous(
        args.projectData,
        false,
        (level, message) => {
          onProgress({ stage: 'st', message, level })
        },
      )

      if (validationFailed) {
        return { success: false, error: 'POU validation failed.' }
      }

      const ipcData = toIpcProjectData(processedData)

      return new Promise<DebugCompileResult>((resolve) => {
        let hasError = false
        let lastError = ''

        window.bridge.runDebugCompilation(
          [args.projectPath, args.boardTarget, ipcData as never],
          (data: Record<string, unknown>) => {
            if (data.closePort) {
              onProgress({ stage: 'done', message: 'Debug compilation complete' })
              resolve(hasError ? { success: false, error: lastError } : { success: true })
              return
            }

            if (data.message) {
              const message = decodeMessage(data.message)

              if (data.logLevel === 'error') {
                hasError = true
                lastError = message
                onProgress({ stage: 'error', message, level: 'error' })
              } else {
                onProgress({ stage: inferStage(message), message, level: (data.logLevel as string) ?? 'info' })
              }
            }
          },
        )
      })
    },

    async exportProjectXml(args: ExportXmlArgs): Promise<Result<{ message: string }>> {
      const ipcData = toIpcProjectData(args.projectData)
      const result = await window.bridge.exportProjectXml(args.projectPath, ipcData as never, args.format)

      if (result.success) {
        return { success: true, message: result.message }
      }
      return { success: false, error: result.message }
    },

    async compileLibrary(
      args: CompileLibraryArgs,
      onProgress: (event: CompileProgressEvent) => void,
    ): Promise<CompileLibraryResult> {
      const ipcData = toIpcProjectData(args.projectData)

      return new Promise<CompileLibraryResult>((resolve) => {
        let finalResult: CompileLibraryResult | undefined
        let hasError = false
        let lastError = ''

        window.bridge.runCompileLibrary(
          [args.projectPath, ipcData as never],
          (data: Record<string, unknown>) => {
            if (data.libraryBuildResult) {
              finalResult = data.libraryBuildResult as CompileLibraryResult
            }

            if (data.closePort) {
              onProgress({
                stage: finalResult?.success ? 'done' : 'error',
                message: finalResult?.success
                  ? `Library built: ${finalResult.stlibPath ?? ''}`
                  : finalResult?.error ?? lastError ?? 'Library build failed.',
              })
              resolve(
                finalResult ?? {
                  success: false,
                  error: hasError ? lastError : 'Library build closed unexpectedly.',
                },
              )
              return
            }

            if (data.message) {
              const message = decodeMessage(data.message)
              if (data.logLevel === 'error') {
                hasError = true
                lastError = message
                onProgress({ stage: 'error', message, level: 'error' })
              } else {
                onProgress({
                  stage: inferStage(message),
                  message,
                  level: (data.logLevel as string) ?? 'info',
                })
              }
            }
          },
        )
      })
    },
  }
}

export { decodeMessage, inferStage, portPouToIpcPou, toIpcProjectData }
