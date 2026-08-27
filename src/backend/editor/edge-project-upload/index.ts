/**
 * Publishing a project from this machine to Autonomy Edge.
 *
 * The desktop's counterpart to the web's "Import project" dialog, and it drives the same
 * endpoint — `POST /projects/import`, multipart, with a zip and a destination folder. The
 * web asks the user to produce that zip by hand ("right-click the project folder →
 * Compress"); here the project is already on disk with a path we hold, so the editor makes
 * the archive itself. That is the entire difference between the two flows.
 *
 * WHY THE LIMITS ARE ENFORCED HERE TOO. The server rejects an archive that is too big, has
 * too many files, nests too deep, or carries a file type it does not accept. Re-checking
 * before the upload is not distrust of the server: zipping a large project and pushing it
 * over a slow connection takes real time, and finding out afterwards that it was never
 * going to be accepted wastes all of it. The numbers are the server's own, and if they
 * drift, a rejection still lands — this only makes the common failures immediate and
 * specific instead of late and generic.
 */

import fs from 'fs/promises'
import JSZip from 'jszip'
import path from 'path'

import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBody } from '../edge-account/edge-http'

/**
 * The extensions `POST /projects/import` accepts. Anything else in the project directory
 * is left out of the archive rather than making the upload fail — a stray `.DS_Store`, an
 * editor backup or a build artefact is not a reason to refuse to publish someone's work.
 */
const ALLOWED_EXTENSIONS = new Set(['.json', '.st', '.fbd', '.ld', '.il', '.py'])

/** The server's own ceilings, mirrored so a doomed upload fails before it is attempted. */
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_FILES = 1000
const MAX_DEPTH = 10

/** A project without this is not a project the importer can read. */
const PROJECT_MANIFEST = 'project.json'

/** Zipping and uploading a whole project is not a request with a user tapping their foot. */
const UPLOAD_TIMEOUT_MS = 300_000

/** Listing folders is. */
const LIST_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Folders — the destination picker's data
// ---------------------------------------------------------------------------

export interface CloudFolder {
  id: string
  /** Already display-ready: see `labelFor`. */
  name: string
  /** Nesting level, so a flat list can still read as a tree. */
  depth: number
}

export type CloudFoldersResult =
  | { status: 'ok'; folders: CloudFolder[] }
  | { status: 'signed-out' }
  | { status: 'unreachable' }

/** The shape `GET /folders?includeHierarchy=true` returns, narrowed to what is used. */
interface RawFolder {
  id?: unknown
  name?: unknown
  type?: unknown
  deletedAt?: unknown
  children?: unknown
}

function isRawFolder(value: unknown): value is RawFolder {
  return typeof value === 'object' && value !== null
}

/**
 * What to call a folder in the picker.
 *
 * The root folder's `name` is the account's own user id — an internal detail that would be
 * meaningless and slightly alarming in a menu. The web's dialog shows `Root (/)` for it;
 * this says the same thing in the same place.
 */
function labelFor(folder: RawFolder): string {
  if (folder.type === 'root') {
    return 'Root (/)'
  }

  return typeof folder.name === 'string' && folder.name.length > 0 ? folder.name : 'Untitled folder'
}

/**
 * Flatten the hierarchy into the list the picker shows.
 *
 * Only `root` and `directory` survive. A `project` folder IS a project, and offering it as
 * a destination would invite someone to nest a project inside another one — the web's
 * dialog filters the same two types for the same reason. Trashed folders are dropped as
 * well: importing into the bin would succeed and then be invisible.
 */
function flattenFolders(nodes: unknown, depth = 0): CloudFolder[] {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) {
    return []
  }

  const out: CloudFolder[] = []

  for (const node of nodes) {
    if (!isRawFolder(node) || typeof node.id !== 'string' || node.id.length === 0) {
      continue
    }

    if (node.deletedAt !== null && node.deletedAt !== undefined) {
      continue
    }

    if (node.type !== 'root' && node.type !== 'directory') {
      // Not a destination — but a project folder can still contain directories, so keep
      // walking rather than pruning the branch.
      out.push(...flattenFolders(node.children, depth + 1))
      continue
    }

    out.push({ id: node.id, name: labelFor(node), depth })
    out.push(...flattenFolders(node.children, depth + 1))
  }

  return out
}

