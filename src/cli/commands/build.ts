/**
 * `openplc-cli compile` and `openplc-cli upload` — the Build and Build & Upload clicks.
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

import { join } from 'node:path'

import { HardwareModule } from '@root/backend/editor/hardware'
import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import { openPLCStoreBase } from '@root/frontend/store'
import { compileProgramFlow } from '@root/middleware/adapters/editor/compile-program-flow'
import type { CompileProgressEvent } from '@root/middleware/shared/ports/types'
import { evaluatePreBuildPlcGate } from '@root/middleware/shared/utils/build-gate/pre-build-plc-gate'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { createCliCompileTransport } from '../compile/cli-transport'
import { connectToRuntime } from '../connect-runtime'
import { ErrorCode, ExitCode, type ExitCodeValue } from '../exit-codes'
import type { CliFailure, CliResult, Reporter } from '../output'
import { applyConnectionOverrides, loadProject } from '../project/load'

export interface BuildOptions {
  /** True for `upload`: connect to a runtime and let the pipeline flash it. */
  withUpload: boolean
  /**
   * Credentials supplied by an in-process caller, bypassing the flag/env lookup.
   * Used by `debug open --upload-if-needed`, which already holds them.
   */
  credentials?: { username: string; password: string }
}

export async function runBuild(args: ParsedArgs, reporter: Reporter, options: BuildOptions): Promise<CliResult> {
  const projectPath = args.positionals[0] ?? stringFlag(args, 'project')
  if (!projectPath) {
    return reporter.failure(
      {
        code: ErrorCode.MissingArgument,
        message: 'Give the project directory, e.g. `openplc-cli compile ./my-project`',
      },
      ExitCode.Usage,
    )
  }

  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound)
  }
  const project = loaded.project
  for (const warning of project.warnings) reporter.progress(`warning: ${warning}`)

  // The port dropdown and the address field, from argv.
  applyConnectionOverrides({ port: stringFlag(args, 'port'), host: stringFlag(args, 'host') })

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

  // Which arguments an upload needs is a property of the TARGET, and the editor
  // already answers it: `directUsbUpload` is the difference between a board it
  // flashes over USB (arduino-cli, needs a serial port) and one it reaches
  // through a runtime API (needs an address and credentials). Asking for a host
  // unconditionally made `upload` impossible for every Arduino-class board.
  const boards = await new HardwareModule().getAvailableBoards()
  const boardInfo = boards.get(target)
  if (!boardInfo) {
    return reporter.failure(
      {
        code: ErrorCode.TargetUnknown,
        message:
          `Board "${target}" is not available — it is neither in hals.json nor declared by an installed VPP ` +
          'package. Install its package in the editor, or check the name.',
      },
      ExitCode.NotFound,
    )
  }
  const capabilities = resolveTargetCapabilities(boardInfo)

  let runtime: RuntimeApiClient | null = null
  let host: string | null = null

  if (options.withUpload && capabilities.directUsbUpload) {
    // arduino-cli needs the port; the project may already remember it.
    if (!currentCommunicationPort()) {
      return reporter.failure(
        {
          code: ErrorCode.MissingArgument,
          message: `"${target}" is flashed over USB — pass --port <serial> (see \`openplc-cli devices\`)`,
        },
        ExitCode.Usage,
      )
    }
  } else if (options.withUpload) {
    host = stringFlag(args, 'host') ?? stringFlag(args, 'address') ?? null
    if (!host) {
      return reporter.failure(
        {
          code: ErrorCode.MissingArgument,
          message: `"${target}" is reached through its runtime API — pass --host <address> (see \`openplc-cli devices\`)`,
        },
        ExitCode.Usage,
      )
    }
    // Shared with `debug open`, including the first-user bootstrap a fresh
    // runtime needs (`--create-user`).
    const connected = await connectToRuntime({
      host,
      args,
      credentials: options.credentials,
      onProgress: (m) => reporter.progress(m),
    })
    if (!connected.ok) {
      return reporter.failure(
        { code: connected.failure.code, message: connected.failure.message },
        connected.failure.exitCode,
      )
    }
    runtime = connected.value.runtime
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
      buildsOnDevice: !capabilities.directUsbUpload,
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
      communicationPort: currentCommunicationPort() || undefined,
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
      buildDirectory: join(project.projectPath, 'build', target),
      firmwarePath: result.hexPath,
      warnings,
    },
    () =>
      options.withUpload
        ? `Uploaded "${project.name}" to ${host ?? currentCommunicationPort() ?? 'the target'} (${target}).`
        : `Built "${project.name}" for ${target}.\nArtifacts: ${join(project.projectPath, 'build', target)}`,
  )
}

