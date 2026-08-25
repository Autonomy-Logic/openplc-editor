/**
 * The user's Autonomy Edge projects, from the desktop editor.
 *
 * Three operations, and they are the whole cloud round trip: list what the account has,
 * read one into the shape the editor's project reader already returns, and write one
 * back. Everything authenticated goes through `edgeAuthedRequest`, so renewal, the
 * single-flight guard and the one retry on a revoked token are not reimplemented here.
 *
 * THE WIRE FORMAT IS NOT DUPLICATED. `backend/shared/project/api-envelope` owns both
 * directions of the envelope and is shared with openplc-web, which reaches the same API.
 * That module used to live in the web adapter, which is exactly why the desktop could
 * not read a cloud project without a second copy of the same knowledge.
 *
 * SAVING IS READ-MODIFY-WRITE, and it has to be. The backend deletes by omission, so
 * sending only the file that changed would wipe the rest of the project. Every partial
 * save therefore loads the current envelope first, patches one slot and sends the whole
 * thing — the same contract the web adapter follows.
 */

import { APP_VERSION } from '../../../frontend/data/constants/app-version'
import type {
  CloudProjectsResult,
  RawProjectFiles,
  WriteProjectFiles,
} from '../../../middleware/shared/ports/project-port'
import {
  apiFilesToRaw,
  type ApiProjectFiles,
  envelopeFromWriteProjectFiles,
  setInEnvelope,
} from '../../shared/project/api-envelope'
import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBody } from '../edge-account/edge-http'

/** Every successful payload from the API arrives wrapped as `{ data: ... }`. */
interface Envelope<T> {
  data?: T
}

interface ApiProjectRow {
  id?: unknown
  name?: unknown
  language?: unknown
  updatedAt?: unknown
}

/**
 * The most recently changed projects on the account.
 *
 * Ordered by the server, not here: `updatedAt desc` is what "recent" means, and asking
 * the API for it costs nothing while sorting a truncated page locally would be wrong —
 * the five newest of ten fetched rows are not the five newest overall.
 *
 * Reports WHICH kind of nothing it found — no session, nothing to show, or a server it
 * could not reach — because the start screen says something different for each.
 */
export async function listRecentCloudProjects(limit: number): Promise<CloudProjectsResult> {
  const query = new URLSearchParams({ limit: String(limit), sortBy: 'updatedAt', sortOrder: 'desc' })

  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest(`/projects?${query.toString()}`)
  } catch {
    // Never reached the server. Saying "signed out" here would tell someone who is
    // signed in and merely offline to go and sign in again.
    return { status: 'unreachable' }
  }

  // No token could be obtained, or the server refused one.
  if (!response || response.status === 401 || response.status === 403) {
    return { status: 'signed-out' }
  }

  if (response.status < 200 || response.status >= 300) {
    // A 5xx says nothing about the session.
    return { status: 'unreachable' }
  }

  const rows = parseJsonBody<Envelope<{ projects?: ApiProjectRow[] }>>(response.body)?.data?.projects

  if (!Array.isArray(rows)) {
    return { status: 'ok', projects: [] }
  }

  // Narrowed field by field rather than cast: this is a remote payload, and a row
  // missing an id would otherwise become a list entry that cannot be opened.
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
      },
    ]
  })

  return { status: 'ok', projects }
}

/**
 * `/details` for a project, with the build id the endpoint expects.
 *
 * An editor-origin request that omits `uncached_version` is treated as an outdated
 * cached bundle and answered with a synthetic "hard refresh" project instead of the real
 * one. The desktop is not that origin, but sending the real version keeps us out of that
 * branch by construction rather than by assumption.
 */
function detailsPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/details?uncached_version=${encodeURIComponent(APP_VERSION)}`
}

/** The current envelope, or null when it could not be read. */
async function readEnvelope(projectId: string): Promise<ApiProjectFiles | null> {
  const response = await edgeAuthedRequest(detailsPath(projectId))

  if (!response || response.status < 200 || response.status >= 300) {
    return null
  }

  return parseJsonBody<Envelope<{ files?: ApiProjectFiles }>>(response.body)?.data?.files ?? null
}

/**
 * Read a cloud project into the same shape the filesystem reader returns.
 *
 * `canEdit` rides along from the server's own capabilities rather than being assumed:
 * a project shared read-only must not offer a save that will be refused.
 */
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

    const payload = parseJsonBody<Envelope<{ files?: ApiProjectFiles; capabilities?: { canEdit?: boolean } }>>(
      response.body,
    )?.data
    const files = payload?.files

    if (!files) {
      return {
        success: false,
        error: { title: 'Failed to open project', description: 'Autonomy Edge returned no files.' },
      }
    }

    return {
      success: true,
      data: { ...apiFilesToRaw(projectId, files), canEdit: payload?.capabilities?.canEdit },
    }
  } catch (error) {
    // Never reached the server. Said plainly, because "you are offline" and "this project
    // is broken" call for completely different things from the user.
    return {
      success: false,
      error: {
        title: 'Could not reach Autonomy Edge',
        description: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}

/** Persist a full envelope. `deletions` is omitted when empty, as the API expects. */
async function writeEnvelope(
  projectId: string,
  files: ApiProjectFiles,
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
    return { success: false, error: `Autonomy Edge answered ${response.status}.` }
  }

  return { success: true }
}

/** Save a whole cloud project. */
export async function saveCloudProject(files: WriteProjectFiles): Promise<{ success: boolean; error?: string }> {
  try {
    return await writeEnvelope(
      files.projectPath,
      envelopeFromWriteProjectFiles(files),
      files.deletions.filter((path) => path.length > 0),
    )
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Save failed' }
  }
}

/**
 * Save one file inside a cloud project.
 *
 * `filePath` is `projectId/relative/path`, the same contract the web adapter uses, which
 * is what lets the shared save flow drive both platforms without knowing which it is on.
 */
export async function saveCloudFile(filePath: string, content: unknown): Promise<{ success: boolean; error?: string }> {
  try {
    const separator = filePath.indexOf('/')

    if (separator === -1) {
      return { success: false, error: 'Invalid file path. Expected: projectId/relative/path' }
    }

    const projectId = filePath.slice(0, separator)
    const relativePath = filePath.slice(separator + 1)

    // Read-modify-write, and the read is mandatory: the backend deletes by omission, so
    // sending only this file would wipe every other one.
    const envelope = await readEnvelope(projectId)

    if (!envelope) {
      return { success: false, error: 'Could not read the project before saving it.' }
    }

    setInEnvelope(envelope, relativePath, typeof content === 'string' ? content : JSON.stringify(content))

    return await writeEnvelope(projectId, envelope, [])
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Save failed' }
  }
}
