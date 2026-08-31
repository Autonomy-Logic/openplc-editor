/**
 * `openplc-cli library` — build a Library Project into a `.stlib`, install one,
 * and list what is installed.
 *
 * All three were GUI-only. Building ran through `CompilerModule.compileLibrary`
 * over a MessagePort from the renderer; installing through
 * `LibraryManagerModule`, which writes `<userData>/libraries/<name>/` AND a
 * `registry.json` beside it — so copying an archive into place installs nothing.
 *
 * `build` enters `compileLibrary` at the same point the main process does, with
 * the preprocessing the renderer's adapter does first. Reassembling those steps
 * here would build a *different library* from the same sources, which is the
 * kind of divergence that makes a green build worthless.
 */

import { CompilerModule } from '@root/backend/editor/compiler'
import { LibraryManagerModule } from '@root/backend/editor/library-manager'
import { collectNativePous } from '@root/backend/shared/library/native-pou-list'
import { preprocessPous } from '@root/backend/shared/utils/PLC/preprocess-pous'
import { toIpcProjectData } from '@root/middleware/adapters/editor/compiler-adapter'
import type { CompileLibraryResult, PLCProjectData } from '@root/middleware/shared/ports/types'

import { boolFlag, type ParsedArgs } from '../args'
import { createHeadlessCompileBridge, createProgressChannel } from '../compile/headless-bridge'
import { ErrorCode, ExitCode } from '../exit-codes'
import { type CliResult, renderTable, type Reporter } from '../output'
import { loadProject } from '../project/load'

export async function runLibrary(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const [subcommand, target] = args.positionals

  switch (subcommand) {
    case 'build':
      return runLibraryBuild(args, reporter, target)
    case 'install':
      return runLibraryInstall(reporter, target)
    case 'list':
      return runLibraryList(reporter)
    default:
      return reporter.failure(
        {
          code: ErrorCode.InvalidArgument,
          message: `library takes build, install or list — got "${subcommand ?? ''}".`,
        },
        ExitCode.Usage,
      )
  }
}

async function runLibraryBuild(
  args: ParsedArgs,
  reporter: Reporter,
  projectPath: string | undefined,
): Promise<CliResult> {
  if (!projectPath) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'library build needs the path of a library project.' },
      ExitCode.Usage,
    )
  }

  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound)
  }
  for (const warning of loaded.project.warnings) reporter.progress(warning)

  const prepared = prepareLibraryData(loaded.project.data, reporter)
  if ('error' in prepared) {
    return reporter.failure({ code: ErrorCode.CompileFailed, message: prepared.error }, ExitCode.CompileFailed)
  }

  reporter.progress(`Building library at ${loaded.project.projectPath}…`)
  const result = await compileLibrary({
    projectPath: loaded.project.projectPath,
    buildData: prepared.buildData,
    verifyData: prepared.verifyData,
    cleanBuild: boolFlag(args, 'clean'),
    nativePous: prepared.nativePous,
    onMessage: (message, level) => reporter.progress(`  ${level === 'info' ? '' : `${level}: `}${message}`),
  })

  if (!result.success) {
    return reporter.failure(
      { code: ErrorCode.CompileFailed, message: result.error ?? 'Library build failed.' },
      ExitCode.CompileFailed,
    )
  }

  return reporter.success(
    {
      ok: true,
      library: result.libraryName,
      stlibPath: result.stlibPath,
      verification: result.verification ?? null,
    },
    () =>
      [
        `Built ${result.libraryName ?? 'library'}`,
        result.stlibPath ? `  ${result.stlibPath}` : '',
        `  verification: ${describeVerification(result.verification)}`,
      ]
        .filter(Boolean)
        .join('\n'),
  )
}

/**
 * The two `preprocessPous` passes the renderer's adapter runs, and the native
 * POU list taken before them.
 *
 * The build pass keeps Python POUs as real code; the verification pass stubs
 * them, because the simulator it compiles against has no interpreter. The
 * native list has to be collected first: preprocessing lowers every native body
 * to bridge ST and rewrites its language tag, leaving nothing to identify one
 * by afterwards.
 */
