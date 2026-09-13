/** Abstracts project lifecycle operations (create, open, save, POU management): editor delegates over IPC, web via project-api.ts. */

import type * as PdfJsLib from 'pdfjs-dist'
import { z } from 'zod'

import type { PrintRequest } from './print-types'
import type { DeviceConfiguration, DevicePin, PLCProjectData, ProjectMeta, RecentProject, Unsubscribe } from './types'

export interface CreateProjectParams {
  name: string
  type: 'plc-project' | 'plc-library'
  path?: string
  language?: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
  time?: string
}

export interface ProjectResponse {
  success: boolean
  data?: {
    meta: ProjectMeta
    projectData: PLCProjectData
    deviceConfiguration?: DeviceConfiguration
    /** Pin mappings from `devices/pin-mapping.json`; the legacy flat-array shape is still accepted and auto-migrated on next save. */
    devicePinMapping?: DevicePin[] | Record<string, DevicePin[]>
    /** Non-fatal parsing warnings surfaced in the in-app Console. */
    warnings?: string[]
    /** POUs that failed to parse entirely; non-empty forces the project open empty and read-only so a save can't overwrite the real content. */
    fatalErrors?: string[]
    /** `datatypes/*.dt` files that failed to parse, preserved raw so the save flow echoes them back verbatim. */
    unparsedDataTypeFiles?: RawProjectFile[]
    /** Raw file contents by path, captured pre-parse, so the save flow can re-upload unedited files byte-identical. */
    rawLoadedFiles?: Record<string, string>
    /** Whether the user may persist changes; gates only backend writes, not local editing/simulation. Absent means `true`. */
    canEdit?: boolean
    /** Resolved project README; `null` means none exists. Absent means this adapter doesn't expose READMEs. */
    readme?: string | null
    /** Set when this response came from converting a pending PLCopen import rather than a normal project.json; caller should save immediately to clear the marker. */
    wasPendingPlcopenImport?: boolean
  }
  error?: {
    title: string
    description: string
    /** HTTP status when known — distinguishes a permission denial (403) from a load failure. */
    status?: number
  }
}

/** Pre-serialized project files for writing to disk; mirrors the read-side RawProjectFiles shape but for writing. */
export interface WriteProjectFiles {
  projectPath: string
  /** Pre-serialized project.json content */
  projectJson: string
  /** Pre-serialized devices/configuration.json; undefined for project types that don't own this file (skips the write, doesn't truncate). */
  deviceConfig?: string
  /** Pre-serialized devices/pin-mapping.json; same optional semantics as `deviceConfig`. */
  pinMapping?: string
  /** Pre-serialized library.json for library projects; undefined skips the write rather than truncating the on-disk copy. */
  libraryManifest?: string
  /** POU files with pre-serialized IEC text content */
  pouFiles: RawProjectFile[]
  /** Server config files with pre-serialized JSON content */
  serverFiles: RawProjectFile[]
  /** Remote device config files with pre-serialized JSON content */
  remoteDeviceFiles: RawProjectFile[]
  /** Data type files (`datatypes/<Name>.dt`) with pre-serialized ST `TYPE…END_TYPE` content, one declaration per file. */
  dataTypeFiles: RawProjectFile[]
  /** Relative paths to delete from disk (e.g. 'pous/programs/OldPou.st') */
  deletions: string[]
}

const RawProjectFileSchema = z.object({
  relativePath: z.string(),
  content: z.string(),
}) satisfies z.ZodType<RawProjectFile>

/** Runtime check for `WriteProjectFiles` at IPC boundaries — a TypeScript annotation on an IPC argument checks nothing. */
export const WriteProjectFilesSchema = z.object({
  projectPath: z.string().min(1),
  projectJson: z.string(),
  deviceConfig: z.string().optional(),
  pinMapping: z.string().optional(),
  libraryManifest: z.string().optional(),
  pouFiles: z.array(RawProjectFileSchema),
  serverFiles: z.array(RawProjectFileSchema),
  remoteDeviceFiles: z.array(RawProjectFileSchema),
  dataTypeFiles: z.array(RawProjectFileSchema),
  deletions: z.array(z.string()),
}) satisfies z.ZodType<WriteProjectFiles>

