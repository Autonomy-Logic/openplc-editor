/**
 * The wire format lives in `backend/shared/project/api-envelope`, shared with
 * openplc-web. Saving is read-modify-write because the backend deletes by omission.
 */

import { z } from 'zod'

import { APP_VERSION } from '../../../frontend/data/constants/app-version'
import type {
  CloudProjectsResult,
  RawProjectFiles,
  WriteProjectFiles,
} from '../../../middleware/shared/ports/project-port'
import { OVER_PLAN_LIMIT, OVER_PLAN_LIMIT_MESSAGE } from '../../../middleware/shared/ports/version-control-port'
import {
  apiFilesToRaw,
  ApiProjectFilesSchema,
  envelopeFromWriteProjectFiles,
  getInEnvelope,
  type IncomingApiProjectFiles,
  mergeEnvelopeOverExisting,
  setInEnvelope,
} from '../../shared/project/api-envelope'
import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBody, parseJsonBodyAs } from '../edge-account/edge-http'

/** Every successful payload from the API arrives wrapped as `{ data: ... }`. */
const envelopeOf = <Schema extends z.ZodTypeAny>(data: Schema) => z.object({ data: data.nullish() })

/** Only `projectIds` is read; the endpoint also carries orchestrators, devices and seats. */
const OverflowSchema = envelopeOf(z.object({ projectIds: z.array(z.unknown()).nullish() }))

/** Fields stay `unknown`: the narrowing below decides whether a row is usable at all. */
const ApiProjectRowSchema = z
  .object({
    id: z.unknown(),
    name: z.unknown(),
    language: z.unknown(),
    updatedAt: z.unknown(),
  })
  // A row that isn't even an object becomes an empty one rather than failing the whole list.
  .catch({ id: undefined, name: undefined, language: undefined, updatedAt: undefined })

const RecentProjectsSchema = envelopeOf(z.object({ projects: z.array(ApiProjectRowSchema).nullish() }))

/** `.passthrough()`: the save endpoint deletes by omission, so an unnamed key would be stripped on read and deleted on the next save. */
const IncomingFilesSchema = ApiProjectFilesSchema.passthrough()

const ProjectFilesSchema = envelopeOf(z.object({ files: IncomingFilesSchema.nullish() }))

const ProjectDetailsSchema = envelopeOf(
  z.object({
    files: IncomingFilesSchema.nullish(),
    capabilities: z.object({ canEdit: z.boolean().nullish() }).nullish(),
  }),
)

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')
}

const UNREADABLE_PROJECT = 'Autonomy Edge returned a project this editor cannot read'

/**
 * Ordered by the server, since sorting a truncated page locally would be wrong. Which
 * kind of nothing it found is reported, as the start screen words each one differently.
 */
/**
 * Project ids the account can no longer write to: they sit beyond the active
 * plan's private-project limit, so Edge answers 403 to save, commit and every
 * other mutation (UC04 / RF12). Edge's own SPA drives its lock off this exact
 * endpoint, so asking it here is what keeps the two screens agreeing.
 *
 * A failure returns an empty set rather than propagating. Not knowing must not
 * cost the user their project list, and it fails safe in the right direction:
 * an unmarked locked project still gets refused by the API.
 */
async function lockedProjectIds(): Promise<Set<string>> {
  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest('/me/overflow')
  } catch {
    return new Set()
  }

  if (!response || response.status < 200 || response.status >= 300) {
    return new Set()
  }

  const ids = parseJsonBodyAs(response.body, OverflowSchema)?.data?.projectIds

  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
}

