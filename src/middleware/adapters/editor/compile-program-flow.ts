/**
 * The build flow a Build / Build & Upload click starts.
 *
 * This is the orchestration that used to live inside the editor's
 * `CompilerPort.compileProgram`: resolve the board, graft library-supplied C++
 * blocks in, preprocess POUs, convert to the IPC/schema shape, then drive the
 * compile pipeline and translate its message stream into `CompileProgressEvent`s.
 *
 * It is a standalone function taking a `CompileProgramTransport` so the SAME
 * flow runs from two front ends: the renderer adapter supplies a transport
 * backed by `window.bridge`, and the headless CLI supplies one backed by the
 * main-process modules directly. A CLI command therefore kicks off exactly the
 * sequence the button click does — board resolution included — instead of
 * reassembling the steps and drifting on the details (which core the board
 * declares, whether a POU needs preprocessing, what shape the pipeline expects).
 */

import { preprocessPous } from '../../../backend/shared/utils/PLC/preprocess-pous'
import type { CompileProgramArgs } from '../../shared/ports/compiler-port'
import type { StlibArchiveDTO } from '../../shared/ports/library-port'
import type { BoardInfo, CompileProgressEvent, CompileResult } from '../../shared/ports/types'
import type { IpcProjectData } from './compiler-adapter'
import { decodeMessage, inferStage, injectLibraryCppBlocks, toIpcProjectData } from './compiler-adapter'

/**
 * The compile pipeline's argument list, by position.
 *
 * The pipeline is driven by a positional array rather than an object, and that
 * array was previously re-declared at every hop — as
 * `Array<string | PLCProjectData>` in the IPC handler, as
 * `Array<string | boolean | null | PLCProjectData | Record<string, unknown>>` in
 * the renderer bridge, and as `Array<string | null | boolean | undefined |
 * object>` here. Four unions for one list: none of them agreed, so passing the
 * list from one hop to the next needed `as never`, and a cast on a positional
 * array silences exactly the mistake that array invites — a slot in the wrong
 * place, or one type where another was meant.
 *
 * A labelled tuple states the arity and the type of every slot once, so a
 * reordering is a compile error instead of a corrupt build, and the casts are
 * gone rather than justified. Mutable (not `readonly`) on purpose: the compiler
 * module still declares the loose array, and a `readonly` tuple would not be
 * assignable to it, which would just move the cast rather than remove it.
 */
export type CompileProgramIpcArgs = [
  projectPath: string,
  boardTarget: string,
  boardCore: string | null,
  compileOnly: boolean,
  projectData: IpcProjectData,
  runtimeIpAddress: string | null,
  runtimeJwtToken: string | null,
  cleanBuild: boolean,
  communicationPort: string | null,
  /**
   * User-authored configuration-screen data — threaded through to the shared
   * compile pipeline so it can emit `vpp_config.h` for arduino-cli VPP boards
   * (Arduino Opta, P1AM). The pipeline gates emission on the board's resolved
   * `vppIo` capability; non-VPP boards ignore this slot and it is a no-op.
   */
  vendorScreenData: Record<string, unknown> | null,
]

/**
 * What the flow needs from its platform. Three calls, deliberately: anything
 * more and the flow would be describing a platform rather than a build.
 */
export interface CompileProgramTransport {
  /** Board catalogue — hals.json entries plus installed VPP packages. */
  getAvailableBoards: () => Promise<Map<string, BoardInfo>>
  /** Every installed library archive, for the C++-block graft. */
  loadAllLibraries: () => Promise<StlibArchiveDTO[]>
  /**
   * Start the compile pipeline and stream its messages back. Fire-and-forget:
   * completion is signalled by a `closePort` message, not by resolution.
   */
  runCompileProgram: (compileArgs: CompileProgramIpcArgs, onMessage: (data: Record<string, unknown>) => void) => void
}

export async function compileProgramFlow(
  args: CompileProgramArgs,
  transport: CompileProgramTransport,
  onProgress: (event: CompileProgressEvent) => void,
): Promise<CompileResult> {
  const boards = await transport.getAvailableBoards()
  const boardInfo = boards.get(args.boardTarget)
  const boardCore = boardInfo?.core ?? null
  const isSimulator = args.isSimulator ?? boardInfo?.compiler === 'simulator'

  // Graft library-supplied C++ blocks into the project's POU
  // list before preprocessing.  They behave like user-defined
  // C++ POUs from this point on — same `preprocessPous` branch,
  // same `c_blocks.h` / `c_blocks_code.cpp` generation
  // downstream.  See `injectLibraryCppBlocks` for the renaming
  // contract.
  const archives = await transport.loadAllLibraries()
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

    const compileArgs: CompileProgramIpcArgs = [
      args.projectPath,
      args.boardTarget,
      boardCore,
      args.compileOnly ?? false,
      ipcData,
      args.runtimeIpAddress ?? null,
      args.runtimeJwtToken ?? null,
      args.cleanBuild ?? false,
      args.communicationPort ?? null,
      args.vendorScreenData ?? null,
    ]

    transport.runCompileProgram(compileArgs, (data: Record<string, unknown>) => {
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
          hasError ? { success: false, error: lastError } : { success: true, message: 'Compilation complete', hexPath },
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
    })
  })
}
