import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import { parse } from 'yaml'

/** One step of a job, as parsed. */
export type Step = Record<string, unknown>

/** One job of the workflow, with its id and its steps in order. */
export type Job = { id: string; body: Record<string, unknown>; steps: Step[] }

/** A workflow file's text and parsed document, with readers over its jobs; `job` throws naming the file and the job id. */
export type WorkflowReader = {
  readonly raw: string
  readonly doc: Record<string, unknown>
  jobs: () => Job[]
  job: (id: string) => Job
  needsOf: (entry: Job) => string[]
  uses: (step: Step) => string
  environmentOf: (entry: Job) => string | undefined
  /** Every job the given job waits for, directly or through another job. */
  upstream: (entry: Job) => Set<string>
}

/** The value as a plain object, or `{}` when it is not one. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** The value as an array, or `[]` when it is not one. */
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** The value as a string, or `''` when it is not one. */
export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The value as JSON text, or `''` when it has none. */
export function text(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

/** Every string value of a parsed YAML node, keys excluded, so YAML comments are never read. */
export function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  return Object.values(record(value)).flatMap(strings)
}

function needsOf(entry: Job): string[] {
  const needs = entry.body.needs
  return typeof needs === 'string' ? [needs] : list(needs).map(String)
}

function uses(step: Step): string {
  return str(step.uses)
}

function environmentOf(entry: Job): string | undefined {
  const environment = entry.body.environment
  if (environment === undefined) return undefined
  return typeof environment === 'string' ? environment : str(record(environment).name)
}

/** Whether the step runs actions/upload-artifact. */
export function isUploadArtifact(step: Step): boolean {
  return uses(step).startsWith('actions/upload-artifact')
}

/** Readers over the workflow at @p path, which is read and parsed on first use. */
export function workflowReader(path: string): WorkflowReader {
  const file = basename(path)
  let loaded: { raw: string; doc: Record<string, unknown> } | undefined

  function workflow(): { raw: string; doc: Record<string, unknown> } {
    if (loaded === undefined) {
      const raw = readFileSync(path, 'utf8')
      loaded = { raw, doc: record(parse(raw)) }
    }
    return loaded
  }

  function jobs(): Job[] {
    return Object.entries(record(workflow().doc.jobs)).map(([id, body]) => ({
      id,
      body: record(body),
      steps: list(record(body).steps).map(record),
    }))
  }

  function job(id: string): Job {
    const found = jobs().find((entry) => entry.id === id)
    if (found === undefined) throw new Error(`${file} has no job "${id}"`)
    return found
  }

  function upstream(entry: Job): Set<string> {
    const seen = new Set<string>()
    const pending = [...needsOf(entry)]
    while (pending.length > 0) {
      const id = pending.pop() ?? ''
      if (seen.has(id)) continue
      seen.add(id)
      pending.push(...needsOf(job(id)))
    }
    return seen
  }

  return {
    get raw() {
      return workflow().raw
    },
    get doc() {
      return workflow().doc
    },
    jobs,
    job,
    needsOf,
    uses,
    environmentOf,
    upstream,
  }
}

/** Why tests that run workflow steps under bash cannot run here: Windows, or the first of @p tools missing from PATH. */
export function stepRunnerSkipReason(tools: readonly ('bash' | 'jq')[]): string | null {
  if (process.platform === 'win32') return 'needs bash and symlinks, not run on Windows'
  const missing = tools.find((tool) => {
    const probe = spawnSync(tool, ['--version'], { stdio: 'ignore' })
    return probe.error !== undefined || probe.status !== 0
  })
  return missing === undefined ? null : `needs ${missing} on PATH`
}

/** @p title, ending with ` (skipped: <reason>)` when @p reason is not `null`. */
export function skippedTitle(title: string, reason: string | null): string {
  return reason === null ? title : `${title} (skipped: ${reason})`
}
