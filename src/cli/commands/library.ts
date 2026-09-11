/**
 * `openplc-cli library` — build a Library Project into a `.stlib`, install and
 * uninstall one, inspect its contents, list what is installed, and pin a
 * project to the version it compiles against.
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
import type { StlibArchiveDTO } from '@root/middleware/shared/ports/library-port'
import type { CompileLibraryResult, PLCProjectData } from '@root/middleware/shared/ports/types'

import { boolFlag, type ParsedArgs } from '../args'
import { createHeadlessCompileBridge, createProgressChannel } from '../compile/headless-bridge'
import { ErrorCode, ExitCode } from '../exit-codes'
import { type CliResult, renderTable, type Reporter } from '../output'
import { loadProject } from '../project/load'
import { runLibraryPin, runLibraryUnpin } from './library-pin'

export async function runLibrary(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const [subcommand, target] = args.positionals

  switch (subcommand) {
    case 'build':
      return runLibraryBuild(args, reporter, target)
    case 'install':
      return runLibraryInstall(reporter, target)
    case 'uninstall':
      return runLibraryUninstall(args, reporter, target)
    case 'info':
      return runLibraryInfo(reporter, target)
    case 'list':
      return runLibraryList(reporter)
    case 'pin':
      return runLibraryPin(reporter, args.positionals[1], args.positionals[2])
    case 'unpin':
      return runLibraryUnpin(reporter, args.positionals[1], args.positionals[2])
    default:
      return reporter.failure(
        {
          code: ErrorCode.InvalidArgument,
          message: `library takes build, install, uninstall, info, list, pin or unpin — got "${subcommand ?? ''}".`,
        },
        ExitCode.Usage,
      )
  }
}

/**
 * Split `name` or `name@version`.
 *
 * `@` and not a `--version` flag: `--version` is a global boolean that prints
 * the CLI's own version and exits before a command ever runs (`main.ts:179`).
 * A leading `@` is part of the name, not a separator.
 */
export function splitLibraryRef(ref: string): { name: string; version?: string } {
  const at = ref.lastIndexOf('@')
  if (at <= 0) return { name: ref }
  return { name: ref.slice(0, at), version: ref.slice(at + 1) }
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

  // `target_error`, not `invalid_argument`: the argument parsed, the module ran
  // and refused. The exit code already said so.
  const result = await new LibraryManagerModule().installFromFile(stlibPath)
  if (!result.success) {
    return reporter.failure({ code: ErrorCode.TargetError, message: result.error }, ExitCode.TargetError)
  }
  if (result.canceled) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `Nothing installed from ${stlibPath}.` },
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
  // The Versions column only earns its width once something has more than one.
  // JSON always carries the array, whatever the table shows.
  const anyMultiVersion = installed.some((library) => (library.versions?.length ?? 0) > 1)
  return reporter.success({ ok: true, libraries: installed }, () => {
    if (installed.length === 0) return 'No libraries installed.'
    const headers = anyMultiVersion ? ['Name', 'Version', 'Installed', 'Origin'] : ['Name', 'Version', 'Origin']
    return renderTable(
      headers,
      installed.map((library) =>
        anyMultiVersion
          ? [library.name, library.version, (library.versions ?? [library.version]).join(', '), library.origin]
          : [library.name, library.version, library.origin],
      ),
    )
  })
}

/**
 * Print what a `.stlib` actually contains — pin names and types included.
 *
 * `listInstalled` carries identity and provenance only, so answering "did this
 * pin change between versions" otherwise means unzipping the archive by hand.
 */
function runLibraryInfo(reporter: Reporter, ref: string | undefined): CliResult {
  if (!ref) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'library info needs a library name, or name@version.' },
      ExitCode.Usage,
    )
  }

  const { name, version } = splitLibraryRef(ref)
  const manager = new LibraryManagerModule()

  // Check the version before reading it. `readArchiveText` resolves through
  // `resolveVersion`, which substitutes the newest when the wanted one is not
  // installed — right for a compile, which reports the substitution, and wrong
  // here: `info x@9.9.9` would print some other version's blocks as if they
  // were 9.9.9's.
  const row = manager.listInstalled().find((library) => library.name === name)
  if (!row) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `Library '${name}' is not installed.` },
      ExitCode.NotFound,
    )
  }
  const installedVersions = row.versions ?? [row.version]
  if (version !== undefined && !installedVersions.includes(version)) {
    return reporter.failure(
      {
        code: ErrorCode.TargetError,
        message: `Library '${name}' version ${version} is not installed. Installed: ${installedVersions.join(', ')}.`,
      },
      ExitCode.NotFound,
    )
  }

  const text = manager.readArchiveText(name, version)
  if (text === null) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `Library '${name}' has no readable archive.` },
      ExitCode.NotFound,
    )
  }

  let archive: StlibArchiveDTO
  try {
    archive = JSON.parse(text) as StlibArchiveDTO
  } catch {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `Library '${name}' has an unreadable archive.` },
      ExitCode.TargetError,
    )
  }

  const { manifest } = archive

  const payload = {
    ok: true,
    library: {
      name: manifest.name,
      displayName: manifest.displayName ?? null,
      version: manifest.version,
      namespace: manifest.namespace,
      description: manifest.description ?? null,
      bundled: row?.bundled ?? manifest.isBuiltin,
      origin: row?.origin ?? null,
      installedAt: row?.installedAt ?? null,
      versions: row?.versions ?? [manifest.version],
      functions: manifest.functions,
      functionBlocks: manifest.functionBlocks,
      types: manifest.types,
      globalConstants: archive.globalConstants ?? {},
      sources: (archive.sources ?? []).map((file) => file.fileName),
      resources: (archive.resources ?? []).map((file) => file.path),
    },
  }

  return reporter.success(payload, () => renderLibraryInfo(payload.library))
}

