/**
 * `openplc-cli check` — transpile a project to Structured Text and report what
 * the compiler would say, without building anything.
 *
 * A board compile takes tens of seconds and needs a toolchain. Most of what an
 * agent gets wrong — an undeclared variable, a pin that does not exist, a POU
 * that will not project — is settled long before a compiler runs. `check`
 * returns that verdict in well under a second.
 *
 * It deliberately runs the SAME preparation a build does
 * (`prepareProjectForCompile`): board resolution, the library C/C++ graft and
 * POU preprocessing. A check that skipped those would pass on projects the
 * compiler rejects, which is worse than no check at all.
 */

import crypto from 'node:crypto'

import { runProgramBuildPipeline } from '@root/backend/shared/library/program-build-pipeline'
import type { SchemaProjectData } from '@root/backend/shared/transpilers/st-transpiler'
import { fromSchemaShape, transpileToSt } from '@root/backend/shared/transpilers/st-transpiler'
import type { KnownPou } from '@root/backend/shared/utils/PLC/split-program-st'
import { openPLCStoreBase } from '@root/frontend/store'
import { prepareProjectForCompile } from '@root/middleware/adapters/editor/compile-program-flow'
import { toIpcProjectData } from '@root/middleware/adapters/editor/compiler-adapter'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { describeProtocolConfs, type ProtocolConfs } from '../check/protocol-confs'
import { createCliCompileTransport } from '../compile/cli-transport'
import { ErrorCode, ExitCode } from '../exit-codes'
import { type LintFinding, lintProgram } from '../lint/program'
import { lintProtocols } from '../lint/protocol'
import type { CliResult, Reporter } from '../output'
import { loadProject, unreadableProtocolFilesMessage } from '../project/load'

