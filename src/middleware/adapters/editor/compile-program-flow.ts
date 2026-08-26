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

import {
  findLibrariesMissingNativeSources,
  injectLibraryBlocks,
} from '../../../backend/shared/library/inject-library-blocks'
import { preprocessPous } from '../../../backend/shared/utils/PLC/preprocess-pous'
import type { CompileProgramArgs } from '../../shared/ports/compiler-port'
import type { StlibArchiveDTO } from '../../shared/ports/library-port'
import type { BoardInfo, CompileProgressEvent, CompileResult, StructuredCompileError } from '../../shared/ports/types'
import { resolveTargetCapabilities } from '../../shared/utils/target-capabilities'
import type { IpcProjectData } from './compiler-adapter'
import { decodeMessage, inferStage, toIpcProjectData } from './compiler-adapter'

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

  // `pythonFunctionBlocks` has always described the contract (v3 / v4 run them,
  // the Simulator stubs them, arduino-cli targets reject them); until now
  // nothing enforced the rejection half, so a Python block on an Arduino board
  // reached the board's C++ toolchain and failed there instead.
  //
  // Only gate on a board we actually resolved: `resolveTargetCapabilities`
  // returns an all-false block for `undefined`, so gating on an unresolved
  // board would turn a catalog lookup miss into a Python build failure.
  const pythonSupport = boardInfo
    ? { supported: resolveTargetCapabilities(boardInfo).pythonFunctionBlocks, targetLabel: args.boardTarget }
    : undefined

  // Graft library-supplied C/C++ and Python blocks into the project's
  // POU list before preprocessing.  They behave like user-defined
  // native POUs from this point on — same `preprocessPous` branch,
  // same `c_blocks.h` / `c_blocks_code.cpp` and Python-bridge
  // generation downstream.  See `injectLibraryBlocks` for the renaming
  // contract and for why the archive ships source rather than the
  // already-lowered ST.
  const archives = await transport.loadAllLibraries()

  // A native block with no source cannot be built by any consumer.
  const missingSources = findLibrariesMissingNativeSources(args.projectData, archives)
  if (missingSources.length > 0) {
    const error =
      `These libraries ship C/C++ or Python blocks without their source, so they cannot be built: ${missingSources.join(', ')}. ` +
      'Reinstall them from a build that includes sources.'
    onProgress({ stage: 'st', message: error, level: 'error' })
    return { success: false, error }
  }

  const dataWithLibCpp = injectLibraryBlocks(args.projectData, archives)

  // Preprocess POUs (comment wrapping, Python->ST stubs, C++ validation/ST generation)
  const {
    projectData: processedData,
    validationFailed,
    validationError,
  } = preprocessPous(
    dataWithLibCpp,
    isSimulator,
    (level, message) => {
      onProgress({ stage: 'st', message, level })
    },
    pythonSupport,
    // The archives are already loaded for the C++ graft above. A native block
    // declaring `ton0 : TON` needs that block's pin list before the instance can
    // cross into Python, and the manifest is where it lives.
    archives.map((archive) => ({ functionBlocks: archive.manifest.functionBlocks })),
  )

  if (validationFailed) {
    return {
      success: false,
      error: validationError ?? 'POU validation failed. Check C/C++ code for missing setup()/loop() functions.',
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
      // `typeof`, not a cast: callers treat `firmwarePath` as a filesystem path
      // and hand it to the simulator, so a non-string arriving here would travel
      // a long way before failing, and far from the message that produced it.
      if (typeof data.simulatorFirmwarePath === 'string' && data.simulatorFirmwarePath.length > 0) {
        hexPath = data.simulatorFirmwarePath
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
      if (typeof data.plcStatus === 'string') {
        onProgress({ stage: 'arduino', message: '', plcStatus: data.plcStatus })
      }

      if (data.message) {
        const message = decodeMessage(data.message)
        // Structured CompileError travels alongside the formatted
        // text whenever the compiler-module's strucpp failure
        // path emits a per-error log entry.  Forward it as-is
        // so the console can drive click-to-open from the
        // structured fields rather than parsing text.
        const compileError = asStructuredCompileError(data.compileError)

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
            level: typeof data.logLevel === 'string' ? data.logLevel : 'info',
            ...(compileError ? { compileError } : {}),
          })
        }
      }
    })
  })
}

/**
 * Accept a structured diagnostic only if it carries the fields consumers read.
 *
 * This one is more than a `typeof` because the console navigates with it: a
 * partial object cast to the type produced `NaN` line numbers and a
 * click-to-open that jumped nowhere. The narrow check — a message plus real
 * coordinates — is exactly what the click needs, and anything less is dropped so
 * the plain text still shows.
 */
function asStructuredCompileError(value: unknown): StructuredCompileError | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate: Record<string, unknown> = { ...value }
  if (typeof candidate.message !== 'string') return undefined
  if (typeof candidate.line !== 'number' || typeof candidate.column !== 'number') return undefined
  if (candidate.severity !== 'error' && candidate.severity !== 'warning' && candidate.severity !== 'info') {
    return undefined
  }
  // Rebuilt field by field rather than spread wholesale, so an unexpected extra
  // key cannot ride along into the event.
  const error: StructuredCompileError = {
    message: candidate.message,
    line: candidate.line,
    column: candidate.column,
    severity: candidate.severity,
  }
  if (typeof candidate.endLine === 'number') error.endLine = candidate.endLine
  if (typeof candidate.endColumn === 'number') error.endColumn = candidate.endColumn
  if (typeof candidate.file === 'string') error.file = candidate.file
  if (typeof candidate.pouName === 'string') error.pouName = candidate.pouName
  if (candidate.pouKind === 'PROGRAM' || candidate.pouKind === 'FUNCTION' || candidate.pouKind === 'FUNCTION_BLOCK') {
    error.pouKind = candidate.pouKind
  }
  if (candidate.section === 'interface' || candidate.section === 'var-block' || candidate.section === 'body') {
    error.section = candidate.section
  }
  if (typeof candidate.bodyLine === 'number') error.bodyLine = candidate.bodyLine
  if (typeof candidate.variableName === 'string') error.variableName = candidate.variableName
  return error
}
