/**
 * `openplc-cli simulate <project>`: the editor's Play on the OpenPLC Simulator, without a window.
 *
 * Builds through the same flow as `compile`, then runs the module the way the editor's Play does: interpreters for
 * the project's Python blocks are prepared first and the PLC starts once they are ready. The run's Console (the
 * program's output and every Python block's, prefixed with its name) is printed until Ctrl+C.
 *
 * The toolchain and the Python runtime load on first need: a project with no Python block never loads Python. A
 * toolchain that cannot load ends the command; a Python runtime that cannot load does not: the PLC runs, and the
 * Python blocks report why they cannot start. Ctrl+C before the run starts (during the build or the Python
 * preparation) ends the command as interrupted, not as a finished run.
 */

import type { PythonRuntimeReadiness } from '@root/backend/shared/python/prepare-python'
import type { SimulatorLogStream } from '@root/backend/shared/simulator/wasm-simulator-module'
import { countPythonBlockInstances } from '@root/frontend/utils/python/count-python-block-instances'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'
import type { BuildRequest, CompiledProject, FailedBuild } from './build'

export const SIMULATOR_BOARD = 'OpenPLC Simulator'

/** What `simulate` drives: the editor's simulator with its Python blocks. */
export interface SimulatorRun {
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null
  onStopped: ((reason: string) => void) | null
  preparePython(count: number): Promise<void>
  loadAndRun(module: Uint8Array): Promise<void>
  stop(): void
}

export interface SimulateDependencies {
  build: (request: BuildRequest) => Promise<CompiledProject | FailedBuild>
  readModule: (path: string) => Promise<Uint8Array>
  createSimulator: () => SimulatorRun
  /** Loads the Python runtime, booting no interpreter. */
  loadPython: () => Promise<PythonRuntimeReadiness>
  /** Resolves when the user asks the run to end. */
  interrupted: () => Promise<void>
}

export async function runSimulate(
  args: ParsedArgs,
  reporter: Reporter,
  deps: SimulateDependencies,
): Promise<CliResult> {
  const projectPath = args.positionals[0] ?? stringFlag(args, 'project')
  if (!projectPath) {
    return reporter.failure(
      {
        code: ErrorCode.MissingArgument,
        message: 'Give the project directory, e.g. `openplc-cli simulate ./my-project`',
      },
      ExitCode.Usage,
    )
  }

  const INTERRUPTED = Symbol('interrupted')
  const interruption = deps.interrupted().then((): typeof INTERRUPTED => INTERRUPTED)
  const unlessInterrupted = <T>(work: Promise<T>): Promise<T | typeof INTERRUPTED> => Promise.race([work, interruption])
  const interruptedEarly = (): CliResult =>
    reporter.failure(
      { code: ErrorCode.Interrupted, message: 'Interrupted before the simulation started' },
      ExitCode.Interrupted,
    )

  const built = await unlessInterrupted(
    deps.build({
      projectPath,
      target: SIMULATOR_BOARD,
      mayCreateUser: false,
      withUpload: false,
      compileOnly: false,
      cleanBuild: boolFlag(args, 'clean'),
      autoApprove: false,
    }),
  )
  if (built === INTERRUPTED) return interruptedEarly()
  if (!built.ok) return built.result
  if (!built.firmwarePath) {
    return reporter.failure(
      { code: ErrorCode.CompileFailed, message: 'The simulator build produced no module' },
      ExitCode.CompileFailed,
    )
  }
  const module = await deps.readModule(built.firmwarePath)

  const simulatorFailure = (message: string): CliResult =>
    reporter.failure({ code: ErrorCode.SimulatorFailed, message }, ExitCode.TargetError)

  const pythonBlocks = countPythonBlockInstances(built.project.compileReady)
  if (pythonBlocks > 0) {
    reporter.progress('Loading the Python runtime…')
    const python = await unlessInterrupted(deps.loadPython())
    if (python === INTERRUPTED) return interruptedEarly()
    if (!python.ok) reporter.console(python.message, 'stderr')
  }

  const simulator = deps.createSimulator()
  simulator.onLog = (line, stream) => reporter.console(line, stream)
  let stoppedOnItsOwn: (reason: string) => void = () => undefined
  const stopped = new Promise<string>((resolve) => (stoppedOnItsOwn = resolve))
  simulator.onStopped = (reason) => stoppedOnItsOwn(reason)

  const start = async (): Promise<void> => {
    if (pythonBlocks > 0) await simulator.preparePython(pythonBlocks)
    await simulator.loadAndRun(module)
  }
  try {
    if ((await unlessInterrupted(start())) === INTERRUPTED) {
      simulator.stop()
      return interruptedEarly()
    }
  } catch (error) {
    simulator.stop()
    const reason = error instanceof Error ? error.message : String(error)
    return simulatorFailure(`The simulator could not start: ${reason}`)
  }

  const started = Date.now()
  reporter.progress(`Simulating "${built.project.name}". Press Ctrl+C to stop.`)
  const ending = await Promise.race([
    interruption.then(() => ({ kind: 'interrupted' as const })),
    stopped.then((reason) => ({ kind: 'stopped' as const, reason })),
  ])
  simulator.stop()

  if (ending.kind === 'stopped') return simulatorFailure(ending.reason)
  const ranMs = Date.now() - started
  return reporter.success(
    {
      project: built.project.name,
      projectPath: built.project.projectPath,
      target: SIMULATOR_BOARD,
      pythonBlocks,
      ranMs,
    },
    () => `Simulation of "${built.project.name}" stopped after ${(ranMs / 1000).toFixed(1)} s.`,
  )
}

/** Resolves on the first SIGINT (Ctrl+C) or SIGTERM. */
export function processInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off('SIGINT', done)
      process.off('SIGTERM', done)
      resolve()
    }
    process.on('SIGINT', done)
    process.on('SIGTERM', done)
  })
}
