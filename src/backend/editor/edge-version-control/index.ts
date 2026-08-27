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

import type { VersionControlFailure, VersionControlResult } from '../../../middleware/shared/ports/version-control-port'
import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBody } from '../edge-account/edge-http'

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
interface EdgeEnvelope<T> {
  statusCode?: number
  data?: T
}

/**
 * Pull something readable out of a failure body.
 *
 * Nest's exception filter puts the reason in `message`, which may be a string or an array
 * of validation strings. Falling back to the status keeps the UI from showing an empty
 * toast when a proxy answers with HTML.
 */
function messageFromBody(body: string, status: number): string {
  const parsed = parseJsonBody<{ message?: string | string[] }>(body)
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
async function call<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown } = {},
  on409?: (body: string) => EdgeVcFailure | null,
): Promise<EdgeVcResult<T>> {
  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest(path, { ...init, timeoutMs: VC_TIMEOUT_MS })
  } catch (error) {
    // Rejection from `edgeAuthedRequest` means no answer at all — see edge-http's
    // contract. This is the one branch that must not be reported as a denial.
    return { ok: false, failure: { kind: 'unreachable', message: error instanceof Error ? error.message : 'No answer' } }
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

  const envelope = parseJsonBody<EdgeEnvelope<T>>(body)

  if (!envelope || envelope.data === undefined) {
    // A 2xx whose body we cannot read is not a success we can hand to the UI.
    return {
      ok: false,
      failure: { kind: 'http', status, message: 'Autonomy Edge returned an unreadable response.' },
    }
  }

  return { ok: true, data: envelope.data }
}

/** For the routes whose answer the caller ignores (delete, discard, drop). */
async function callVoid(
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown } = {},
  on409?: (body: string) => EdgeVcFailure | null,
): Promise<EdgeVcResult<null>> {
  const result = await call<unknown>(path, init, on409)

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
  const payload = parseJsonBody<{ hasConflicts?: boolean; conflictedFiles?: string[] }>(body)

  return payload?.hasConflicts ? { kind: 'carry-conflict', conflictedFiles: payload.conflictedFiles ?? [] } : null
}

/**
 * The merge refusal. Same top-level body shape as the carry rejection, and the same
 * discriminator: only `hasConflicts` means "decide per file", so any other 409 on the
 * route stays an ordinary failure.
 */
function mergeConflict(body: string): EdgeVcFailure | null {
  const payload = parseJsonBody<{ hasConflicts?: boolean; conflictedFiles?: string[]; message?: string }>(body)

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
// Branches
// ---------------------------------------------------------------------------

export function listBranches(projectId: string) {
  return call<{ branches: unknown[] }>(`/projects/${projectId}/branches`)
}

export function createBranch(projectId: string, name: string) {
  return call<{ branch: unknown }>(`/projects/${projectId}/branches`, { method: 'POST', json: { name } })
}

export function deleteBranch(projectId: string, branchId: string) {
  return callVoid(`/projects/${projectId}/branches/${branchId}`, { method: 'DELETE' })
}

export function switchBranch(projectId: string, branchName: string, strategy: 'discard' | 'carry') {
  return call<{ message: string; branch: string }>(
    `/projects/${projectId}/branches/switch`,
    { method: 'POST', json: { branchName, strategy } },
    carryConflict,
  )
}

export function previewSwitchCarry(projectId: string, targetBranch: string) {
  const params = new URLSearchParams({ targetBranch })

  return call<{ conflicts: string[] }>(`/projects/${projectId}/branches/preview-switch-carry?${params}`)
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export function listCommits(projectId: string, options: { limit?: number; offset?: number; branch?: string } = {}) {
  const params = new URLSearchParams()

  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.branch) params.set('branch', options.branch)

  const query = params.toString()

  return call<{ commits: unknown[]; total: number; page: number }>(
    `/projects/${projectId}/commits${query ? `?${query}` : ''}`,
  )
}

export function createCommit(projectId: string, message: string, files?: string[], branch?: string) {
  const json: Record<string, unknown> = { message }

  if (files) json.files = files
  if (branch) json.branch = branch

  return call<unknown>(`/projects/${projectId}/commits`, { method: 'POST', json })
}

export function getCommitFiles(projectId: string, hash: string, branch?: string) {
  const params = branch ? `?branch=${encodeURIComponent(branch)}` : ''

  return call<{ files: unknown[]; parentFiles: unknown[]; commit: unknown }>(
    `/projects/${projectId}/commits/${hash}/files${params}`,
  )
}

export function restoreCommit(projectId: string, hash: string, branch?: string) {
  const json: Record<string, unknown> = {}

  if (branch) json.branch = branch

  return call<{ message: string; restoredCommit: unknown }>(`/projects/${projectId}/commits/${hash}/restore`, {
    method: 'POST',
    json,
  })
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

  const query = search.toString()

  return call<{ changes: unknown[]; hasChanges: boolean }>(
    `/projects/${projectId}/changes${query ? `?${query}` : ''}`,
  )
}

export function discardChanges(projectId: string, files?: string[]) {
  // `branch` omitted for the same reason as `getChanges`.
  const json: Record<string, unknown> = {}

  if (files) json.files = files

  return callVoid(`/projects/${projectId}/discard-changes`, { method: 'POST', json })
}

// ---------------------------------------------------------------------------
// Stashes
// ---------------------------------------------------------------------------

export function listStashes(projectId: string) {
  return call<{ stashes: unknown[] }>(`/projects/${projectId}/stashes`)
}

export function createStash(projectId: string, message?: string, files?: string[]) {
  const json: Record<string, unknown> = {}

  if (message) json.message = message
  if (files && files.length > 0) json.files = files

  return call<{ stash: unknown }>(`/projects/${projectId}/stashes`, { method: 'POST', json })
}

export function applyStash(projectId: string, ref: string) {
  return call<{ message: string }>(
    `/projects/${projectId}/stashes/apply`,
    { method: 'POST', json: { ref } },
    stashConflict,
  )
}

export function popStash(projectId: string, ref: string) {
  return call<{ message: string }>(`/projects/${projectId}/stashes/pop`, { method: 'POST', json: { ref } }, stashConflict)
}

export function dropStash(projectId: string, ref: string) {
  return callVoid(`/projects/${projectId}/stashes/drop`, { method: 'POST', json: { ref } })
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

export function getBranchDiffWithBase(projectId: string, source: string, target: string) {
  const params = new URLSearchParams({ source, target })

  return call<unknown>(`/projects/${projectId}/branches-diff-with-base?${params}`)
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

  return call<unknown>(`/projects/${params.projectId}/branches/merge`, { method: 'POST', json }, mergeConflict)
}
