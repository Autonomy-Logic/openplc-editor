/**
 * `openplc-cli apply` — author a project from a declarative spec.
 *
 * Declarative rather than a sequence of commands for two reasons. Store actions
 * are order-dependent in ways a caller cannot see (a local variable needs its
 * POU first; an instance names a task and a program and validates neither), and
 * `executeSaveProject` serialises the entire project, so N fine-grained
 * commands would mean N full rewrites of every file.
 *
 * Upsert by name and idempotent: applying the same spec twice leaves the same
 * project. `--prune` additionally removes what the spec does not mention;
 * `--dry-run` reports the change list and saves nothing.
 */

import { readFile } from 'node:fs/promises'

import { executeSaveProject } from '@root/frontend/services/save-actions'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'

import { applySpec, type PlannedChange } from '../apply/plan'
import { parseApplySpec } from '../apply/schema'
import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'
import { loadProject, unreadableProtocolFilesMessage } from '../project/load'
import { createCliProjectPort } from '../project/project-port'

export async function runApply(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const specPath = args.positionals[0]
  if (!specPath) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'apply needs a spec file, or - to read one from stdin.' },
      ExitCode.Usage,
    )
  }

  const source = await readSpec(specPath)
  if (!source.ok) {
    return reporter.failure({ code: ErrorCode.InvalidArgument, message: source.error }, ExitCode.NotFound)
  }

  let raw: unknown
  try {
    raw = JSON.parse(source.text)
  } catch (err) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: `${specPath} is not valid JSON: ${describe(err)}` },
      ExitCode.Usage,
    )
  }

  const parsed = parseApplySpec(raw)
  if (!parsed.ok) {
    return reporter.failure(
      {
        code: ErrorCode.InvalidArgument,
        message: `${specPath} does not match the spec schema.`,
        details: parsed.issues,
      },
      ExitCode.Usage,
    )
  }

  const projectPath = stringFlag(args, 'project') ?? args.positionals[1]
  if (!projectPath) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'apply needs --project <dir>.' },
      ExitCode.Usage,
    )
  }

  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound)
  }
  for (const warning of loaded.project.warnings) reporter.progress(warning)

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

  // `executeSaveProject` refuses on either of these and says so only through a
  // toast, which goes nowhere here — without this check `apply` would report
  // success having written nothing.
  if (!loaded.project.canEdit) {
    return reporter.failure(
      {
        code: ErrorCode.TargetError,
        message: 'This project is read-only — it loaded with errors, so nothing would be saved.',
      },
      ExitCode.TargetError,
    )
  }
  if (loaded.project.isEphemeral) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: 'This project has no location on disk, so nothing would be saved.' },
      ExitCode.TargetError,
    )
  }

  const dryRun = boolFlag(args, 'dry-run')
  const outcome = await applySpec(parsed.spec, { prune: boolFlag(args, 'prune'), projectPath })

  // Errors before the save, always: a half-applied project written to disk is
  // worse than one not written at all, and the store is discarded on exit.
  if (outcome.errors.length > 0) {
    return reporter.partial(
      { ok: false, project: loaded.project.name, changes: outcome.changes, errors: outcome.errors, saved: false },
      {
        code: ErrorCode.InvalidArgument,
        message: `${outcome.errors.length} problem(s) in the spec — nothing was saved.`,
        details: outcome.errors,
      },
      ExitCode.CompileFailed,
      () => render(outcome.changes, outcome.errors, false),
    )
  }

  if (dryRun) {
    return reporter.success(
      { ok: true, project: loaded.project.name, changes: outcome.changes, errors: [], saved: false, dryRun: true },
      () => `${render(outcome.changes, [], false)}\n\nDry run — nothing written.`,
    )
  }

  const saved = await executeSaveProject(createCliProjectPort(), EDITOR_CAPABILITIES, 'user')
  if (!saved.success) {
    return reporter.failure({ code: ErrorCode.Internal, message: 'The project could not be saved.' }, ExitCode.Internal)
  }

  return reporter.success(
    { ok: true, project: loaded.project.name, changes: outcome.changes, errors: [], saved: true },
    () => render(outcome.changes, [], true),
  )
}

async function readSpec(specPath: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (specPath === '-') {
    try {
      let text = ''
      process.stdin.setEncoding('utf-8')
      for await (const chunk of process.stdin) text += String(chunk)
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: `Could not read the spec from stdin: ${describe(err)}` }
    }
  }
  try {
    return { ok: true, text: await readFile(specPath, 'utf-8') }
  } catch {
    return { ok: false, error: `Could not read ${specPath}` }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function render(changes: PlannedChange[], errors: string[], saved: boolean): string {
  if (changes.length === 0 && errors.length === 0) return 'Nothing to change.'

  const lines: string[] = []
  for (const change of changes) {
    lines.push(`  ${change.action} ${change.kind} ${change.name}`)
  }
  for (const error of errors) lines.push(`  error: ${error}`)

  const applied = changes.length
  lines.unshift(
    errors.length > 0
      ? `${applied} change(s) attempted, ${errors.length} problem(s)`
      : `${applied} change(s)${saved ? ' — saved' : ''}`,
  )
  return lines.join('\n')
}
