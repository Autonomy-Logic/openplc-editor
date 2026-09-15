// Failures are returned as plain data with a `kind`: an Error instance loses its prototype crossing IPC.

import { z } from 'zod'

import type { VersionControlFailure, VersionControlResult } from '../../../middleware/shared/ports/version-control-port'
import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBody } from '../edge-account/edge-http'
import { logger } from '../services'

/** Matches the web build's axios timeout. */
const VC_TIMEOUT_MS = 30_000

// Result shape

/** Failure taxonomy; `unreachable` means nothing was learned and must not read as a denial. */
export type EdgeVcFailure = VersionControlFailure

export type EdgeVcResult<T> = VersionControlResult<T>

/** The `{ statusCode, data }` envelope every Edge route answers with. */
const edgeEnvelopeOf = <Schema extends z.ZodTypeAny>(data: Schema) =>
  z.object({ statusCode: z.number().optional(), data: data.optional() })

/** A `message` field as Nest's exception filter writes it. */
const FailureBodySchema = z.object({ message: z.union([z.string(), z.array(z.string())]).nullish() })

/** Server caption; `.catch('')` because the operation already happened by the time the body is read. */
const CaptionSchema = z.string().catch('')

/** A counter the server may omit. Absent reads as zero rather than as a failure. */
const CountSchema = z.number().catch(0)

/** The 409 body shared by the carry rejection and the merge refusal; every field is optional. */
const ConflictBodySchema = z.object({
  conflictedFiles: z.array(z.string()).nullish(),
  message: z.string().nullish(),
})

/**
 * Edge's exception filter answers `{ timestamp, path, method, statusCode, error: <nest body> }`,
 * so the reason sits one level down; a few routes answer the bare body.
 */
const WrappedErrorSchema = z.object({ error: z.record(z.unknown()) })

/** The Nest body of a failure: from inside the exception filter's envelope when there is one, bare otherwise. */
function unwrapErrorBody(body: string): unknown {
  const parsed = parseJsonBody(body)
  const wrapped = WrappedErrorSchema.safeParse(parsed)

  return wrapped.success ? wrapped.data.error : parsed
}

/** Whatever of {@link ConflictBodySchema} the 409 body carried; a body carrying none of it is still a conflict. */
function conflictFieldsFrom(body: string): z.infer<typeof ConflictBodySchema> {
  const parsed = ConflictBodySchema.safeParse(unwrapErrorBody(body))

  return parsed.success ? parsed.data : {}
}

/** Nest puts the reason in `message`, as a string or an array of strings. */
function messageFromBody(body: string, status: number): string {
  const parsed = FailureBodySchema.safeParse(unwrapErrorBody(body))
  const raw = parsed.success ? parsed.data.message : undefined

  if (Array.isArray(raw) && raw.length > 0) {
    return raw.join('; ')
  }

  if (typeof raw === 'string' && raw.length > 0) {
    return raw
  }

  return `Autonomy Edge answered ${status}.`
}

/** One authenticated call; only routes that can conflict pass `on409`, so any other 409 stays an HTTP failure. */
async function call<Schema extends z.ZodTypeAny>(
  target: Route,
  schema: Schema,
  init: { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown } = {},
  on409?: (body: string) => EdgeVcFailure,
): Promise<EdgeVcResult<z.infer<Schema>>> {
  if (!target.ok) {
    // Never sent: a request this side refused to form.
    return { ok: false, failure: { kind: 'http', status: 400, message: target.message } }
  }

  const { path } = target
  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest(path, { ...init, timeoutMs: VC_TIMEOUT_MS })
  } catch (error) {
    // A rejection means no answer at all; must not be reported as a denial.
    return {
      ok: false,
      failure: { kind: 'unreachable', message: error instanceof Error ? error.message : 'No answer' },
    }
  }

  if (!response) {
    return { ok: false, failure: { kind: 'signed-out' } }
  }

  const { status, body } = response

  if (status === 401 || status === 403) {
    // 401 survived a renewal attempt inside `edgeAuthedRequest`, so it is a real
    // authorization failure. 403 is a project the account may read but not write.
    return status === 401
      ? { ok: false, failure: { kind: 'signed-out' } }
      : { ok: false, failure: { kind: 'http', status, message: messageFromBody(body, status) } }
  }

  if (status === 409 && on409) {
    // The route was given a handler because a 409 on it means one thing; the body only fills in the detail.
    return { ok: false, failure: on409(body) }
  }

  if (status >= 400) {
    return { ok: false, failure: { kind: 'http', status, message: messageFromBody(body, status) } }
  }

  const envelope = edgeEnvelopeOf(schema).safeParse(parseJsonBody(body))

  if (!envelope.success || envelope.data.data === undefined) {
    // Log the failing field: "unreadable response" alone cannot tell a changed server from a too-strict schema.
    logger.warn(
      `Unreadable ${path} response: ${
        envelope.success
          ? 'the envelope carried no data'
          : envelope.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')
      }`,
    )

    return {
      ok: false,
      failure: { kind: 'http', status, message: 'Autonomy Edge returned an unreadable response.' },
    }
  }

  return { ok: true, data: envelope.data.data }
}