/** Why a write failed, when known: `signed-out` (401/403/no session) or `unreachable` (no answer or 5xx). Absent otherwise. */
export type SaveFailureReason = 'signed-out' | 'unreachable'

export interface SaveResult {
  success: boolean
  error?: string
  reason?: SaveFailureReason
}

export interface CreatePouParams {
  name: string
  pouType: PouType
  language: string
  filePath?: string
}

export interface RenamePouParams {
  filePath: string
  newFileName: string
  fileContent?: unknown
}

import type { PouType } from './types'

/** Raw file entry: a file path relative to the project root and its text content. */
export interface RawProjectFile {
  /** Path relative to the project root (e.g., 'pous/programs/main.st') */
  relativePath: string
  /** Raw text content of the file */
  content: string
}

/** Raw project files as read from disk — no parsing, just plain strings. */
export interface RawProjectFiles {
  success: boolean
  data?: {
    /** Absolute path to the project directory */
    projectPath: string
    /** Raw content of project.json */
    projectJson: string
    /** Raw content of devices/configuration.json */
    deviceConfig: string
    /** Raw content of devices/pin-mapping.json */
    pinMapping: string
    /** Raw content of `library.json` for library projects; empty string for PLC projects or a missing manifest (the editor seeds a template on first save). */
    libraryManifest: string
    /** Raw POU files (.st, .il, .ld, .fbd, .py, .cpp, .json) */
    pouFiles: RawProjectFile[]
    /** Raw server config files from devices/servers/ */
    serverFiles: RawProjectFile[]
    /** Raw remote device config files from devices/remote/ */
    remoteDeviceFiles: RawProjectFile[]
    /** Raw data type files from datatypes/ (`.dt`, one ST `TYPE…END_TYPE` declaration each). Empty on projects that predate the format. */
    dataTypeFiles: RawProjectFile[]
    /** See {@link ProjectResponse.data.canEdit}. */
    canEdit?: boolean
    /** See {@link ProjectResponse.data.readme}. */
    readme?: string | null
    /** Raw PLCopen XML when the project directory is a bare pending-import marker instead of a normal project; undefined otherwise. */
    pendingPlcopenSource?: string
    /** File bytes exactly as the source handed them over, keyed by relative path; lets the save flow re-upload unedited files unchanged instead of re-serializing them. */
    rawLoadedFiles?: Record<string, string>
  }
  /** HTTP status when known, so a 403 forwarded by `openProjectByPath` isn't lost. See `ProjectResponse['error']`. */
  error?: { title: string; description: string; status?: number }
}

/** Distinguishes signed-out, no-projects-yet, and unreachable — states an empty list can't tell apart. */
export type CloudProjectsResult =
  | { status: 'ok'; projects: CloudProjectSummary[] }
  /** The server answered, and there is no usable session. */
  | { status: 'signed-out' }
  /** The question could not be asked — offline, DNS, a dropped connection. */
  | { status: 'unreachable' }
  /** This build has no channel for cloud projects at all. */
  | { status: 'unavailable' }

/** A project on the user's Autonomy Edge account, as a list needs to show it. */
export interface CloudProjectSummary {
  id: string
  name: string
  /** IEC language slug, e.g. `st` / `ld`. Absent on projects that never set one. */
  language?: string | null
  /** ISO timestamp of the last change, which is what "recent" is ordered by. */
  updatedAt: string
}

/** A destination the user can publish into. Flattened, with `depth` to read as a tree. */
export interface CloudFolder {
  id: string
  /** Display-ready. The account's root folder is named after the user id on the wire. */
  name: string
  depth: number
}

export type CloudFoldersResult =
  | { status: 'ok'; folders: CloudFolder[] }
  | { status: 'signed-out' }
  | { status: 'unreachable' }

