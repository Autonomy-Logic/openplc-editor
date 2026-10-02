/**
 * `openplc-cli install-skill` — copy the shipped skill into an agent directory.
 *
 * Deliberately not automatic on first run. `install-cli` earns that because
 * nothing else can put the binary on PATH; writing into `~/.claude/` when
 * someone launches a PLC editor would be a surprise.
 */

import { installSkill } from '@root/backend/editor/skill/install-skill'
import { resolveSkillPath } from '@root/backend/editor/skill/skill-source'

import { type ParsedArgs, stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'
import { skillEnvironment } from './skill'

export function runInstallSkill(args: ParsedArgs, reporter: Reporter): CliResult {
  const name = stringFlag(args, 'name') ?? 'openplc'
  const scope = stringFlag(args, 'scope') === 'user' ? 'user' : 'project'
  const projectPath = stringFlag(args, 'path') ?? args.positionals[0]

  const source = resolveSkillPath(skillEnvironment(), name)
  if (!source) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `This build ships no skill named "${name}".` },
      ExitCode.NotFound,
    )
  }

  // `force` on an explicit invocation: the user asked for this one, so a
  // same-content file is refreshed rather than reported as a conflict.
  const result = installSkill({ source, scope, projectPath, name, force: false })

  switch (result.status) {
    case 'installed':
      return reporter.success(
        { ok: true, status: result.status, path: result.path },
        () => `Installed to ${result.path}`,
      )
    case 'unchanged':
      return reporter.success(
        { ok: true, status: result.status, path: result.path },
        () => `Already up to date at ${result.path}`,
      )
    case 'skipped':
      return reporter.failure(
        { code: ErrorCode.TargetError, message: `Not installed: ${result.reason}` },
        ExitCode.TargetError,
      )
    case 'failed':
      return reporter.failure({ code: ErrorCode.Internal, message: result.error }, ExitCode.Internal)
    default: {
      const unreachable: never = result
      return reporter.internalError(new Error(`Unhandled install result: ${JSON.stringify(unreachable)}`))
    }
  }
}
