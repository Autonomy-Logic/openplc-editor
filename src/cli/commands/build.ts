/**
 * `openplc compile` and `openplc upload` — the same pipeline, one flag apart.
 *
 * Both run `CompilerModule.compileProgram`, the exact call the GUI's build
 * button makes. `compile` passes `compileOnly: true` and no runtime address, so
 * the pipeline stops after producing artifacts; `upload` logs in first and
 * hands the pipeline the address and token, so its existing upload step runs.
 *
 * There is deliberately no separate upload implementation. Framing the
 * multipart body, choosing the bundle, and the post-upload restart are all
 * pipeline concerns already solved once, and a second copy would only be
 * exercised by the CLI — where a mistake would surface as a device that quietly
 * runs the wrong program.
 */

import { CompilerModule } from '@root/backend/editor/compiler'
import { LibraryManagerModule } from '@root/backend/editor/library-manager'
import { HardwareModule } from '@root/backend/editor/hardware'
import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import { preprocessPous } from '@root/backend/shared/utils/PLC/preprocess-pous'
import { injectLibraryCppBlocks, toIpcProjectData } from '@root/middleware/adapters/editor/compiler-adapter'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { createHeadlessCompileBridge, createProgressChannel } from '../compile/headless-bridge'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'
import { loadProject } from '../project/load'

/** One line of compiler output, as posted to the progress channel. */
interface CompileEvent {
  logLevel?: 'info' | 'warning' | 'error'
  message?: string
  closePort?: boolean
}

export interface BuildOptions {
  /** True for `upload`: connect to a runtime and let the pipeline flash it. */
  withUpload: boolean
}

export async function runBuild(args: ParsedArgs, reporter: Reporter, options: BuildOptions): Promise<CliResult> {
  const projectPath = args.positionals[0] ?? stringFlag(args, 'project')
  if (!projectPath) {
    return reporter.failure(
      { code: ErrorCode.MissingArgument, message: 'Give the project directory, e.g. `openplc compile ./my-project`' },
      ExitCode.Usage,
    )
  }

  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound)
  }
  const project = loaded.project
  for (const warning of project.warnings) reporter.progress(`warning: ${warning}`)

  // The project remembers its own board; --target overrides it so one fixture
  // can be built for several targets in a test matrix.
  const target = stringFlag(args, 'target') ?? project.board
  if (!target) {
    return reporter.failure(
      {
        code: ErrorCode.MissingArgument,
        message: 'This project names no board — pass --target, e.g. --target "OpenPLC Runtime v4"',
      },
      ExitCode.Usage,
    )
  }

  let runtime: RuntimeApiClient | null = null
  if (options.withUpload) {
    const host = stringFlag(args, 'host') ?? stringFlag(args, 'address')
    if (!host) {
      return reporter.failure(
        { code: ErrorCode.MissingArgument, message: 'upload needs --host <address> (see `openplc devices`)' },
        ExitCode.Usage,
      )
    }
    const credentials = resolveCredentials(args)
    if ('error' in credentials) {
      return reporter.failure({ code: ErrorCode.MissingArgument, message: credentials.error }, ExitCode.Usage)
    }

    reporter.progress(`Authenticating with ${host}…`)
    runtime = new RuntimeApiClient()
    const login = await runtime.login(host, credentials.username, credentials.password)
    if (!login.success) {
      return reporter.failure(
        { code: ErrorCode.AuthRejected, message: login.error ?? 'The runtime rejected the credentials' },
        ExitCode.Auth,
      )
    }
  }

  const host = options.withUpload ? (stringFlag(args, 'host') ?? stringFlag(args, 'address') ?? null) : null
  const cleanBuild = boolFlag(args, 'clean')

  reporter.progress(`${options.withUpload ? 'Building and uploading' : 'Building'} "${project.name}" for ${target}…`)

  // The renderer's pre-compile chain, in the same order and with the same
  // functions: graft library-supplied C++ blocks in, preprocess POUs (comment
  // wrapping, Python -> ST stubs, C++ validation), then convert to the
  // schema shape the pipeline consumes. Skipping any of it would compile a
  // DIFFERENT program from the same sources — a project with a Python function
  // block would silently lose it.
  // Board info comes from `HardwareModule.getAvailableBoards()` — the same
  // source the compiler adapter reads before a GUI build. `boardCore` and
  // `isSimulator` are both derived from it rather than guessed: the adapter
  // passes `boardInfo.core` to the pipeline, and infers the simulator from
  // `compiler === 'simulator'`. Matching the target name against "simulator"
  // instead would be a second, weaker rule that a renamed board silently breaks.
  const boards = await new HardwareModule().getAvailableBoards()
  const boardInfo = boards.get(target)
  if (!boardInfo) {
    return reporter.failure(
      {
        code: ErrorCode.TargetUnknown,
        message:
          `Board "${target}" is not available. It is neither in hals.json nor an installed VPP package — ` +
          'check `openplc devices` for runtimes, or install the board package in the editor.',
      },
      ExitCode.NotFound,
    )
  }
  const boardCore = boardInfo.core ?? null
  const isSimulator = boardInfo.compiler === 'simulator'

  const archives = new LibraryManagerModule().loadAll()
  const withLibraryCpp = injectLibraryCppBlocks(project.compileReady, archives)
  const { projectData: processed, validationFailed } = preprocessPous(withLibraryCpp, isSimulator, (level, message) => {
    reporter.progress(level === 'error' ? `error: ${message}` : message)
  })
  if (validationFailed) {
    return reporter.failure(
      {
        code: ErrorCode.CompileFailed,
        message: 'POU validation failed — check C/C++ POUs for missing setup()/loop() functions',
      },
      ExitCode.CompileFailed,
    )
  }

  const outcome = await runCompilePipeline({
    projectPath: project.projectPath,
    target,
    boardCore,
    compileOnly: !options.withUpload,
    projectData: toIpcProjectData(processed),
    runtimeIpAddress: host,
    runtimeJwtToken: runtime?.tokens.getToken() ?? null,
    cleanBuild,
    communicationPort: project.communicationPort ?? null,
    vendorScreenData: project.vendorScreenData,
    runtime,
    onLine: (line, level) => {
      if (level === 'error') reporter.progress(`error: ${line}`)
      else reporter.progress(line)
    },
  })

  if (!outcome.success) {
    return reporter.failure(
      {
        code: options.withUpload && outcome.stage === 'upload' ? ErrorCode.UploadRejected : ErrorCode.CompileFailed,
        message: outcome.error,
        details: { diagnostics: outcome.diagnostics },
      },
      options.withUpload && outcome.stage === 'upload' ? ExitCode.TargetError : ExitCode.CompileFailed,
    )
  }

  return reporter.success(
    {
      project: project.name,
      projectPath: project.projectPath,
      target,
      uploaded: options.withUpload,
      buildDirectory: `${project.projectPath}/build/${target}`,
      warnings: outcome.diagnostics.filter((line) => line.level === 'warning').map((line) => line.message),
    },
    () =>
      options.withUpload
        ? `Uploaded "${project.name}" to ${host ?? 'the target'} (${target}).`
        : `Built "${project.name}" for ${target}.\nArtifacts: ${project.projectPath}/build/${target}`,
  )
}

