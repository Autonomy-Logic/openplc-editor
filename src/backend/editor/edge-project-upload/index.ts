import fs from 'fs/promises'
import JSZip from 'jszip'
import path from 'path'
import { z } from 'zod'

import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBodyAs } from '../edge-account/edge-http'

/** Edge's own list; anything else is left out of the archive rather than failing the upload. */
const ALLOWED_EXTENSIONS = new Set(['.ld', '.fbd', '.st', '.sfc', '.il', '.dt', '.json', '.py', '.c', '.cpp', '.md'])

/** The server's own ceilings, mirrored so a doomed upload fails before it is attempted. */
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_FILES = 1000
const MAX_DEPTH = 10
const SKIPPED_DIRECTORIES = new Set(['build', 'node_modules'])

async function isProjectRoot(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(directory, 'project.json'))).isFile()
  } catch {
    return false
  }
}

const PROJECT_MANIFEST = 'project.json'

/** Loose on purpose: a folder that cannot be understood is one destination missing, not a failure. */
const FoldersResponseSchema = z.object({ data: z.object({ folders: z.unknown() }).nullish() })

/** Validated because the value lands in `failure.message`, which is typed `string`. */
const ImportErrorSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).nullish(),
  error: z.object({ message: z.union([z.string(), z.array(z.string())]).nullish() }).nullish(),
})

const ImportCreatedSchema = z.object({
  data: z.object({ project: z.object({ id: z.string().nullish() }).nullish() }).nullish(),
})

/** Zipping and uploading a whole project is not a request anyone waits on. */
const UPLOAD_TIMEOUT_MS = 300_000

const LIST_TIMEOUT_MS = 30_000

export interface CloudFolder {
  id: string
  name: string
  /** Nesting level, so a flat list can still read as a tree. */
  depth: number
}

export type CloudFoldersResult =
  | { status: 'ok'; folders: CloudFolder[] }
  | { status: 'signed-out' }
  | { status: 'unreachable' }

/** `GET /folders?includeHierarchy=true`, narrowed to what is used. */
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

/** The root folder's `name` is the account's user id; show `Root (/)` like the web does. */
function labelFor(folder: RawFolder): string {
  if (folder.type === 'root') {
    return 'Root (/)'
  }

  return typeof folder.name === 'string' && folder.name.length > 0 ? folder.name : 'Untitled folder'
}

/** Only `root` and `directory` are destinations; a `project` folder is a project. */
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
      // Not a destination, but a project folder can still contain directories, so keep
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

  const payload = parseJsonBodyAs(response.body, FoldersResponseSchema)

  return { status: 'ok', folders: flattenFolders(payload?.data?.folders) }
}

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

/** Every limit is checked from the stat BEFORE the read, or the ceiling is enforced on memory already allocated. */
async function collectFiles(
  projectPath: string,
  directory: string,
  prefix: string,
  depth: number,
  collected: CollectedFile[],
  /** Shared across the recursion, so the total is enforced as it grows. */
  budget: { bytes: number },
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
    // Forward slashes always: `path.join` emits backslashes on Windows, which the server
    // reads as filename characters.
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      // A nested project.json would otherwise be adopted as the manifest.
      if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.') || (await isProjectRoot(absolute))) {
        continue
      }

      const failure = await collectFiles(projectPath, absolute, relativePath, depth + 1, collected, budget)

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

    let size: number

    try {
      size = (await fs.stat(absolute)).size
    } catch (error) {
      return {
        reason: 'unreadable',
        message: error instanceof Error ? error.message : `Could not read ${relativePath}`,
      }
    }

    if (size > MAX_FILE_BYTES) {
      return { reason: 'file-too-large', relativePath, bytes: size }
    }

    if (collected.length + 1 > MAX_FILES) {
      return { reason: 'too-many-files', count: collected.length + 1 }
    }

    if (budget.bytes + size > MAX_TOTAL_BYTES) {
      return { reason: 'too-large', bytes: budget.bytes + size }
    }

    let contents: Buffer

    try {
      contents = await fs.readFile(absolute)
    } catch (error) {
      return {
        reason: 'unreadable',
        message: error instanceof Error ? error.message : `Could not read ${relativePath}`,
      }
    }

    collected.push({ relativePath, contents })
    // From the bytes actually read, not the stat: a file that grew between the two must
    // not let the total drift past the ceiling.
    budget.bytes += contents.length

    if (budget.bytes > MAX_TOTAL_BYTES) {
      return { reason: 'too-large', bytes: budget.bytes }
    }
  }

  return null
}

/** The importer expects project files at the archive root, `project.json` among them. */
export async function buildProjectArchive(
  projectPath: string,
): Promise<{ ok: true; zip: Buffer; fileCount: number } | { ok: false; failure: UploadFailure }> {
  const collected: CollectedFile[] = []
  const failure = await collectFiles(projectPath, projectPath, '', 0, collected, { bytes: 0 })

  if (failure) {
    return { ok: false, failure }
  }

  if (collected.length === 0) {
    return { ok: false, failure: { reason: 'empty' } }
  }

  if (!collected.some((file) => file.relativePath === PROJECT_MANIFEST)) {
    return { ok: false, failure: { reason: 'no-manifest' } }
  }

  const zip = new JSZip()

  for (const file of collected) {
    zip.file(file.relativePath, file.contents)
  }

  return {
    ok: true,
    // The 100MB ceiling is enforced on the uncompressed bytes, so a DEFLATE archive is always within it.
    zip: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    fileCount: collected.length,
  }
}

/** Strips CR/LF and quotes so a filename cannot forge a header or break the disposition. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n"]/g, '')
}

/** The directory's own name: user-controlled text on its way into a header. */
export function zipNameFor(projectPath: string): string {
  return `${path.basename(projectPath) || 'project'}.zip`
}

export function fileDispositionHeader(boundary: string, filename: string): string {
  return (
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${headerSafe(filename)}"\r\n` +
    `Content-Type: application/zip\r\n\r\n`
  )
}

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
  const zipName = zipNameFor(params.projectPath)

  const parts: Buffer[] = [
    textPart(boundary, 'parentFolderId', params.parentFolderId),
    textPart(boundary, 'visibility', params.visibility),
  ]

  if (params.projectName) {
    parts.push(textPart(boundary, 'projectName', params.projectName))
  }

  parts.push(Buffer.from(fileDispositionHeader(boundary, zipName)), archive.zip, Buffer.from(`\r\n--${boundary}--\r\n`))

  // `Buffer.concat` is typed over `Uint8Array`; a view over the same memory avoids both
  // a copy and an assertion.
  const body = Buffer.concat(parts.map((part) => new Uint8Array(part.buffer, part.byteOffset, part.byteLength)))

  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest('/projects/import', {
      method: 'POST',
      raw: { body, contentType: `multipart/form-data; boundary=${boundary}` },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
  } catch (error) {
    // No answer to a non-idempotent POST: the project MAY exist, so "unreachable", not
    // "failed".
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
    const parsed = parseJsonBodyAs(response.body, ImportErrorSchema)
    const raw = parsed?.message ?? parsed?.error?.message
    const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? `Autonomy Edge answered ${response.status}.`)

    return { status: 'failed', failure: { reason: 'rejected', status: response.status, message } }
  }

  const created = parseJsonBodyAs(response.body, ImportCreatedSchema)
  const projectId = created?.data?.project?.id

  return {
    status: 'ok',
    projectId: projectId ?? null,
    uploadedFiles: archive.fileCount,
  }
}