async function listCloudProjects(query: URLSearchParams): Promise<CloudProjectsResult> {
  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest(`/projects?${query.toString()}`)
  } catch {
    // Never reached the server: "signed out" would tell someone merely offline to sign
    // in again.
    return { status: 'unreachable' }
  }

  if (!response || response.status === 401 || response.status === 403) {
    return { status: 'signed-out' }
  }

  if (response.status < 200 || response.status >= 300) {
    // A 5xx says nothing about the session.
    return { status: 'unreachable' }
  }

  const rows = parseJsonBodyAs(response.body, RecentProjectsSchema)?.data?.projects

  if (!Array.isArray(rows)) {
    return { status: 'ok', projects: [] }
  }

  // Narrowed field by field, not cast: a row missing an id would otherwise become a
  // list entry that cannot be opened.
  const locked = await lockedProjectIds()

  const projects = rows.flatMap((row) => {
    if (typeof row?.id !== 'string' || typeof row.name !== 'string' || typeof row.updatedAt !== 'string') {
      return []
    }

    return [
      {
        id: row.id,
        name: row.name,
        language: typeof row.language === 'string' ? row.language : null,
        updatedAt: row.updatedAt,
        locked: locked.has(row.id),
      },
    ]
  })

  return { status: 'ok', projects }
}

export async function listRecentCloudProjects(limit: number): Promise<CloudProjectsResult> {
  return listCloudProjects(new URLSearchParams({ limit: String(limit), sortBy: 'updatedAt', sortOrder: 'desc' }))
}

/** The API caps a page at 50, so a folder holding more shows its 50 most recently changed. */
const FOLDER_PAGE_LIMIT = 50

export async function listCloudProjectsInFolder(folderId: string): Promise<CloudProjectsResult> {
  return listCloudProjects(
    new URLSearchParams({ folderId, limit: String(FOLDER_PAGE_LIMIT), sortBy: 'updatedAt', sortOrder: 'desc' }),
  )
}

/**
 * Omitting `uncached_version` is read as a stale cached bundle, and answered with a
 * synthetic "hard refresh" project instead of the real one.
 */
function detailsPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/details?uncached_version=${encodeURIComponent(APP_VERSION)}`
}

async function readEnvelope(
  projectId: string,
): Promise<{ ok: true; files: IncomingApiProjectFiles } | { ok: false; error: string }> {
  const response = await edgeAuthedRequest(detailsPath(projectId))

  if (!response) {
    return { ok: false, error: 'Not signed in to Autonomy Edge.' }
  }

  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: `Autonomy Edge answered ${response.status}.` }
  }

  const parsed = ProjectFilesSchema.safeParse(parseJsonBody(response.body))

  if (!parsed.success) {
    // Never swallowed into an empty container: a save that followed would delete everything.
    return { ok: false, error: `${UNREADABLE_PROJECT}: ${describeIssues(parsed.error)}.` }
  }

  const files = parsed.data.data?.files

  return files ? { ok: true, files } : { ok: false, error: 'Autonomy Edge returned no files.' }
}

function rawLoadedFilesFrom(raw: {
  projectJson: string
  deviceConfig: string
  pinMapping: string
  pouFiles: Array<{ relativePath: string; content: string }>
  serverFiles: Array<{ relativePath: string; content: string }>
  remoteDeviceFiles: Array<{ relativePath: string; content: string }>
}): Record<string, string> {
  const map: Record<string, string> = {
    'project.json': raw.projectJson,
    'devices/configuration.json': raw.deviceConfig,
    'devices/pin-mapping.json': raw.pinMapping,
  }

  for (const group of [raw.pouFiles, raw.serverFiles, raw.remoteDeviceFiles]) {
    for (const file of group) {
      map[file.relativePath] = file.content
    }
  }

  return map
}

export async function readCloudProject(projectId: string): Promise<RawProjectFiles> {
  try {
    const response = await edgeAuthedRequest(detailsPath(projectId))

    if (!response) {
      return {
        success: false,
        error: { title: 'Not signed in', description: 'Sign in to Autonomy Edge to open this project.' },
      }
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        success: false,
        error: {
          title: 'Failed to open project',
          description: `Autonomy Edge answered ${response.status}.`,
          // Carried so the caller can tell a permission denial from a broken project.
          status: response.status,
        },
      }
    }

    const parsed = ProjectDetailsSchema.safeParse(parseJsonBody(response.body))

    if (!parsed.success) {
      return {
        success: false,
        error: {
          title: 'Failed to open project',
          description: `${UNREADABLE_PROJECT}: ${describeIssues(parsed.error)}.`,
        },
      }
    }

    const payload = parsed.data.data
    const files = payload?.files

    if (!files) {
      return {
        success: false,
        error: { title: 'Failed to open project', description: 'Autonomy Edge returned no files.' },
      }
    }

    const raw = apiFilesToRaw(projectId, files)

    return {
      success: true,
      data: {
        ...raw,
        canEdit: payload?.capabilities?.canEdit ?? undefined,
        // The bytes exactly as the API sent them: echoed back for files the user didn't
        // edit rather than re-serialized, so an untouched file's bytes don't drift.
        rawLoadedFiles: rawLoadedFilesFrom(raw),
      },
    }
  } catch (error) {
    // Never reached the server: "you are offline" and "this project is broken" call for
    // completely different things from the user.
    return {
      success: false,
      error: {
        title: 'Could not reach Autonomy Edge',
        description: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}

/** `deletions` is omitted when empty, as the API expects. */
async function writeEnvelope(
  projectId: string,
  files: IncomingApiProjectFiles,
  deletions: string[],
): Promise<{ success: boolean; error?: string }> {
  const response = await edgeAuthedRequest(`/projects/${encodeURIComponent(projectId)}/files/save`, {
    method: 'POST',
    json: { files, ...(deletions.length > 0 ? { deletions } : {}) },
  })

  if (!response) {
    return { success: false, error: 'Not signed in to Autonomy Edge.' }
  }

  if (response.status < 200 || response.status >= 300) {
    // 403 here is almost always the plan limit rather than a permission the
    // user could fix, and the body carries a contract string, not a sentence.
    if (response.status === 403 && response.body.includes(OVER_PLAN_LIMIT)) {
      return { success: false, error: OVER_PLAN_LIMIT_MESSAGE }
    }

    return { success: false, error: `Autonomy Edge answered ${response.status}.` }
  }

  return { success: true }
}

export async function saveCloudProject(files: WriteProjectFiles): Promise<{ success: boolean; error?: string }> {
  try {
    // Read first: the endpoint deletes by omission, and the generated envelope holds only
    // what this editor models, so a file it does not know about would be erased.
    const read = await readEnvelope(files.projectPath)

    if (!read.ok) {
      return { success: false, error: `Could not read the project before saving it: ${read.error}` }
    }

    return await writeEnvelope(
      files.projectPath,
      mergeEnvelopeOverExisting(read.files, envelopeFromWriteProjectFiles(files)),
      files.deletions.filter((path) => path.length > 0),
    )
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Save failed' }
  }
}

/** `filePath` is `projectId/relative/path`, the same contract the web adapter uses. */
export async function saveCloudFile(filePath: string, content: unknown): Promise<{ success: boolean; error?: string }> {
  try {
    const separator = filePath.indexOf('/')

    if (separator === -1) {
      return { success: false, error: 'Invalid file path. Expected: projectId/relative/path' }
    }

    const projectId = filePath.slice(0, separator)
    const relativePath = filePath.slice(separator + 1)

    // The read is mandatory: the backend deletes by omission, so sending only this file
    // would wipe every other one.
    const read = await readEnvelope(projectId)

    if (!read.ok) {
      return { success: false, error: `Could not read the project before saving it: ${read.error}` }
    }

    const envelope = read.files
    const text = typeof content === 'string' ? content : JSON.stringify(content)

    setInEnvelope(envelope, relativePath, text)

    // `setInEnvelope` is a no-op outside its allowlist; without this check an edit that
    // was never persisted would be reported as saved.
    if (getInEnvelope(envelope, relativePath) !== text) {
      return { success: false, error: `Autonomy Edge has no slot for ${relativePath}.` }
    }

    return await writeEnvelope(projectId, envelope, [])
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Save failed' }
  }
}
