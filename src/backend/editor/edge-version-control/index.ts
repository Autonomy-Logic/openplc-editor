/**
 * Version control against Autonomy Edge, from the desktop main process.
 *
 * The git repository lives beside the project on the server: Edge's own worker runs the
 * commits, the branch switches and the stashes. So this module is a transport and nothing
 * more — the same role the web build's adapter plays, hitting the same seventeen routes
 * with the same payloads. That is deliberate and it is the whole design: `carry` conflict
 * detection, stash semantics and restore are real git behaviour implemented once, on the
 * server, and reimplementing any of it here would produce a desktop that *looks* like the
 * web editor and disagrees with it under load.
 *
 * WHY IT RETURNS RESULTS INSTEAD OF THROWING. The renderer's UI branches on
 * `error instanceof SwitchBranchCarryConflictError` and `error instanceof
 * StashConflictError`. A class instance does not survive the structured clone that IPC
 * puts it through — the prototype is lost and every `instanceof` silently answers false,
 * which would turn "these files conflict, pick discard or cancel" into a console error and
 * a switch that appears to do nothing. So failures cross the boundary as plain data with a
 * `kind`, and the adapter on the other side builds the real error object back. The typed
 * failures are the reason this file exists in this shape.
 *
 * WHY THE MAIN PROCESS AT ALL. The renderer is not on Edge's origin, and the session's
 * access token is held here (encrypted at rest) rather than being handed to the renderer.
 * Every authenticated call the editor makes already goes through `edgeAuthedRequest`,
 * which owns renewal and the single retry.
 */

import { z } from 'zod'

import type { VersionControlFailure, VersionControlResult } from '../../../middleware/shared/ports/version-control-port'
import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBody, parseJsonBodyAs } from '../edge-account/edge-http'
import { logger } from '../services'

/**
 * Git work against a whole project is not an auth round trip. Matches the web build's
 * axios timeout exactly, so the same commit on the same project gives up at the same
 * point on both platforms.
 */
const VC_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Result shape — serialisable, because it crosses IPC
// ---------------------------------------------------------------------------

/**
 * Why each of these is kept apart rather than collapsed into a message:
 *
 *  - `signed-out` — there is no session to spend. The user signs in; nothing is wrong
 *    with the project.
 *  - `unreachable` — the server never answered, so NOTHING was learned. Reporting this as
 *    a denial would tell someone their branch cannot be created when the truth is that
 *    their wifi dropped.
 *  - `carry-conflict` / `stash-conflict` — the two cases the UI has real recovery flows
 *    for. They carry exactly what those flows need.
 *  - `http` — everything else, with the status, so a 403 on a read-only project reads
 *    differently from a 500.
 */
export type EdgeVcFailure = VersionControlFailure

export type EdgeVcResult<T> = VersionControlResult<T>

/** The `{ statusCode, data }` envelope every Edge route answers with. */
/**
 * Every answer arrives wrapped as `{ statusCode, data }`. The wrapper is validated
 * here and the payload by the schema each route passes in, so a 2xx carrying a body
 * this build does not understand is reported as unreadable rather than handed to the
 * renderer as if it were the expected shape.
 */
const edgeEnvelopeOf = <Schema extends z.ZodTypeAny>(data: Schema) =>
  z.object({ statusCode: z.number().optional(), data: data.optional() })

/** A `message` field as Nest's exception filter writes it. */
const FailureBodySchema = z.object({ message: z.union([z.string(), z.array(z.string())]).nullish() })

/**
 * A human-readable caption the server sends alongside a completed operation.
 *
 * `.catch('')` rather than a required string: the port types these `string`, but the
 * operation they describe has already happened on the server by the time the body is
 * read. Failing a successful branch switch because its confirmation sentence was
 * missing would report the wrong thing entirely — the fields with semantics
 * (`branch`, `conflicts`, `total`) stay strict.
 */
const CaptionSchema = z.string().catch('')

/** A counter the server may omit. Absent reads as zero rather than as a failure. */
const CountSchema = z.number().catch(0)

/** The top-level 409 body shared by the carry rejection and the merge refusal. */
const ConflictBodySchema = z.object({
  hasConflicts: z.boolean().nullish(),
  conflictedFiles: z.array(z.string()).nullish(),
  message: z.string().nullish(),
})

/**
 * Pull something readable out of a failure body.
 *
 * Nest's exception filter puts the reason in `message`, which may be a string or an array
 * of validation strings. Falling back to the status keeps the UI from showing an empty
 * toast when a proxy answers with HTML.
 */
function messageFromBody(body: string, status: number): string {
  const parsed = parseJsonBodyAs(body, FailureBodySchema)
  const raw = parsed?.message

  if (Array.isArray(raw) && raw.length > 0) {
    return raw.join('; ')
  }

  if (typeof raw === 'string' && raw.length > 0) {
    return raw
  }

  return `Autonomy Edge answered ${status}.`
}

/**
 * One authenticated call, with the failure taxonomy applied.
 *
 * `on409` is how the two conflict flows get their own kind. Only the routes that can
 * conflict pass it, so a 409 anywhere else stays an ordinary HTTP failure rather than
 * being mistaken for a conflict the UI knows how to resolve.
 */
