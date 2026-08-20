/**
 * `openplc compile` and `openplc upload` — the Build and Build & Upload clicks.
 *
 * Both call `compileProgramFlow`, the orchestration behind the editor's
 * `CompilerPort.compileProgram`, through a CLI transport. Everything the flow
 * does — resolving the board from the catalogue, grafting library C++ blocks,
 * preprocessing POUs, shaping the pipeline arguments, interpreting the message
 * stream — is therefore the same code the button runs. The only difference
 * between the two commands is `compileOnly` and whether a runtime address and
 * token are supplied, exactly as it is between the two menu items.
 *
 * What stays here is the CLI's own part: reading the target and credentials off
 * argv, loading the project from disk, and rendering the result.
 */

import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import { compileProgramFlow } from '@root/middleware/adapters/editor/compile-program-flow'
import type { CompileProgressEvent } from '@root/middleware/shared/ports/types'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { createCliCompileTransport } from '../compile/cli-transport'
import { ErrorCode, ExitCode, type ExitCodeValue } from '../exit-codes'
import type { CliFailure, CliResult, Reporter } from '../output'
import { loadProject } from '../project/load'

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

  // The project remembers the board its dropdown was left on; `--target`
  // overrides it so one fixture can be built for several targets in a matrix.
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
  let host: string | null = null
  if (options.withUpload) {
    host = stringFlag(args, 'host') ?? stringFlag(args, 'address') ?? null
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

  // The same gate the GUI's build puts up. Targets that are not flashed over USB
  // run the FINAL build step ON the device, and doing that while the PLC is
  // scanning can stall the build or make the running program miss deadlines. The
  // GUI asks "Stop PLC and Continue?"; a CLI cannot ask, so it refuses and names
  // the flag — silently stopping someone's running PLC is not a default.
  if (runtime && host) {
    const gate = await ensurePlcStoppedForBuild({
      runtime,
      host,
      target,
      autoApprove: boolFlag(args, 'yes'),
      reporter,
    })
    if ('error' in gate) {
      return reporter.failure(gate.error, gate.exitCode)
    }
  }

  reporter.progress(`${options.withUpload ? 'Building and uploading' : 'Building'} "${project.name}" for ${target}…`)

  let streamedError = false
  const warnings: string[] = []

  const result = await compileProgramFlow(
    {
      projectPath: project.projectPath,
      boardTarget: target,
      // The alias-resolved snapshot, from the same store action the button uses.
      projectData: project.compileReady,
      compileOnly: !options.withUpload,
      cleanBuild: boolFlag(args, 'clean'),
      runtimeIpAddress: host,
      runtimeJwtToken: runtime?.tokens.getToken() ?? null,
      communicationPort: project.communicationPort || undefined,
      vendorScreenData: project.vendorScreenData,
    },
    createCliCompileTransport(runtime),
    (event: CompileProgressEvent) => {
      if (event.level === 'error' || event.stage === 'error') streamedError = true
      if (event.level === 'warning' && event.message) warnings.push(event.message)
      if (event.message) reporter.progress(event.level === 'error' ? `error: ${event.message}` : event.message)
    },
  )

  if (!result.success) {
    return reporter.failure(
      {
        code: options.withUpload && streamedError ? ErrorCode.UploadRejected : ErrorCode.CompileFailed,
        message: result.error ?? 'Compilation failed',
      },
      options.withUpload && streamedError ? ExitCode.TargetError : ExitCode.CompileFailed,
    )
  }

  return reporter.success(
    {
      project: project.name,
      projectPath: project.projectPath,
      target,
      uploaded: options.withUpload,
      buildDirectory: `${project.projectPath}/build/${target}`,
      firmwarePath: result.hexPath,
      warnings,
    },
    () =>
      options.withUpload
        ? `Uploaded "${project.name}" to ${host ?? 'the target'} (${target}).`
        : `Built "${project.name}" for ${target}.\nArtifacts: ${project.projectPath}/build/${target}`,
  )
}

/** Credentials from flags or the environment, with a clear message when absent. */
export function resolveCredentials(args: ParsedArgs): { username: string; password: string } | { error: string } {
  // `--credentials user:pass` is convenient; the environment form exists because
  // a flag lands in shell history and CI logs.
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

/**
 * Stop the PLC before a build that runs on the device, or refuse.
 *
 * Mirrors the GUI's pre-build gate: when the target is reached through a runtime
 * (rather than flashed over USB) and that runtime is RUNNING, the editor warns
 * and stops it on the user's consent. `--yes` is that consent, the way `apt -y`
 * is; without it the build stops and says so, because a scripted run must not
 * silently halt a live PLC.
 */
async function ensurePlcStoppedForBuild(input: {
  runtime: RuntimeApiClient
  host: string
  target: string
  autoApprove: boolean
  reporter: Reporter
}): Promise<{ ok: true } | { error: CliFailure; exitCode: ExitCodeValue }> {
  const status = await input.runtime.getStatus(input.host)
  // Unknown state is not a reason to block: the build's own upload step reports
  // a target it cannot reach far better than a pre-flight guess does.
  if (!status.success) return { ok: true }
  if (!(status.status ?? '').toUpperCase().includes('RUNNING')) return { ok: true }

  if (!input.autoApprove) {
    return {
      error: {
        code: ErrorCode.TargetError,
        message:
          `The PLC on ${input.host} is RUNNING and "${input.target}" builds on the device, which can stall ` +
          'the build or make the running program miss scan deadlines. Stop it first, or pass --yes to have ' +
          'this command stop it for you.',
      },
      exitCode: ExitCode.TargetError,
    }
  }

  input.reporter.progress('--yes given: stopping the PLC before the build…')
  const stopped = await input.runtime.setPlcState(input.host, 'stop')
  if (!stopped.success) {
    return {
      error: {
        code: ErrorCode.TargetError,
        message: stopped.refusedBySwitch
          ? 'The PLC refused to stop: its physical mode switch is in RUN. Move it to STOP and retry.'
          : `Could not stop the PLC before building: ${stopped.error ?? 'unknown error'}`,
      },
      exitCode: ExitCode.TargetError,
    }
  }
  input.reporter.progress('PLC stopped before build.')
  return { ok: true }
}