/** Why publishing failed — each reason implies a different next step for the user. */
export type UploadProjectFailure =
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
  | { status: 'failed'; failure: UploadProjectFailure }

/** Runtime check for `CloudProjectsResult`; an unrecognised shape must map to the case that claims the least. */
export const CloudProjectsResultSchema = z.union([
  z.object({
    status: z.literal('ok'),
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        language: z.string().nullish(),
        updatedAt: z.string(),
      }),
    ),
  }),
  z.object({ status: z.literal('signed-out') }),
  z.object({ status: z.literal('unreachable') }),
  z.object({ status: z.literal('unavailable') }),
]) satisfies z.ZodType<CloudProjectsResult>

export const CloudFoldersResultSchema = z.union([
  z.object({
    status: z.literal('ok'),
    folders: z.array(z.object({ id: z.string(), name: z.string(), depth: z.number() })),
  }),
  z.object({ status: z.literal('signed-out') }),
  z.object({ status: z.literal('unreachable') }),
]) satisfies z.ZodType<CloudFoldersResult>

export const UploadProjectResultSchema = z.union([
  z.object({ status: z.literal('ok'), projectId: z.string().nullable(), uploadedFiles: z.number() }),
  z.object({
    status: z.literal('failed'),
    failure: z.discriminatedUnion('reason', [
      z.object({ reason: z.literal('no-manifest') }),
      z.object({ reason: z.literal('empty') }),
      z.object({ reason: z.literal('too-many-files'), count: z.number() }),
      z.object({ reason: z.literal('too-deep') }),
      z.object({ reason: z.literal('file-too-large'), relativePath: z.string(), bytes: z.number() }),
      z.object({ reason: z.literal('too-large'), bytes: z.number() }),
      z.object({ reason: z.literal('unreadable'), message: z.string() }),
      z.object({ reason: z.literal('signed-out') }),
      z.object({ reason: z.literal('unreachable'), message: z.string() }),
      z.object({ reason: z.literal('rejected'), status: z.number(), message: z.string() }),
    ]),
  }),
]) satisfies z.ZodType<UploadProjectResult>

export interface UploadProjectParams {
  /** Absolute path of the project directory on this machine. */
  projectPath: string
  parentFolderId: string
  /** Overrides the name inside `project.json`. */
  projectName?: string
  visibility: 'public' | 'private'
}

export interface ProjectPort {
  /** Folders on Autonomy Edge to publish into; optional — only a platform with local projects and Edge access has this. */
  listCloudFolders?(): Promise<CloudFoldersResult>

  /** Archives a local project and imports it into Edge; optional for the same reason as `listCloudFolders`. */
  uploadProjectToCloud?(params: UploadProjectParams): Promise<UploadProjectResult>

  /** Create a new project. */
  createProject(params: CreateProjectParams): Promise<ProjectResponse>

  /** Opens a project via platform file picker (native dialog on editor; file input or project list on web). */
  openProject(): Promise<ProjectResponse>

  /** Open a project by its path or identifier. */
  openProjectByPath(projectPath: string): Promise<ProjectResponse>

  /** Save the entire project. All files are pre-serialized by the frontend. */
  saveProject(files: WriteProjectFiles): Promise<SaveResult>

  /** Saves a single file (writes to disk on editor; updates in-memory state and/or syncs to backend on web). */
  saveFile(filePath: string, content: unknown): Promise<SaveResult>

  /** Create a new POU file. */
  createPou(params: CreatePouParams): Promise<{ success: boolean; data?: unknown; error?: string }>

  /** Delete a POU file. */
  deletePou(filePath: string): Promise<{ success: boolean; error?: string }>

  /** Rename a POU file. */
  renamePou(params: RenamePouParams): Promise<{ success: boolean; data?: unknown; error?: string }>

  /** Renames the project. Web calls Edge's canonical rename endpoint and echoes the resolved name back; editor no-ops since `project.json`'s `meta.name` is already canonical. */
  renameProject(projectId: string, newName: string): Promise<{ success: boolean; name?: string; error?: string }>