export async function listCloudFolders(): Promise<CloudFoldersResult> {
  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest('/folders?includeHierarchy=true', { timeoutMs: LIST_TIMEOUT_MS })
  } catch {
    return { status: 'unreachable' }
  }

  if (!response) {
    return { status: 'signed-out' }
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'signed-out' }
  }

  if (response.status >= 400) {
    return { status: 'unreachable' }
  }

  const payload = parseJsonBody<{ data?: { folders?: unknown } }>(response.body)

  return { status: 'ok', folders: flattenFolders(payload?.data?.folders) }
}

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

interface CollectedFile {
  /** Forward-slash separated, relative to the project directory. */
  relativePath: string
  contents: Buffer
}

export type UploadFailure =
  | { reason: 'no-manifest' }
  | { reason: 'empty' }
  | { reason: 'too-many-files'; count: number }
  | { reason: 'too-deep' }
  | { reason: 'file-too-large'; relativePath: string; bytes: number }
  | { reason: 'too-large'; bytes: number }
  | { reason: 'unreadable'; message: string }
  | { reason: 'signed-out' }
  | { reason: 'unreachable'; message: string }
  | { reason: 'rejected'; status: number; message: string }

export type UploadProjectResult =
  | { status: 'ok'; projectId: string | null; uploadedFiles: number }
  | { status: 'failed'; failure: UploadFailure }

/**
 * Read the project directory into memory, keeping only what the importer accepts.
 *
 * In memory because the archive has to be a single buffer for the multipart body anyway,
 * and the ceiling on that is 100MB — small enough that streaming to a temporary file
 * would add a cleanup path and a failure mode without buying anything.
 */
async function collectFiles(
  projectPath: string,
  directory: string,
  prefix: string,
  depth: number,
  collected: CollectedFile[],
): Promise<UploadFailure | null> {
  if (depth > MAX_DEPTH) {
    return { reason: 'too-deep' }
  }

  let entries: Awaited<ReturnType<typeof fs.readdir>>

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    return { reason: 'unreadable', message: error instanceof Error ? error.message : 'Could not read the project' }
  }

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    // Forward slashes, always: the ZIP spec's separator. `path.join` would emit
    // backslashes on Windows, which the server then reads as literal characters in a
    // filename rather than as directories — the same trap the runtime upload documents.
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const failure = await collectFiles(projectPath, absolute, relativePath, depth + 1, collected)

      if (failure) {
        return failure
      }

      continue
    }

    // Symlinks are skipped rather than followed: a link pointing outside the project
    // would quietly publish files the user never meant to share.
    if (!entry.isFile()) {
      continue
    }

    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue
    }

    let contents: Buffer

    try {
      contents = await fs.readFile(absolute)
    } catch (error) {
      return { reason: 'unreadable', message: error instanceof Error ? error.message : `Could not read ${relativePath}` }
    }

    if (contents.length > MAX_FILE_BYTES) {
      return { reason: 'file-too-large', relativePath, bytes: contents.length }
    }

    collected.push({ relativePath, contents })

    if (collected.length > MAX_FILES) {
      return { reason: 'too-many-files', count: collected.length }
    }
  }

  return null
}