function prepareLibraryData(
  projectData: PLCProjectData,
  reporter: Reporter,
):
  | { buildData: PLCProjectData; verifyData: PLCProjectData; nativePous: ReturnType<typeof collectNativePous> }
  | { error: string } {
  const nativePous = collectNativePous(projectData)

  // A library's own POU may hold a function block instance, so preprocessing
  // needs the same pin sources a project build gets.
  const fbSources = new LibraryManagerModule().loadAll().map((archive) => ({
    functionBlocks: archive.manifest.functionBlocks,
  }))

  const buildPass = preprocessPous(
    projectData,
    false,
    (level, message) => reporter.progress(`  ${level === 'info' ? '' : `${level}: `}${message}`),
    undefined,
    fbSources,
  )
  if (buildPass.validationFailed) {
    return { error: buildPass.validationError ?? VALIDATION_FALLBACK }
  }

  // Silent: the same project already logged its POUs on the build pass.
  const verifyPass = preprocessPous(projectData, true, () => undefined, undefined, fbSources)
  if (verifyPass.validationFailed) {
    return { error: verifyPass.validationError ?? VALIDATION_FALLBACK }
  }

  return { buildData: buildPass.projectData, verifyData: verifyPass.projectData, nativePous }
}

const VALIDATION_FALLBACK = 'POU validation failed. Check C/C++ blocks for missing setup()/loop() functions.'

/**
 * Drive `CompilerModule.compileLibrary` over a plain channel.
 *
 * The protocol is the main process's: log messages arrive one at a time, then
 * one message carrying `libraryBuildResult`, then the channel closes. The close
 * is the only "done" signal, so the result is held until it arrives.
 */
function compileLibrary(options: {
  projectPath: string
  buildData: PLCProjectData
  verifyData: PLCProjectData
  cleanBuild: boolean
  nativePous: ReturnType<typeof collectNativePous>
  onMessage: (message: string, level: 'info' | 'warning' | 'error') => void
}): Promise<CompileLibraryResult> {
  return new Promise<CompileLibraryResult>((resolve) => {
    let result: CompileLibraryResult | undefined

    const channel = createProgressChannel({
      onMessage: (message: unknown) => {
        if (typeof message !== 'object' || message === null) return
        const payload = message as Record<string, unknown>
        if (payload.libraryBuildResult) {
          result = payload.libraryBuildResult as CompileLibraryResult
          return
        }
        if (typeof payload.message === 'string') {
          const level = payload.logLevel === 'warning' || payload.logLevel === 'error' ? payload.logLevel : 'info'
          options.onMessage(payload.message, level)
        }
      },
      onClose: () => resolve(result ?? { success: false, error: 'Library build closed without a result.' }),
    })

    void new CompilerModule()
      .compileLibrary(
        // Positional, as the main process receives them over IPC:
        // [projectPath, build-pass data, verify-pass data, cleanBuild, nativePous].
        //
        // Shaped by `toIpcProjectData`, not passed as-is: the IPC form renames
        // `configurations` to `configuration`, which the build pipeline reads.
        [
          options.projectPath,
          toIpcProjectData(options.buildData) as never,
          toIpcProjectData(options.verifyData) as never,
          options.cleanBuild,
          options.nativePous as never,
        ],
        channel,
        createHeadlessCompileBridge(null),
      )
      .catch((error: unknown) => {
        result = { success: false, error: error instanceof Error ? error.message : String(error) }
        channel.close()
      })
  })
}

function describeVerification(verification: CompileLibraryResult['verification']): string {
  if (!verification) return 'not run'
  return verification.success ? 'passed' : `failed — ${verification.message ?? 'see log'}`
}

async function runLibraryInstall(reporter: Reporter, stlibPath: string | undefined): Promise<CliResult> {
  if (!stlibPath) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'library install needs the path of a .stlib file.' },
      ExitCode.Usage,
    )
  }

  const result = await new LibraryManagerModule().installFromFile(stlibPath)
  if (!result.success) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: result.error },
      ExitCode.TargetError,
    )
  }
  if (result.canceled) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: `Nothing installed from ${stlibPath}.` },
      ExitCode.TargetError,
    )
  }

  return reporter.success(
    { ok: true, library: result.name, version: result.version, origin: result.origin },
    () => `Installed ${result.name} ${result.version}`,
  )
}

function runLibraryList(reporter: Reporter): CliResult {
  const installed = new LibraryManagerModule().listInstalled()
  return reporter.success(
    { ok: true, libraries: installed },
    () =>
      installed.length === 0
        ? 'No libraries installed.'
        : renderTable(
            ['Name', 'Version', 'Origin'],
            installed.map((library) => [library.name, library.version, library.origin]),
          ),
  )
}