  /** Picks a filesystem path for project location (native directory picker on editor; may return a pre-configured path on web). */
  pickPath(): Promise<{ success: boolean; path?: string; error?: { title: string; description: string } }>

  /** Get list of recently opened projects. */
  getRecentProjects(): Promise<RecentProject[]>

  /** Most recently changed cloud projects, server-ordered; optional (only the desktop editor shows cloud alongside local). Discriminated result so signed-out/empty/offline read differently to the user. */
  listRecentCloudProjects?(limit: number): Promise<CloudProjectsResult>

  /** Drops a project from the recent-projects list without touching disk; re-opening it by path later re-adds it. */
  removeRecentProject(projectPath: string): Promise<{ success: boolean; error?: string }>

  /** Records `projectPath` in the recent-projects list; optional. Save As is the one flow that needs this call explicitly, since it produces a location without a read. */
  trackRecentProject?(projectPath: string): Promise<{ success: boolean; error?: string }>

  /** Recursively deletes a project directory and its recent-list entry. Implementations must confirm the directory contains a top-level `project.json` before deleting, to refuse arbitrary paths. */
  deleteProject(projectPath: string): Promise<{ success: boolean; error?: string }>

  /** Reads a file's content by path (local filesystem via IPC on editor; in-memory state or API on web). */
  readFileContent(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>

  /** Reads all raw project files without parsing; the frontend parses the returned content strings. */
  readProjectFiles(projectPath: string): Promise<RawProjectFiles>

  /** Starts watching a file for external changes (fs.watch on editor; no-op on web). */
  watchFile?(filePath: string): Promise<{ success: boolean; error?: string }>

  /** Stop watching a file. */
  unwatchFile?(filePath: string): Promise<{ success: boolean }>

  /** Stop watching all files. */
  unwatchAll?(): Promise<{ success: boolean }>

  /** Subscribes to external file-change events; never fires on web. */
  onFileExternalChange?(callback: (filePath: string) => void): Unsubscribe

  /** Fetches the project README; `null` means none exists. Optional — editor has no remote README concept. */
  getReadme?(projectId: string): Promise<string | null>

  /** Saves the README; `content === null` deletes it, an empty string keeps the file present but empty. Optional — editor doesn't support README editing yet. */
  saveReadme?(
    projectId: string,
    content: string | null,
    opts?: { commitMessage?: string },
  ): Promise<{
    success: boolean
    /** Backend-reported action — useful for tailoring success toasts. */
    action?: 'noop' | 'create' | 'update' | 'remove'
    /** True when the same call migrated the legacy column into a commit. */
    migrated?: boolean
    error?: string
  }>

  /** Picks a PLCopen XML file to import (native open-file dialog on editor; hidden file input on web). */
  pickPlcopenImportFile(): Promise<{ success: boolean; content?: string; error?: string }>

  /** Persists generated PLCopen XML for the user (native save dialog on editor; browser download on web). */
  exportPlcopenFile(defaultFileName: string, xml: string): Promise<{ success: boolean; error?: string }>

  /** Persists a rendered PDF (native save dialog on editor; browser download on web); `canceled` distinguishes a dismissed dialog from a write failure. */
  exportPdfFile(
    defaultFileName: string,
    bytes: Uint8Array,
  ): Promise<{ success: boolean; canceled?: boolean; error?: string }>

  /** Renders a print/export-to-PDF request to bytes via the shared engine; web runs it in a Worker, editor runs it on the main thread because `import.meta.url` workers don't compile under its CommonJS tsconfig. Rejects on failure. */
  renderPdf(request: PrintRequest): Promise<Uint8Array>

  /** Configures pdf.js before opening a document (idempotent); editor runs it in-process via `globalThis.pdfjsWorker` because Electron's CSP blocks a blob Worker and its V8 lacks the `toHex()` pdf.js's worker code needs. */
  preparePdfPreviewWorker(pdfjsLib: typeof PdfJsLib): Promise<void>
}