/** For the routes whose answer the caller ignores (delete, discard, drop). */
async function callVoid(
  target: Route,
  init: { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown } = {},
  on409?: (body: string) => EdgeVcFailure,
): Promise<EdgeVcResult<null>> {
  const result = await call(target, z.unknown(), init, on409)

  // These routes may answer 204, or 200 with no `data`; both are success.
  if (!result.ok && result.failure.kind === 'http' && result.failure.status < 400) {
    return { ok: true, data: null }
  }

  return result.ok ? { ok: true, data: null } : result
}

/**
 * The carry rejection: a 409 on the switch route IS the conflict. Edge rethrows it as a plain
 * `ConflictException`, which carries no `hasConflicts` flag, so the status is the whole signal;
 * the files are read from the body when it happens to list them.
 */
function carryConflict(body: string): EdgeVcFailure {
  return { kind: 'carry-conflict', conflictedFiles: conflictFieldsFrom(body).conflictedFiles ?? [] }
}

/** The merge refusal; same reasoning as the carry rejection, plus the server's caption when it sent one. */
function mergeConflict(body: string): EdgeVcFailure {
  const { conflictedFiles, message } = conflictFieldsFrom(body)

  return {
    kind: 'merge-conflict',
    conflictedFiles: conflictedFiles ?? [],
    message: message ?? 'The merge has conflicts that need resolving',
  }
}

/** Apply and pop answer 409 when the stash will not go on cleanly. */
function stashConflict(): EdgeVcFailure {
  return { kind: 'stash-conflict' }
}

// Paths

class InvalidRouteSegmentError extends Error {
  constructor(readonly segment: string) {
    super(`Refusing to build a request from "${segment}".`)
    this.name = 'InvalidRouteSegmentError'
  }
}

/** Encodes a route segment; refuses `.`, `..` and `/?#`, which encoding alone cannot make safe. */
export function segment(value: string): string {
  if (value === '' || value === '.' || value === '..' || /[/?#]/.test(value)) {
    throw new InvalidRouteSegmentError(value)
  }

  return encodeURIComponent(value)
}

type Route = { ok: true; path: string } | { ok: false; message: string }

/** A route template whose every interpolated value is passed through {@link segment}. */
function route(strings: TemplateStringsArray, ...values: string[]): Route {
  try {
    return {
      ok: true,
      path: strings.reduce(
        (path, literal, index) => path + literal + (index < values.length ? segment(values[index]) : ''),
        '',
      ),
    }
  } catch (error) {
    if (error instanceof InvalidRouteSegmentError) {
      return { ok: false, message: error.message }
    }

    throw error
  }
}

/** Append a query string, when there is one. `URLSearchParams` does its own encoding. */
function withQuery(base: Route, params: URLSearchParams): Route {
  const query = params.toString()

  return base.ok && query ? { ok: true, path: `${base.path}?${query}` } : base
}

// Branches

export function listBranches(projectId: string) {
  return call(route`/projects/${projectId}/branches`, z.object({ branches: z.array(z.unknown()) }))
}

export function createBranch(projectId: string, name: string) {
  return call(route`/projects/${projectId}/branches`, z.object({ branch: z.unknown() }), {
    method: 'POST',
    json: { name },
  })
}

export function deleteBranch(projectId: string, branchId: string) {
  return callVoid(route`/projects/${projectId}/branches/${branchId}`, { method: 'DELETE' })
}

export function switchBranch(projectId: string, branchName: string, strategy: 'discard' | 'carry') {
  return call(
    route`/projects/${projectId}/branches/switch`,
    z.object({ message: CaptionSchema, branch: z.string() }),
    { method: 'POST', json: { branchName, strategy } },
    carryConflict,
  )
}

export function previewSwitchCarry(projectId: string, targetBranch: string) {
  const params = new URLSearchParams({ targetBranch })

  return call(
    withQuery(route`/projects/${projectId}/branches/preview-switch-carry`, params),
    z.object({ conflicts: z.array(z.string()) }),
  )
}

// Commits

export function listCommits(projectId: string, options: { limit?: number; offset?: number; branch?: string } = {}) {
  const params = new URLSearchParams()

  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.branch) params.set('branch', options.branch)

  return call(
    withQuery(route`/projects/${projectId}/commits`, params),
    // `total` and `page` are not always sent; default rather than blank the History tab.
    z.object({ commits: z.array(z.unknown()), total: CountSchema, page: CountSchema }),
  )
}