function renderLibraryInfo(library: {
  name: string
  displayName: string | null
  version: string
  namespace: string
  description: string | null
  bundled: boolean
  versions: string[]
  functions: StlibArchiveDTO['manifest']['functions']
  functionBlocks: StlibArchiveDTO['manifest']['functionBlocks']
  types: StlibArchiveDTO['manifest']['types']
  globalConstants: Record<string, number>
  sources: string[]
  resources: string[]
}): string {
  const pins = (list: Array<{ name: string; type: string }>) =>
    list.length === 0 ? '—' : list.map((pin) => `${pin.name}: ${pin.type}`).join(', ')

  const lines = [
    `${library.displayName ?? library.name} ${library.version}${library.bundled ? '  (bundled)' : ''}`,
    `  namespace: ${library.namespace}`,
  ]
  if (library.description) lines.push(`  ${library.description}`)
  if (library.versions.length > 1) lines.push(`  installed: ${library.versions.join(', ')}`)

  if (library.functionBlocks.length > 0) {
    lines.push('', `Function blocks (${library.functionBlocks.length})`)
    for (const block of library.functionBlocks) {
      lines.push(`  ${block.name}${block.implementation ? `  [${block.implementation}]` : ''}`)
      lines.push(`    in:    ${pins(block.inputs)}`)
      lines.push(`    out:   ${pins(block.outputs)}`)
      if (block.inouts.length > 0) lines.push(`    inout: ${pins(block.inouts)}`)
    }
  }

  if (library.functions.length > 0) {
    lines.push('', `Functions (${library.functions.length})`)
    for (const fn of library.functions) {
      const params = fn.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')
      lines.push(`  ${fn.name}(${params}) : ${fn.returnType}${fn.variadic ? '  (variadic)' : ''}`)
    }
  }

  if (library.types.length > 0) {
    lines.push('', `Data types (${library.types.length})`)
    for (const type of library.types) {
      lines.push(`  ${type.name}  ${type.kind}${type.baseType ? ` of ${type.baseType}` : ''}`)
    }
  }

  const constants = Object.keys(library.globalConstants)
  if (constants.length > 0) lines.push('', `Global constants (${constants.length})`, `  ${constants.join(', ')}`)
  if (library.sources.length > 0)
    lines.push('', `Sources (${library.sources.length})`, `  ${library.sources.join(', ')}`)
  if (library.resources.length > 0)
    lines.push('', `Resources (${library.resources.length})`, `  ${library.resources.join(', ')}`)

  return lines.join('\n')
}

async function runLibraryUninstall(args: ParsedArgs, reporter: Reporter, ref: string | undefined): Promise<CliResult> {
  if (!ref) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'library uninstall needs a library name, or name@version.' },
      ExitCode.Usage,
    )
  }

  const { name, version } = splitLibraryRef(ref)
  const manager = new LibraryManagerModule()
  const row = manager.listInstalled().find((library) => library.name === name)
  if (!row) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `Library '${name}' is not installed.` },
      ExitCode.NotFound,
    )
  }

  const installedVersions = row.versions ?? [row.version]
  const removeAll = boolFlag(args, 'all')

  // Refuse rather than guess. Taking the newest silently is the one outcome
  // nobody asks for, and it is unrecoverable.
  if (!version && !removeAll && installedVersions.length > 1) {
    return reporter.failure(
      {
        code: ErrorCode.InvalidArgument,
        message: `Library '${name}' has ${installedVersions.length} versions installed (${installedVersions.join(', ')}). Name one as ${name}@<version>, or pass --all.`,
      },
      ExitCode.Usage,
    )
  }

  const targets = version ? [version] : removeAll ? installedVersions : [installedVersions[0]]
  const removed: string[] = []
  for (const target of targets) {
    const result = manager.uninstall(name, target)
    if (!result.success) {
      return reporter.failure(
        { code: ErrorCode.TargetError, message: result.error ?? `Could not uninstall ${name} ${target}.` },
        ExitCode.TargetError,
      )
    }
    removed.push(target)
  }

  const remaining = manager.listInstalled().find((library) => library.name === name)?.versions ?? []
  return reporter.success({ ok: true, library: name, removed, remaining }, () =>
    [
      `Uninstalled ${name} ${removed.join(', ')}`,
      remaining.length > 0 ? `  still installed: ${remaining.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}
