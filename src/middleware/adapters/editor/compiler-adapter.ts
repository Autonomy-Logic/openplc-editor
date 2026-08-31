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

import {
  findLibrariesMissingNativeSources,
  injectLibraryBlocks,
} from '../../../backend/shared/library/inject-library-blocks'
import { collectNativePous, type NativePouRef } from '../../../backend/shared/library/native-pou-list'
import { preprocessPous } from '../../../backend/shared/utils/PLC/preprocess-pous'
import type {
  CompileLibraryArgs,
  CompileProgramArgs,
  CompilerPort,
  DebugCompileArgs,
  ExportXmlArgs,
} from '../../shared/ports/compiler-port'
import type { StlibArchiveDTO } from '../../shared/ports/library-port'
import type {
  CompileLibraryResult,
  CompileProgressEvent,
  CompileResult,
  DebugCompileResult,
  PLCPou,
  PLCProjectData,
  Result,
} from '../../shared/ports/types'
import { resolveTargetCapabilities } from '../../shared/utils/target-capabilities'
import { compileProgramFlow } from './compile-program-flow'

/**
 * Shape of the project data expected by the editor's IPC bridge.
 *
 * This interface and `toIpcProjectData` below are a field-by-field restatement
 * of `PLCProjectData`, so anything not named in BOTH is silently dropped on the
 * way to the main process — the receiving end casts through
 * `as unknown as SchemaProjectData`, which is why the omission is not a compile
 * error. Adding a field to the project model means adding it here too.
 */