export async function runCheck(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const projectPath = args.positionals[0] ?? stringFlag(args, 'project')
  if (!projectPath) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'check needs the path of a project.' },
      ExitCode.Usage,
    )
  }

  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound)
  }
  for (const warning of loaded.project.warnings) reporter.progress(warning)

  // Same refusal `apply` and `describe` make. A skipped server file is absent
  // from the project, so `--protocols` and the protocol lint would both answer
  // for a configuration that is not the one on disk — and answer "OK".
  const unreadable = unreadableProtocolFilesMessage(loaded.project)
  if (unreadable) {
    return reporter.failure(
      {
        code: ErrorCode.ProtocolFileUnreadable,
        message: unreadable,
        details: loaded.project.unreadableProtocolFiles,
      },
      ExitCode.TargetError,
    )
  }

  const target = stringFlag(args, 'target') ?? loaded.project.board
  if (!target) {
    return reporter.failure(
      {
        code: ErrorCode.TargetUnknown,
        message: 'This project names no board — pass --target (see `openplc-cli devices`).',
      },
      ExitCode.Usage,
    )
  }

  // `runtime: null` — nothing here uploads, so there is no device and no
  // credentials. Only `getAvailableBoards` and `loadAllLibraries` are reached.
  const preparation = await prepareProjectForCompile(
    { projectData: loaded.project.compileReady, boardTarget: target },
    createCliCompileTransport(null),
    (event) => {
      if (event.level === 'error' || event.level === 'warning') {
        reporter.progress(`  ${event.level}: ${event.message}`)
      }
    },
  )
  if (!preparation.ok) {
    return reporter.failure({ code: ErrorCode.CompileFailed, message: preparation.error }, ExitCode.CompileFailed)
  }

  const projected = projectToTranspiler(preparation.prepared.processedData)
  if (!projected.ok) {
    return reporter.failure({ code: ErrorCode.InvalidArgument, message: projected.error }, ExitCode.CompileFailed)
  }

  const result = transpileToSt(projected.project)
  const collected = [...result.errors]
  const collectedWarnings = [...result.warnings]

  // Projection is only half a check. `transpileToSt` turns the project into ST;
  // it does not compile it, so an undeclared variable — the mistake an agent
  // makes most — projects perfectly and reports OK. The semantic pass lives in
  // strucpp, and `runProgramBuildPipeline` runs it in-process with no disk I/O,
  // no toolchain and no board. Without this, `check` would say OK on a project
  // `compile` rejects, which is worse than having no check at all.
  // strucpp emits `debug-map.json` alongside the C++ — the OPC-UA validator
  // resolves every address-space node through it, so keeping it here is what
  // lets `--protocols` catch a node naming a variable the program lacks.
  let debugMapContent = ''
  if (result.programSt !== null) {
    const compiled = runProgramBuildPipeline({
      source: result.programSt,
      md5: crypto.createHash('md5').update(result.programSt).digest('hex'),
      pous: knownPous(preparation.prepared.processedData),
      libraries: preparation.prepared.archives,
      missingLibraries: [],
      hasCBlocks: preparation.prepared.processedData.pous.some((pou) => pou.body.language === 'cpp'),
    })
    for (const diagnostic of compiled.errors) collected.push(diagnostic.formatted)
    for (const diagnostic of compiled.warnings) collectedWarnings.push(diagnostic.formatted)
    debugMapContent = compiled.files.find((file) => file.name === 'debug-map.json')?.content ?? ''
  }

  // The linter reads the ST the transpiler just produced: `check` answers "does
  // this compile", and every finding it reports compiles perfectly.
  const lint: LintFinding[] = []
  if (boolFlag(args, 'lint') && result.programSt !== null) {
    lint.push(
      ...lintProgram({
        st: result.programSt,
        pous: preparation.prepared.processedData.pous,
        systemLibraries: openPLCStoreBase.getState().libraries.system,
        globals: loaded.project.compileReady.configurations?.resource?.globalVariables ?? [],
      }),
    )
  }

  // Protocol findings are project-wide (`pou: null`), so they survive `--pou`.
  if (boolFlag(args, 'lint')) {
    lint.push(
      ...lintProtocols({
        servers: loaded.project.compileReady.servers ?? [],
        remoteDevices: loaded.project.compileReady.remoteDevices ?? [],
        debugMapContent,
        instances: (loaded.project.compileReady.configurations?.resource?.instances ?? []).map((instance) => ({
          name: instance.name,
          task: instance.task,
          program: instance.program,
        })),
        // STORED globals, not the compile-ready ones: a global bound to a device
        // point by ALIAS is resolved to that point's address on the way to the
        // compiler, and comparing that would report every correct binding as a
        // collision. Only a hand-written literal address can collide.
        globals: loaded.project.data.configurations?.resource?.globalVariables ?? [],
      }),
    )
  }

  const onlyPou = stringFlag(args, 'pou')
  const errors = onlyPou ? collected.filter((line) => mentionsPou(line, onlyPou)) : collected
  const warnings = onlyPou ? collectedWarnings.filter((line) => mentionsPou(line, onlyPou)) : collectedWarnings
  const lintFindings = onlyPou ? lint.filter((finding) => finding.pou === null || finding.pou === onlyPou) : lint
  // A lint error fails the command, a warning does not — the same bargain a
  // compiler strikes, so `--lint` is safe to leave on in a pipeline.
  const lintErrors = lintFindings.filter((finding) => finding.severity === 'error')
  const ok = errors.length === 0 && lintErrors.length === 0

  const payload: Record<string, unknown> = {
    ok,
    project: loaded.project.name,
    target,
    pous: result.pouNames,
    errors,
    warnings,
  }
  if (boolFlag(args, 'emit-st')) payload.st = result.programSt
  if (boolFlag(args, 'lint')) payload.lint = lintFindings

  // Which `conf/*.json` the upload would carry. The runtime decides which
  // plugins to load from exactly that file set and offers no way to read it
  // back, so this — computed by the same code that produces the bundle — IS the
  // enable state, with no device needed.
  if (boolFlag(args, 'protocols')) {
    payload.protocols = describeProtocolConfs(loaded.project.compileReady, debugMapContent, (message, level) => {
      if (level === 'error' || level === 'warning') reporter.progress(`  ${level}: ${message}`)
    })
  }

  // A failed check is a real result, not a CLI fault: it reports through the
  // normal payload and a compile-failed exit code, the way `compile` does.
  if (!ok) {
    return reporter.partial(
      payload,
      {
        code: ErrorCode.CompileFailed,
        message:
          errors.length > 0
            ? `${errors.length} error(s) in ${loaded.project.name}.`
            : `${lintErrors.length} lint error(s) in ${loaded.project.name}.`,
      },
      ExitCode.CompileFailed,
      () => renderCheck(payload, errors, warnings),
    )
  }

  return reporter.success(payload, () => renderCheck(payload, errors, warnings))
}