async function call<Schema extends z.ZodTypeAny>(
  target: Route,
  schema: Schema,
  init: { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown } = {},
  on409?: (body: string) => EdgeVcFailure | null,
): Promise<EdgeVcResult<z.infer<Schema>>> {
  if (!target.ok) {
    // Never sent. Reported as a 400 because that is what it is: a request this side
    // refused to form, not one the server refused to serve.
    return { ok: false, failure: { kind: 'http', status: 400, message: target.message } }
  }

  const { path } = target
  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest(path, { ...init, timeoutMs: VC_TIMEOUT_MS })
  } catch (error) {
    // Rejection from `edgeAuthedRequest` means no answer at all — see edge-http's
    // contract. This is the one branch that must not be reported as a denial.
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
    const failure = on409(body)

    if (failure) {
      return { ok: false, failure }
    }
  }

  if (status >= 400) {
    return { ok: false, failure: { kind: 'http', status, message: messageFromBody(body, status) } }
  }

  const envelope = edgeEnvelopeOf(schema).safeParse(parseJsonBody(body))

  if (!envelope.success || envelope.data.data === undefined) {
    // A 2xx whose body we cannot read is not a success we can hand to the UI.
    //
    // Logged with the field that failed, because the message alone is a dead end: a
    // developer facing "unreadable response" on a 200 has no way to tell a server that
    // changed its shape from a schema here that is stricter than the server ever was.
    // Both have happened; the second one cost an afternoon.
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
  on409?: (body: string) => EdgeVcFailure | null,
): Promise<EdgeVcResult<null>> {
  const result = await call(target, z.unknown(), init, on409)

  // These routes may answer 204, or 200 with no `data`. Both are success, so the
  // unreadable-body check in `call` has to be relaxed for them rather than turning an
  // empty success into an error.
  if (!result.ok && result.failure.kind === 'http' && result.failure.status < 400) {
    return { ok: true, data: null }
  }

  return result.ok ? { ok: true, data: null } : result
}

/**
 * The carry rejection. The 409 body sits at the TOP level, not inside `data` — matching
 * how the web adapter reads `error.response.data`. `hasConflicts` is what distinguishes a
 * blocked carry from any other conflict on the same route.
 */
function carryConflict(body: string): EdgeVcFailure | null {
  const payload = parseJsonBodyAs(body, ConflictBodySchema)

  return payload?.hasConflicts ? { kind: 'carry-conflict', conflictedFiles: payload.conflictedFiles ?? [] } : null
}

/**
 * The merge refusal. Same top-level body shape as the carry rejection, and the same
 * discriminator: only `hasConflicts` means "decide per file", so any other 409 on the
 * route stays an ordinary failure.
 */
function mergeConflict(body: string): EdgeVcFailure | null {
  const payload = parseJsonBodyAs(body, ConflictBodySchema)

  return payload?.hasConflicts
    ? {
        kind: 'merge-conflict',
        conflictedFiles: payload.conflictedFiles ?? [],
        message: payload.message ?? 'The merge has conflicts that need resolving',
      }
    : null
}

/** Apply and pop answer 409 when the stash will not go on cleanly. */
function stashConflict(): EdgeVcFailure {
  return { kind: 'stash-conflict' }
}

// ---------------------------------------------------------------------------
// Paths — every id interpolated into a route goes through here
// ---------------------------------------------------------------------------

class InvalidRouteSegmentError extends Error {
  constructor(readonly segment: string) {
    super(`Refusing to build a request from "${segment}".`)
    this.name = 'InvalidRouteSegmentError'
  }
}

/**
 * A path segment safe to interpolate into a route.
 *
 * Encoded so a branch named `feat/x` reaches the server as one segment, and refused
 * outright for the values encoding alone cannot make safe: a `..` or a `/` here would
 * let an id received from the renderer address a different route on the same
 * authenticated session.
 */
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

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export function listCommits(projectId: string, options: { limit?: number; offset?: number; branch?: string } = {}) {
  const params = new URLSearchParams()

  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.branch) params.set('branch', options.branch)

  return call(
    withQuery(route`/projects/${projectId}/commits`, params),
    // `total` and `page` are the pagination counters, and the server does not always
    // send them. The port types them `number`, so they default rather than fail: a
    // history that arrived without its page counter is still a history, and refusing
    // it would blank the History tab over a field nothing on screen depends on.
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

// ---------------------------------------------------------------------------
// Working tree
// ---------------------------------------------------------------------------

export function getChanges(projectId: string, includeContent?: boolean) {
  // No `branch` param, deliberately: the backend's validation whitelist rejects unknown
  // query params, and pending changes are always computed against the worker's checked-out
  // HEAD anyway. Sending it produces a 400 and nothing else. Same omission the web adapter
  // documents.
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

// ---------------------------------------------------------------------------
// Stashes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

export function getBranchDiffWithBase(projectId: string, source: string, target: string) {
  const params = new URLSearchParams({ source, target })

  return call(withQuery(route`/projects/${projectId}/branches-diff-with-base`, params), z.unknown())
}

/**
 * A merge is the one call here that can take real time: the server walks three trees and
 * writes a commit. It gets the same 30s budget as the rest, which matches the web build.
 *
 * `mergeConflict` is what turns the 409 into its own kind, so the renderer can rebuild
 * `MergeConflictError` and open the resolver instead of reporting a failure.
 */
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
