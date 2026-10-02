/**
 * `openplc-cli skill` — print the agent skill this build ships.
 *
 * Primary over `install-skill` because it needs no filesystem permission, works
 * in a container or CI, and cannot go stale against the binary: the text comes
 * out of the same package the commands do.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { resolveSkillPath, resolveSkillRoot } from '@root/backend/editor/skill/skill-source'
import { app } from 'electron'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'

export function skillEnvironment() {
  return { packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }
}

export function runSkill(args: ParsedArgs, reporter: Reporter): CliResult {
  const environment = skillEnvironment()

  if (boolFlag(args, 'list')) {
    const root = resolveSkillRoot(environment)
    const names = root ? readdirSync(root).filter((entry) => statSync(join(root, entry)).isDirectory()) : []
    return reporter.success({ ok: true, skills: names }, () =>
      names.length === 0 ? 'This build ships no skills.' : names.join('\n'),
    )
  }

  const name = stringFlag(args, 'name') ?? args.positionals[0] ?? 'openplc'
  const path = resolveSkillPath(environment, name)
  if (!path) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `This build ships no skill named "${name}".` },
      ExitCode.NotFound,
    )
  }

  const body = readFileSync(join(path, 'SKILL.md'), 'utf-8')
  const references = readReferences(path)

  return reporter.success({ ok: true, name, skill: body, references }, () => body)
}

/** The reference pages, so one call gives an agent everything. */
function readReferences(skillPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const directory = join(skillPath, 'references')
    for (const entry of readdirSync(directory)) {
      if (entry.endsWith('.md')) out[entry.replace(/\.md$/, '')] = readFileSync(join(directory, entry), 'utf-8')
    }
  } catch {
    // A skill with no references is legal.
  }
  return out
}