/** Credentials from flags or the environment, with a clear message when absent. */
export function resolveCredentials(args: ParsedArgs): { username: string; password: string } | { error: string } {
  // `--credentials user:pass` is convenient; the environment form exists
  // because a flag lands in shell history and CI logs.
  const combined = stringFlag(args, 'credentials') ?? process.env.OPENPLC_CREDENTIALS
  if (combined) {
    const separator = combined.indexOf(':')
    if (separator <= 0 || separator === combined.length - 1) {
      return { error: 'Credentials must look like user:password' }
    }
    return { username: combined.slice(0, separator), password: combined.slice(separator + 1) }
  }
  const username = stringFlag(args, 'user') ?? process.env.OPENPLC_USER
  const password = stringFlag(args, 'password') ?? process.env.OPENPLC_PASSWORD
  if (!username || !password) {
    return {
      error:
        'Runtime credentials are required: pass --credentials user:pass (or --user/--password), ' +
        'or set OPENPLC_CREDENTIALS / OPENPLC_USER + OPENPLC_PASSWORD',
    }
  }
  return { username, password }
}

export interface CompilePipelineResult {
  success: boolean
  error: string
  stage: 'compile' | 'upload'
  diagnostics: Array<{ level: 'info' | 'warning' | 'error'; message: string }>
}

/**
 * Drive `compileProgram` to completion.
 *
 * The pipeline reports asynchronously and signals the end by closing the
 * channel, so success is decided from what it said before closing rather than
 * from a return value — it has none. An `error` line is what a failed build
 * looks like from out here.
 */
export async function runCompilePipeline(options: {
  projectPath: string
  target: string
  boardCore: string | null
  compileOnly: boolean
  /** Schema-shape project data, as produced by `toIpcProjectData`. */
  projectData: ReturnType<typeof toIpcProjectData>
  runtimeIpAddress: string | null
  runtimeJwtToken: string | null
  cleanBuild: boolean
  communicationPort: string | null
  vendorScreenData: Record<string, unknown> | undefined
  runtime: RuntimeApiClient | null
  onLine: (message: string, level: 'info' | 'warning' | 'error') => void
}): Promise<CompilePipelineResult> {
  const diagnostics: Array<{ level: 'info' | 'warning' | 'error'; message: string }> = []
  let sawUploadStage = false

  return new Promise<CompilePipelineResult>((resolve) => {
    const finish = () => {
      const errors = diagnostics.filter((line) => line.level === 'error')
      resolve({
        success: errors.length === 0,
        error: errors.length === 0 ? '' : errors[errors.length - 1].message,
        stage: sawUploadStage ? 'upload' : 'compile',
        diagnostics,
      })
    }

    const channel = createProgressChannel({
      onMessage: (message: unknown) => {
        const event = readCompileEvent(message)
        if (!event?.message) return
        const level = event.logLevel ?? 'info'
        // Anything the pipeline says after it starts uploading belongs to the
        // upload stage, which the caller reports with a different exit code.
        if (/upload/i.test(event.message)) sawUploadStage = true
        diagnostics.push({ level, message: event.message })
        options.onLine(event.message, level)
      },
      onClose: finish,
    })

    const compiler = new CompilerModule()
    const compileArgs: Array<string | null | boolean | undefined | object> = [
      options.projectPath,
      options.target,
      options.boardCore,
      options.compileOnly,
      options.projectData,
      options.runtimeIpAddress,
      options.runtimeJwtToken,
      options.cleanBuild,
      options.communicationPort,
      options.vendorScreenData,
    ]
    void compiler
      .compileProgram(compileArgs, channel, createHeadlessCompileBridge(options.runtime))
      .catch((error: unknown) => {
        diagnostics.push({ level: 'error', message: error instanceof Error ? error.message : String(error) })
        channel.close()
      })
  })
}

/** Validate a progress payload instead of trusting its shape. */
function readCompileEvent(message: unknown): CompileEvent | undefined {
  if (typeof message !== 'object' || message === null) return undefined
  const record: Record<string, unknown> = { ...message }
  const level = record.logLevel
  return {
    logLevel: level === 'info' || level === 'warning' || level === 'error' ? level : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    closePort: typeof record.closePort === 'boolean' ? record.closePort : undefined,
  }
}