/** Build the archive the importer expects: project files at the root, `project.json` among them. */
export async function buildProjectArchive(
  projectPath: string,
): Promise<{ ok: true; zip: Buffer; fileCount: number } | { ok: false; failure: UploadFailure }> {
  const collected: CollectedFile[] = []
  const failure = await collectFiles(projectPath, projectPath, '', 0, collected)

  if (failure) {
    return { ok: false, failure }
  }

  if (collected.length === 0) {
    return { ok: false, failure: { reason: 'empty' } }
  }

  // Checked here rather than trusting the server's message: "the archive must contain a
  // project.json in the root" is true but unhelpful when the user picked a folder that was
  // never an OpenPLC project at all.
  if (!collected.some((file) => file.relativePath === PROJECT_MANIFEST)) {
    return { ok: false, failure: { reason: 'no-manifest' } }
  }

  const total = collected.reduce((sum, file) => sum + file.contents.length, 0)

  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, failure: { reason: 'too-large', bytes: total } }
  }

  const zip = new JSZip()

  for (const file of collected) {
    zip.file(file.relativePath, file.contents)
  }

  return {
    ok: true,
    // DEFLATE, not STORE: the payload is source text and JSON, which compresses hard, and
    // the 100MB ceiling is measured on what is sent.
    zip: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    fileCount: collected.length,
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/** Strips CR/LF and quotes so a filename cannot forge a header or break the disposition. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n"]/g, '')
}

/** One text field of a multipart form. */
function textPart(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${headerSafe(name)}"\r\n\r\n${value}\r\n`)
}

export interface UploadProjectParams {
  projectPath: string
  parentFolderId: string
  /** Overrides the name in `project.json`. */
  projectName?: string
  visibility: 'public' | 'private'
}

export async function uploadProjectToCloud(params: UploadProjectParams): Promise<UploadProjectResult> {
  const archive = await buildProjectArchive(params.projectPath)

  if (!archive.ok) {
    return { status: 'failed', failure: archive.failure }
  }

  const boundary = `----OpenPLCEditorBoundary${Math.random().toString(36).slice(2)}`
  const zipName = `${path.basename(params.projectPath) || 'project'}.zip`

  const parts: Buffer[] = [
    textPart(boundary, 'parentFolderId', params.parentFolderId),
    textPart(boundary, 'visibility', params.visibility),
  ]

  if (params.projectName) {
    parts.push(textPart(boundary, 'projectName', params.projectName))
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${headerSafe(zipName)}"\r\n` +
        `Content-Type: application/zip\r\n\r\n`,
    ),
    archive.zip,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )

  // `Buffer.concat` is typed over `Uint8Array`, and this project's TS/@types/node pairing
  // will not take a `Buffer` there. A view over the same memory satisfies it without
  // copying the archive, and without the assertion the runtime uploader had to document.
  const body = Buffer.concat(parts.map((part) => new Uint8Array(part.buffer, part.byteOffset, part.byteLength)))

  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest('/projects/import', {
      method: 'POST',
      raw: { body, contentType: `multipart/form-data; boundary=${boundary}` },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
  } catch (error) {
    // No answer at all, which for a non-idempotent POST means the project MAY have been
    // created. Said as "unreachable" rather than "failed" so the message can tell the user
    // to check Edge before retrying instead of implying nothing happened.
    return {
      status: 'failed',
      failure: { reason: 'unreachable', message: error instanceof Error ? error.message : 'No answer' },
    }
  }

  if (!response) {
    return { status: 'failed', failure: { reason: 'signed-out' } }
  }

  if (response.status === 401) {
    return { status: 'failed', failure: { reason: 'signed-out' } }
  }

  if (response.status >= 400) {
    const parsed = parseJsonBody<{ message?: string | string[]; error?: { message?: string | string[] } }>(
      response.body,
    )
    const raw = parsed?.message ?? parsed?.error?.message
    const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? `Autonomy Edge answered ${response.status}.`)

    return { status: 'failed', failure: { reason: 'rejected', status: response.status, message } }
  }

  const created = parseJsonBody<{ data?: { project?: { id?: unknown } } }>(response.body)
  const projectId = created?.data?.project?.id

  return {
    status: 'ok',
    projectId: typeof projectId === 'string' ? projectId : null,
    uploadedFiles: archive.fileCount,
  }
}
