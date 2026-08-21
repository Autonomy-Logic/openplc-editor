/**
 * `openplc-cli create` — the New Project flow (AC1).
 *
 * Calls `ProjectService.createProject`, which is what the editor's New Project
 * modal reaches through `ProjectPort.createProject` → `project:create` → the
 * same service. So a project created here is the same bytes the GUI writes:
 * `createProjectDefaultStructure` lays out the directories and files, and the
 * project history is updated exactly as it is for a GUI creation.
 *
 * Details are accepted as flags or as a single JSON file (`--from-json`), so a
 * test suite can keep fixtures under version control and create them
 * reproducibly.
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { ProjectService } from '@root/backend/editor/services'
import type { CreateProjectFileProps } from '@root/types/IPC/project-service/create-project'

import type { ParsedArgs } from '../args'
import { stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'

/** The fields the New Project form collects, and nothing more. */
type CreateProjectSpec = CreateProjectFileProps

const LANGUAGES = ['il', 'st', 'ld', 'sfc', 'fbd'] as const
const TYPES = ['plc-project', 'plc-library'] as const
/**
 * The New Project form's own default task interval.
 *
 * `T#20ms`, matching `new-project/steps/second-step.tsx` — the `T#` prefix is
 * required IEC duration syntax, and the value is emitted verbatim into the
 * generated `TASK task0(INTERVAL := …)`. Defaulting to a bare `20ms` produced a
 * project that failed to compile with
 * `Expected RParen, found identifier MS`, which looks like a compiler bug rather
 * than a malformed default.
 */
const DEFAULT_TASK_INTERVAL = 'T#20ms'

export async function runCreate(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const spec = await resolveSpec(args)
  if ('error' in spec) {
    return reporter.failure({ code: ErrorCode.InvalidArgument, message: spec.error }, ExitCode.Usage)
  }

  reporter.progress(`Creating ${spec.value.type === 'plc-library' ? 'library' : 'project'} "${spec.value.name}"…`)

  // No window: `ProjectService`'s dialog parent is optional, and the create path
  // never opens one.
  const result = await new ProjectService().createProject(spec.value)
  if (!result.success || !result.data) {
    return reporter.failure(
      {
        code: ErrorCode.Internal,
        message: result.error?.description ?? 'Failed to create the project',
      },
      ExitCode.Internal,
    )
  }

  // The service response carries the path it wrote; name and type come from the
  // spec, since `IProjectServiceResponse.meta` only reports the path.
  const projectPath = result.data.meta.path
  return reporter.success(
    { name: spec.value.name, type: spec.value.type, projectPath },
    () => `Created "${spec.value.name}" at ${projectPath}`,
  )
}

/**
 * Build the spec from `--from-json` or from flags.
 *
 * The JSON file is the primary form for tests — a fixture in the repository
 * beside the test that uses it — and flags are the convenience for a person.
 * Flags override the file, so one fixture can be reused with a different path.
 */
async function resolveSpec(args: ParsedArgs): Promise<{ value: CreateProjectSpec } | { error: string }> {
  let fromFile: Record<string, unknown> = {}
  const jsonPath = stringFlag(args, 'from-json')
  if (jsonPath) {
    try {
      const parsed: unknown = JSON.parse(await readFile(jsonPath, 'utf-8'))
      if (typeof parsed !== 'object' || parsed === null) return { error: `${jsonPath} is not a JSON object` }
      fromFile = { ...parsed }
    } catch (error) {
      return { error: `Could not read ${jsonPath}: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const pick = (flag: string): string | undefined => stringFlag(args, flag) ?? asString(fromFile[flag])

  const name = pick('name') ?? args.positionals[0]
  if (!name) {
    return { error: 'A project name is required: `openplc-cli create <name> --path <dir>` or --from-json <file>' }
  }

  const rawPath = pick('path') ?? args.positionals[1]
  if (!rawPath) {
    return { error: 'A destination is required: --path <dir> (the project directory is created inside it)' }
  }

  const type = pick('type') ?? 'plc-project'
  if (!isOneOf(type, TYPES)) {
    return { error: `--type must be one of ${TYPES.join(', ')}` }
  }

  const language = pick('language') ?? 'st'
  if (!isOneOf(language, LANGUAGES)) {
    return { error: `--language must be one of ${LANGUAGES.join(', ')}` }
  }

  // `createProjectDefaultStructure` writes INTO the path it is given, so the
  // project directory is `<path>/<name>` — the same shape the GUI's form
  // produces, where the picker chooses a parent and the name becomes the folder.
  const parent = isAbsolute(rawPath) ? rawPath : resolve(rawPath)
  // `time` is the task interval the New Project form collects; the service type
  // requires it, so the form's own default stands in when it is omitted.
  const value: CreateProjectSpec = {
    name,
    type,
    path: join(parent, name),
    language,
    time: pick('time') ?? DEFAULT_TASK_INTERVAL,
  }
  return { value }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value)
}
