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
import type { StlibArchiveDTO } from '../../shared/ports/library-port'
import type {
  CompileLibraryResult,
  CompileProgressEvent,
  CompileResult,
  DebugCompileResult,
  PLCPou,
  PLCProjectData,
  PLCVariable,
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

/**
 * Graft any library-supplied C/C++ function blocks into the
 * project's POU list before the standard preprocessor runs.  Each
 * library archive's `cppBlocks` entry becomes a synthesized
 * `PLCPou` with `body.language: 'cpp'` — from there it flows
 * through `preprocessPous` exactly like a user-defined C++ POU
 * (ST stub generation, `originalCppPous` sidecar, downstream
 * `c_blocks.h` / `c_blocks_code.cpp` generation, link-time
 * resolution).  Strucpp never sees the C++ — it sees the
 * generated ST stub that calls into `c_blocks.h` externs.
 *
 * **Renaming**: each block's name is prefixed with the library's
 * manifest name (`${library_name}__${block_name}`) so two
 * different libraries can ship a block called `Foo` without
 * collision, and so a consumer's user-defined POU can also be
 * called `Foo` without colliding with a library's block.  The
 * editor's library-tree picker surfaces the prefixed name, so the
 * user authors their ST against that name directly — no parse +
 * rewrite of the user's source.
 *
 * Symbol-level renames inside the synthesized POU (the struct
 * `<NAME>_VARS`, the C functions `<name>_setup` /
 * `<name>_loop`) happen automatically because
 * `generateCppSTCode` / `generateCBlocksHeader` /
 * `generateCBlocksCode` all derive their names from
 * `pou.name`.
 */
function injectLibraryCppBlocks(projectData: PLCProjectData, archives: StlibArchiveDTO[]): PLCProjectData {
  if (!projectData.libraries || projectData.libraries.length === 0) return projectData

  const enabledNames = new Set(projectData.libraries.map((ref) => ref.name))
  const synthesized: PLCPou[] = []

  for (const archive of archives) {
    if (!archive.cppBlocks || archive.cppBlocks.length === 0) continue
    if (!enabledNames.has(archive.manifest.name)) continue
    for (const block of archive.cppBlocks) {
      // `variables` rides through the StlibArchiveDTO as `unknown[]`
      // by design — the manifest layer doesn't know our PLCVariable
      // shape.  The on-disk archives are produced by THIS editor's
      // own save pipeline using the same PLCVariable type, so the
      // narrowing here matches reality at runtime.
      synthesized.push({
        name: `${archive.manifest.name}__${block.name}`,
        pouType: 'function-block',
        interface: { variables: block.variables as PLCVariable[] },
        body: { language: 'cpp', value: block.code },
        documentation: block.documentation ?? '',
      })
    }
  }

  if (synthesized.length === 0) return projectData

  return { ...projectData, pous: [...projectData.pous, ...synthesized] }
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

      // Graft library-supplied C++ blocks into the project's POU
      // list before preprocessing.  They behave like user-defined
      // C++ POUs from this point on — same `preprocessPous` branch,
      // same `c_blocks.h` / `c_blocks_code.cpp` generation
      // downstream.  See `injectLibraryCppBlocks` for the renaming
      // contract.
      const archives = (await window.bridge.loadAllLibraries()) as StlibArchiveDTO[]
      const dataWithLibCpp = injectLibraryCppBlocks(args.projectData, archives)

      // Preprocess POUs (comment wrapping, Python->ST stubs, C++ validation/ST generation)
      const { projectData: processedData, validationFailed } = preprocessPous(
        dataWithLibCpp,
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
        let settled = false

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
            args.communicationPort ?? null,
            // User-authored configuration-screen data — threaded
            // through to the shared compile pipeline so it can emit
            // `vpp_config.h` for arduino-cli VPP boards (Arduino
            // Opta, P1AM).  The pipeline gates emission on the
            // board's resolved `vppIo` capability; non-VPP boards
            // ignore this argument and the field is a no-op.
            args.vendorScreenData ?? null,
          ],
          (data: Record<string, unknown>) => {
            // Extract simulator firmware path BEFORE the closePort early return,
            // because the backend sends both fields in the same message.
            if (data.simulatorFirmwarePath) {
              hexPath = data.simulatorFirmwarePath as string
              onProgress({ stage: 'done', message: 'Simulator firmware ready', firmwarePath: hexPath })
            }

            if (data.closePort) {
              if (settled) return
              settled = true
              if (!hasError) {
                onProgress({ stage: 'done', message: 'Compilation complete' })
              }
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
              const compileError = data.compileError as CompileProgressEvent['compileError'] | undefined

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
      // Same library-C++ injection as the program build path.
      const archives = (await window.bridge.loadAllLibraries()) as StlibArchiveDTO[]
      const dataWithLibCpp = injectLibraryCppBlocks(args.projectData, archives)

      // Preprocess for debug compilation too
      const { projectData: processedData, validationFailed } = preprocessPous(
        dataWithLibCpp,
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
      // Two preprocess passes — the library build and the
      // simulator-target verification want different Python
      // treatment, and `preprocessPous` is the only place that
      // decision lives.
      //
      //   - `isSimulator: false` for the LIBRARY BUILD itself.
      //     Python POUs go through `injectPythonCode` +
      //     `generateSTCode`, becoming self-contained ST with the
      //     Python source embedded as strings — exactly the shape
      //     strucpp compiles for a runtime-target program build.
      //     The `.stlib` ships real Python code, usable by any
      //     consumer that targets a Python-capable runtime.
      //
      //   - `isSimulator: true` for the VERIFICATION compile.
      //     Python POUs become `first_run := 0;` no-op stubs.  The
      //     AVR simulator has no Python interpreter, so passing
      //     full-Python-as-ST through to arduino-cli would fail at
      //     link time (the strucpp-emitted code calls into
      //     Python loader externs the simulator runtime doesn't
      //     ship).  Stubbing keeps the verify compile honest: it
      //     still proves the library's ST/IL/data-types compile
      //     cleanly to AVR — the only thing it can't prove is
      //     that the Python POUs run, and we accept that.
      //
      // The renderer-side `onProgress` log channel only sees the
      // build pass's preprocess output to avoid duplicate "Found
      // Python POU…" lines.
      const buildResult = preprocessPous(args.projectData, false, (level, message) => {
        onProgress({ stage: 'st', message, level })
      })
      if (buildResult.validationFailed) {
        return {
          success: false,
          error: 'POU validation failed. Check C/C++ code for missing setup()/loop() functions.',
        }
      }
      const verifyResult = preprocessPous(args.projectData, true, () => {
        // Silent — same project gets logged once via the build
        // pass; a second round of "Found …" lines is noise.
      })
      const ipcDataForBuild = toIpcProjectData(buildResult.projectData)
      const ipcDataForVerify = toIpcProjectData(verifyResult.projectData)

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
          [args.projectPath, ipcDataForBuild as never, ipcDataForVerify as never, args.cleanBuild ?? false],
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
