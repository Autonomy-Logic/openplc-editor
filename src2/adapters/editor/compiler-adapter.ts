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

import type {
  CompileProgramArgs,
  CompilerPort,
  DebugCompileArgs,
  ExportXmlArgs,
} from '../../frontend/providers/platform/ports/compiler-port'
import type {
  CompileProgressEvent,
  CompileResult,
  DebugCompileResult,
  PLCPou,
  PLCProjectData,
  Result,
} from '../../frontend/providers/platform/ports/types'

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
function toIpcProjectData(data: PLCProjectData): IpcProjectData {
  return {
    dataTypes: data.dataTypes,
    pous: data.pous.map(portPouToIpcPou),
    configuration: data.configurations,
  }
}

/** Best-effort stage inference from compiler log messages. */
function inferStage(message: string): CompileProgressEvent['stage'] {
  const lower = message.toLowerCase()
  if (lower.includes('xml') || lower.includes('generating xml')) return 'xml'
  if (lower.includes('structured text') || lower.includes('.st') || lower.includes('transpil')) return 'st'
  if (lower.includes('iec2c') || lower.includes('generating c') || lower.includes('c code')) return 'c'
  if (lower.includes('glue')) return 'glue'
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

      const ipcData = toIpcProjectData(args.projectData)

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
            null, // runtimeIpAddress — runtime upload handled by RuntimePort
            null, // jwtToken
          ],
          (data: Record<string, unknown>) => {
            if (data.closePort) {
              onProgress({ stage: 'done', message: 'Compilation complete' })
              resolve(
                hasError
                  ? { success: false, error: lastError }
                  : { success: true, message: 'Compilation complete', hexPath },
              )
              return
            }

            if (data.simulatorFirmwarePath) {
              hexPath = data.simulatorFirmwarePath as string
            }

            if (data.message) {
              const message = typeof data.message === 'string' ? data.message : String(data.message)

              if (data.logLevel === 'error') {
                hasError = true
                lastError = message
                onProgress({ stage: 'error', message })
              } else {
                onProgress({ stage: inferStage(message), message })
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
      const ipcData = toIpcProjectData(args.projectData)

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
              const message = typeof data.message === 'string' ? data.message : String(data.message)

              if (data.logLevel === 'error') {
                hasError = true
                lastError = message
                onProgress({ stage: 'error', message })
              } else {
                onProgress({ stage: inferStage(message), message })
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
  }
}

export { portPouToIpcPou, toIpcProjectData, inferStage }