/**
 * POUs in the order they appear in the generated ST, for the per-POU splitter
 * that gives strucpp errors a real file name instead of `program.st`.
 *
 * Built here rather than through `buildKnownPous`, which takes the backend
 * schema's nested `{type, data}` POU; this side holds the flat port shape.
 */
function knownPous(data: PLCProjectData): KnownPou[] {
  return data.pous.map((pou) => ({
    name: pou.name,
    kind:
      pou.pouType === 'program'
        ? ('PROGRAM' as const)
        : pou.pouType === 'function'
          ? ('FUNCTION' as const)
          : ('FUNCTION_BLOCK' as const),
    language: pou.body.language as KnownPou['language'],
  }))
}

/**
 * Project the prepared data into the transpiler's shape.
 *
 * Wrapped because `fromSchemaShape` throws rather than accumulating: an SFC body
 * raises `SFC support is under development` at projection time, outside the
 * per-POU try/catch inside `transpileToSt`. One unsupported POU would otherwise
 * take the whole run down with an internal-error exit code.
 */
function projectToTranspiler(
  data: PLCProjectData,
): { ok: true; project: ReturnType<typeof fromSchemaShape> } | { ok: false; error: string } {
  try {
    // Through `toIpcProjectData` first, exactly as a real build does. That is
    // not a formality: it renames `configurations` to `configuration` and
    // reshapes every POU into `{type, data}`, and the transpiler reads both.
    // Handing it the port shape directly throws on the first POU.
    //
    // The cast afterwards is the one every caller of `fromSchemaShape` makes
    // (`compiler-module.ts:3348`, `desktop-library-build-port.ts:59`,
    // `editor-compiler-platform-port.ts:187`) — see the note on `IpcProjectData`.
    const ipc = toIpcProjectData(data)
    return { ok: true, project: fromSchemaShape(ipc as unknown as SchemaProjectData) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const culprit = data.pous.find((pou) => pou.body.language === 'sfc')
    return {
      ok: false,
      error: culprit ? `POU "${culprit.name}" (sfc body): ${message}` : message,
    }
  }
}

/** The transpiler prefixes every diagnostic with `POU "<name>"`. */
function mentionsPou(line: string, pouName: string): boolean {
  return line.toLowerCase().includes(`pou "${pouName.toLowerCase()}"`)
}

function renderCheck(payload: Record<string, unknown>, errors: string[], warnings: string[]): string {
  const pous = (payload.pous as string[]) ?? []
  const lint = (payload.lint as LintFinding[] | undefined) ?? []
  const lintErrors = lint.filter((finding) => finding.severity === 'error').length
  // Counted together, because a run that failed on lint alone reported
  // "FAILED — 0 error(s)" and showed nothing that had failed.
  const failures = errors.length + lintErrors
  const lines = [
    payload.ok === true
      ? `OK — ${pous.length} POU(s) transpiled for ${String(payload.target)}`
      : `FAILED — ${failures} error(s) in ${pous.length} POU(s) for ${String(payload.target)}`,
  ]
  for (const error of errors) lines.push(`  error: ${error}`)
  for (const warning of warnings) lines.push(`  warning: ${warning}`)
  for (const finding of lint) {
    lines.push(`  ${finding.severity}: [${finding.rule}] ${finding.pou ? `${finding.pou}: ` : ''}${finding.message}`)
  }
  const protocols = payload.protocols as ProtocolConfs | undefined
  if (protocols) {
    lines.push('', 'Protocol configs this project would upload:')
    if (!protocols.ok) {
      lines.push(`  error: ${protocols.error}`)
    } else {
      for (const [name, summary] of Object.entries(protocols.confs)) {
        lines.push(`  ${name.padEnd(14)} ${summary.confFile ?? '(not generated — the plugin stays off)'}`)
      }
    }
  }
  if (typeof payload.st === 'string') lines.push('', payload.st)
  return lines.join('\n')
}
