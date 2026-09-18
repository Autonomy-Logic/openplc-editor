/**
 * `openplc-cli inspect image` — what a build would size this project's I/O
 * image to, without building it.
 *
 * Loads the project exactly as `compile` does and stops before the transpiler,
 * so it needs no arduino-cli, no strucpp and no device.
 */

import { HardwareModule } from '@root/backend/editor/hardware'
import { buildIoDiagnostics, type IoDiagnostics } from '@root/frontend/services/io-diagnostics'
import { openPLCStoreBase } from '@root/frontend/store'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import { type CliResult, renderTable, type Reporter } from '../output'
import { loadProject } from '../project/load'

const SUBCOMMANDS: readonly string[] = ['image']

export async function runInspect(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  // `inspect image <project>` and `inspect <project>` both work: the second
  // token is the subcommand when it names one and the project otherwise.
  const named = args.subcommand !== undefined && SUBCOMMANDS.includes(args.subcommand)
  const projectPath = named ? args.positionals[0] : args.subcommand

  if (!projectPath) {
    return reporter.failure(
      { code: ErrorCode.MissingArgument, message: 'inspect image needs a project path.' },
      ExitCode.Usage,
    )
  }

  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound)
  }
  const project = loaded.project
  for (const warning of project.warnings) reporter.progress(`warning: ${warning}`)

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

  // The dropdown's own board list, so the CLI and the editor's panel read the
  // target from the same place.
  const boardInfo = (await new HardwareModule().getAvailableBoards()).get(target)
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

  const state = openPLCStoreBase.getState()
  const diagnostics = buildIoDiagnostics({
    board: target,
    boardInfo,
    projectData: project.compileReady,
    devicePinMapping: state.deviceDefinitions.pinMapping.pinsByBoard[target] ?? [],
    ...(project.vendorScreenData ? { vendorScreenData: project.vendorScreenData } : {}),
  })

  return reporter.success({ project: project.name, target, diagnostics }, () =>
    render(diagnostics, boolFlag(args, 'verbose')),
  )
}

function render(diagnostics: IoDiagnostics, verbose: boolean): string {
  const sections: string[] = [renderTarget(diagnostics), renderAreas(diagnostics)]

  if (diagnostics.servers.length > 0) sections.push(renderServers(diagnostics))
  if (diagnostics.located.length > 0) sections.push(renderLocated(diagnostics))
  if (diagnostics.claims.length > 0) sections.push(renderClaims(diagnostics, verbose))
  if (diagnostics.conflicts.length > 0) sections.push(renderConflicts(diagnostics))

  const issues = [
    ...diagnostics.issues.unsupported,
    ...diagnostics.issues.unbacked,
    ...diagnostics.issues.duplicateOutputs,
  ]
  sections.push(issues.length === 0 ? 'Issues: none.' : `Issues:\n${issues.map((line) => `  ${line}`).join('\n')}`)

  if (verbose) {
    sections.push(`image.conf:\n${indent(diagnostics.artifacts.imageConf)}`)
    sections.push(
      diagnostics.artifacts.processImageDefines === ''
        ? 'defines.h process image: not emitted for this target.'
        : `defines.h process image:\n${indent(diagnostics.artifacts.processImageDefines)}`,
    )
  }

  return sections.join('\n\n')
}

function renderTarget({ target }: IoDiagnostics): string {
  const lines = [
    `Target: ${target.board} (${target.kind})${target.resolved ? '' : ' — DID NOT RESOLVE, producers left permissive'}`,
    `  sizes the image: ${target.sizesTheImage ? 'yes' : 'no — this target is not sized, the numbers below are what the project asks for'}`,
    `  producers active: ${target.activeProducers.join(', ') || 'none'}`,
    `  producers off:    ${target.inactiveProducers.join(', ') || 'none'}`,
  ]
  return lines.join('\n')
}

function renderAreas({ areas }: IoDiagnostics): string {
  const rows = areas.map((area) => [
    area.table,
    area.prefix,
    area.present ? String(area.size) : '-',
    area.unit,
    area.origin ?? (area.present ? '-' : 'area absent on this target'),
    area.macro ?? '-',
  ])
  return `I/O image:\n${renderTable(['TABLE', 'PREFIX', 'SIZE', 'UNIT', 'SIZED BY', 'BAREMETAL MACRO'], rows)}`
}

function renderServers({ servers }: IoDiagnostics): string {
  const rows = servers.map((server) => [
    server.name,
    server.protocol,
    server.enabled ? 'yes' : 'no',
    server.runs ? 'yes' : 'no',
    server.dispatched ? (server.sizes ? 'yes' : 'no — another server of this protocol is the one read') : 'never',
  ])
  return `Servers:\n${renderTable(['NAME', 'PROTOCOL', 'ENABLED', 'TARGET RUNS IT', 'SIZES THE IMAGE'], rows)}`
}

function renderLocated({ located }: IoDiagnostics): string {
  const rows = located.map((variable) => [
    variable.scope,
    variable.name,
    variable.location,
    String(variable.slots),
    variable.issue ?? 'ok',
  ])
  return `Located declarations:\n${renderTable(['SCOPE', 'NAME', 'LOCATION', 'SLOTS', 'VERDICT'], rows)}`
}

/** Summarised by default: a backplane runs to hundreds of rows and buries
 *  every other section. */
function renderClaims({ claims }: IoDiagnostics, verbose: boolean): string {
  if (verbose) {
    const rows = claims.map((claim) => [claim.address, claim.kind, claim.ref, claim.alias || '-'])
    return `Producer claims (${claims.length}):\n${renderTable(['ADDRESS', 'PRODUCER', 'SOURCE', 'ALIAS'], rows)}`
  }

  const byKind = new Map<string, number>()
  for (const claim of claims) byKind.set(claim.kind, (byKind.get(claim.kind) ?? 0) + 1)
  const rows = [...byKind].map(([kind, count]) => [kind, String(count)])
  return `Producer claims (${claims.length} total; --verbose lists them):\n${renderTable(['PRODUCER', 'ADDRESSES'], rows)}`
}

function renderConflicts({ conflicts }: IoDiagnostics): string {
  const rows = conflicts.map((conflict) => [
    conflict.address,
    conflict.sources.map((source) => `${source.kind}:${source.ref}`).join(' vs '),
  ])
  return `Address conflicts:\n${renderTable(['ADDRESS', 'CLAIMED BY'], rows)}`
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : `  ${line}`))
    .join('\n')
}