export interface IpcProjectData {
  dataTypes: PLCProjectData['dataTypes']
  globalVariableLists?: PLCProjectData['globalVariableLists']
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
// Exported so the headless CLI can run the SAME pre-compile chain the renderer
// runs (inject library C++ blocks -> preprocess POUs -> convert to the IPC/schema
// shape). Skipping any step compiles a different program from the same sources.
function toIpcProjectData(data: PLCProjectData & { originalCppPous?: unknown[] }): IpcProjectData {
  return {
    dataTypes: data.dataTypes,
    // Without this the main process never sees a Global Variable List, and every
    // `GVL.Member` in the project fails to compile with "Undeclared variable
    // 'GVL'" — the transpiler emits the backing struct, its instance and the
    // per-POU `VAR_EXTERNAL` from this field alone.
    globalVariableLists: data.globalVariableLists,
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

/**
 * Argument tuple for the `compiler:run-compile-library` channel.
 *
 * Declared here, beside `IpcProjectData`, for the same reason
 * `CompileProgramIpcArgs` is: the renderer bridge and the main-process
 * handler both name this type instead of restating a loose
 * `Array<string | ... >`, so adding, removing or reordering a slot is a
 * compile error on every side at once rather than a cast that silently
 * still fits.  The main process still VALIDATES what arrives — a type is
 * a statement about our own callers, not a guarantee about the channel.
 */
export type CompileLibraryIpcArgs = [
  projectPath: string,
  /** Build-pass project data, `preprocessPous` with `isSimulator: false`. */
  projectData: IpcProjectData,
  /**
   * Native (C/C++, Python) POUs collected from the RAW project data before
   * preprocessing lowered every native body to bridge ST — the main process
   * cannot derive this itself.  See `collectNativePous`.
   */
  nativePous: NativePouRef[],
]

export function createEditorCompilerAdapter(): CompilerPort {
  return {
    /**
     * The Build / Build & Upload flow.
     *
     * The orchestration lives in `compileProgramFlow` so the headless CLI enters
     * the same sequence through its own transport — board resolution, the C++
     * block graft, POU preprocessing and the pipeline call are shared, not
     * restated per front end.
     */
    compileProgram(
      args: CompileProgramArgs,
      onProgress: (event: CompileProgressEvent) => void,
    ): Promise<CompileResult> {
      return compileProgramFlow(
        args,
        {
          getAvailableBoards: () => window.bridge.getAvailableBoards(),
          loadAllLibraries: async () => (await window.bridge.loadAllLibraries()) as StlibArchiveDTO[],
          runCompileProgram: (compileArgs, onMessage) => window.bridge.runCompileProgram(compileArgs, onMessage),
        },
        onProgress,
      )
    },

    async compileForDebug(
      args: DebugCompileArgs,
      onProgress: (event: CompileProgressEvent) => void,
    ): Promise<DebugCompileResult> {
      // Same graft as the program build path — a debug compile has to see
      // the identical POU set or the debug map won't match the firmware.
      const archives = (await window.bridge.loadAllLibraries()) as StlibArchiveDTO[]

      const missingSources = findLibrariesMissingNativeSources(args.projectData, archives)
      if (missingSources.length > 0) {
        const error =
          `These libraries ship C/C++ or Python blocks without their source, so they cannot be built: ${missingSources.join(', ')}. ` +
          'Reinstall them from a build that includes sources.'
        onProgress({ stage: 'st', message: error, level: 'error' })
        return { success: false, error }
      }

      const dataWithLibCpp = injectLibraryBlocks(args.projectData, archives)

      // Preprocess for debug compilation too. Same target gate as the build
      // path — a Python block is no more loadable on an Arduino board when the
      // build is for debugging.
      const debugBoards = await window.bridge.getAvailableBoards()
      const debugBoardInfo = debugBoards.get(args.boardTarget)
      const {
        projectData: processedData,
        validationFailed,
        validationError,
      } = preprocessPous(
        dataWithLibCpp,
        false,
        (level, message) => {
          onProgress({ stage: 'st', message, level })
        },
        debugBoardInfo
          ? {
              supported: resolveTargetCapabilities(debugBoardInfo).pythonFunctionBlocks,
              targetLabel: args.boardTarget,
            }
          : undefined,
        // The same FB pin source the build and library paths pass. Without it
        // `libraries` defaults to `[]`, `describeShmLeaves` cannot resolve a
        // library block, and a Python POU declaring e.g. `ton0 : TON` compiled
        // for upload and then failed the debug compile with "cannot exchange
        // these variables" — the one path where the archives were already
        // loaded and simply not forwarded.
        archives.map((archive) => ({ functionBlocks: archive.manifest.functionBlocks })),
      )

      if (validationFailed) {
        return { success: false, error: validationError ?? 'POU validation failed.' }
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
      // ONE preprocess pass, `isSimulator: false`.  Python POUs go
      // through `injectPythonCode` + `generateSTCode`, becoming
      // self-contained ST with the Python source embedded as strings —
      // exactly the shape strucpp compiles for a runtime-target program
      // build.  The `.stlib` ships real Python code, usable by any
      // consumer that targets a Python-capable runtime.
      //
      // There used to be a second `isSimulator: true` pass feeding an
      // avr-gcc verification compile, which stubbed Python POUs to
      // no-ops because the AVR simulator has no interpreter.  The
      // verification stage is gone: the build is target-neutral, and
      // running a library goes through the debug harness instead.
      //
      // Taken BEFORE preprocessing: that step lowers every native body to
      // bridge ST and rewrites the language tag with it, leaving nothing to
      // identify a native POU by.  Sent over IPC because the main process
      // only ever sees the already-lowered data.
      const nativePous = collectNativePous(args.projectData)

      // A library's own Python POU may hold a function block instance too, so it
      // needs the same pin source a project build gets.
      const libraryArchives = (await window.bridge.loadAllLibraries()) as StlibArchiveDTO[]
      const fbSources = libraryArchives.map((archive) => ({ functionBlocks: archive.manifest.functionBlocks }))

      const buildResult = preprocessPous(
        args.projectData,
        false,
        (level, message) => {
          onProgress({ stage: 'st', message, level })
        },
        undefined,
        fbSources,
      )
      if (buildResult.validationFailed) {
        return {
          success: false,
          // `preprocessPous` returns `validationError` so the caller stops
          // guessing at the cause. This path can now fail for a Python reason —
          // the shm refusals are not gated on target support — and reporting
          // every one of those as "check C/C++ code for setup()/loop()" sent
          // the user to the wrong file.
          error:
            buildResult.validationError ??
            'POU validation failed. Check C/C++ code for missing setup()/loop() functions.',
        }
      }
      const ipcDataForBuild = toIpcProjectData(buildResult.projectData)

      return new Promise<CompileLibraryResult>((resolve) => {
        let finalResult: CompileLibraryResult | undefined
        let hasError = false
        let lastError = ''

        // Protocol:
        //   - The backend posts log messages (info / warning /
        //     error) one by one, forwarded to onProgress.
        //   - The backend posts ONE final message carrying
        //     `libraryBuildResult` (no closePort flag), then closes
        //     the port after a small delay so the result is
        //     guaranteed to be delivered first.
        //   - The renderer-side bridge fires a synthetic
        //     `{closePort: true}` callback on the MessagePort's
        //     `'close'` event — that's the sole "build done"
        //     signal the adapter resolves on.
        window.bridge.runCompileLibrary(
          [args.projectPath, ipcDataForBuild, nativePous],
          (data: Record<string, unknown>) => {
            if (data.libraryBuildResult) {
              finalResult = data.libraryBuildResult as CompileLibraryResult
              return
            }

            if (data.closePort) {
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