export function createCommit(projectId: string, message: string, files?: string[], branch?: string) {
  const json: Record<string, unknown> = { message }

  if (files) json.files = files
  if (branch) json.branch = branch

  return call(route`/projects/${projectId}/commits`, z.unknown(), { method: 'POST', json })
}

export function getCommitFiles(projectId: string, hash: string, branch?: string) {
  const params = new URLSearchParams()

  if (branch) params.set('branch', branch)

  return call(
    withQuery(route`/projects/${projectId}/commits/${hash}/files`, params),
    z.object({ files: z.array(z.unknown()), parentFiles: z.array(z.unknown()), commit: z.unknown() }),
  )
}

export function restoreCommit(projectId: string, hash: string, branch?: string) {
  const json: Record<string, unknown> = {}

  if (branch) json.branch = branch

  return call(
    route`/projects/${projectId}/commits/${hash}/restore`,
    z.object({ message: CaptionSchema, restoredCommit: z.unknown() }),
    { method: 'POST', json },
  )
}

// Working tree

export function getChanges(projectId: string, includeContent?: boolean) {
  // No `branch` param: the backend's whitelist rejects unknown query params with a 400.
  const search = new URLSearchParams()

  if (includeContent) search.set('includeContent', 'true')

  return call(
    withQuery(route`/projects/${projectId}/changes`, search),
    z.object({ changes: z.array(z.unknown()), hasChanges: z.boolean() }),
  )
}

export function discardChanges(projectId: string, files?: string[]) {
  // `branch` omitted for the same reason as `getChanges`.
  const json: Record<string, unknown> = {}

  if (files) json.files = files

  return callVoid(route`/projects/${projectId}/discard-changes`, { method: 'POST', json })
}

// Stashes

export function listStashes(projectId: string) {
  return call(route`/projects/${projectId}/stashes`, z.object({ stashes: z.array(z.unknown()) }))
}

export function createStash(projectId: string, message?: string, files?: string[]) {
  const json: Record<string, unknown> = {}

  if (message) json.message = message
  if (files && files.length > 0) json.files = files

  return call(route`/projects/${projectId}/stashes`, z.object({ stash: z.unknown() }), { method: 'POST', json })
}

export function applyStash(projectId: string, ref: string) {
  return call(
    route`/projects/${projectId}/stashes/apply`,
    z.object({ message: CaptionSchema }),
    { method: 'POST', json: { ref } },
    stashConflict,
  )
}

export function popStash(projectId: string, ref: string) {
  return call(
    route`/projects/${projectId}/stashes/pop`,
    z.object({ message: CaptionSchema }),
    { method: 'POST', json: { ref } },
    stashConflict,
  )
}

export function dropStash(projectId: string, ref: string) {
  return callVoid(route`/projects/${projectId}/stashes/drop`, { method: 'POST', json: { ref } })
}

// Merging

export function getBranchDiffWithBase(projectId: string, source: string, target: string) {
  const params = new URLSearchParams({ source, target })

  return call(withQuery(route`/projects/${projectId}/branches-diff-with-base`, params), z.unknown())
}

/** `mergeConflict` gives the 409 its own kind so the renderer can rebuild `MergeConflictError`. */
export function mergeBranches(params: {
  projectId: string
  sourceBranch: string
  targetBranch: string
  commitMessage?: string
  resolutions?: Record<string, string>
}) {
  const json: Record<string, unknown> = {
    sourceBranch: params.sourceBranch,
    targetBranch: params.targetBranch,
  }

  if (params.commitMessage) json.commitMessage = params.commitMessage
  if (params.resolutions) json.resolutions = params.resolutions

  return call(route`/projects/${params.projectId}/branches/merge`, z.unknown(), { method: 'POST', json }, mergeConflict)
}