/**
 * Apply the shared pre-build gate, obtaining consent the way a CLI can.
 *
 * The DECISION is `evaluatePreBuildPlcGate`, the same function the editor's
 * build button uses — so the two cannot disagree about when a build may start.
 * What differs is only the consent: the GUI shows "Stop PLC and Continue"; here
 * `--yes` is that click, the way `apt -y` is. Without it the command refuses,
 * because silently halting a running PLC from a script is not a default.
 */
async function ensurePlcStoppedForBuild(input: {
  runtime: RuntimeApiClient
  host: string
  target: string
  buildsOnDevice: boolean
  autoApprove: boolean
  reporter: Reporter
}): Promise<{ ok: true } | { error: CliFailure; exitCode: ExitCodeValue }> {
  const status = await input.runtime.getStatus(input.host)

  const verdict = evaluatePreBuildPlcGate({
    buildsOnDevice: input.buildsOnDevice,
    // A status call that failed means we could not establish a connection, which
    // the gate treats as "proceed" — the upload step reports it far better.
    connected: status.success,
    running: (status.status ?? '').toUpperCase().includes('RUNNING'),
  })
  if (verdict.kind === 'proceed') return { ok: true }

  if (!input.autoApprove) {
    return {
      error: {
        code: ErrorCode.TargetError,
        message: `${verdict.reason} Stop it first, or pass --yes to have this command stop it for you.`,
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

/** The port the store now holds — after `--port` has been applied. */
function currentCommunicationPort(): string | undefined {
  return openPLCStoreBase.getState().deviceDefinitions.configuration.communicationPort || undefined
}

/**
 * Build (and optionally upload) a project from structured options.
 *
 * The seam `runBuild` sits on. `debug open --upload-if-needed` used to reach the
 * upload by hand-building a `ParsedArgs` literal and serialising credentials
 * into a `user:pass` string purely so `resolveRuntimeCredentials` could split
 * them again — which truncated a username containing a colon on that path and
 * only that path, and made any future required flag on `upload` an invisible
 * runtime failure instead of a compile error.
 */
export async function buildProject(options: {
  projectPath: string
  target?: string
  host?: string
  port?: string
  credentials?: { username: string; password: string }
  withUpload: boolean
  cleanBuild?: boolean
  autoApprove?: boolean
  reporter: Reporter
}): Promise<CliResult> {
  // Rebuilt as argv rather than duplicating `runBuild`'s body: one code path,
  // and the flags are the same contract the command line uses. Credentials go
  // through the structured field, not a colon-joined string.
  const flags: ParsedArgs['flags'] = {}
  if (options.target) flags.target = options.target
  if (options.host) flags.host = options.host
  if (options.port) flags.port = options.port
  if (options.cleanBuild) flags.clean = true
  if (options.autoApprove) flags.yes = true

  return runBuild(
    {
      command: options.withUpload ? 'upload' : 'compile',
      subcommand: undefined,
      positionals: [options.projectPath],
      flags,
    },
    options.reporter,
    { withUpload: options.withUpload, credentials: options.credentials },
  )
}
