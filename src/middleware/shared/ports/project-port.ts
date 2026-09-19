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
    /** The legacy flat-array shape is still accepted, and auto-migrated on the next save. */
    devicePinMapping?: DevicePin[] | Record<string, DevicePin[]>
    /** Non-fatal parse warnings, surfaced in the in-app Console. */
    warnings?: string[]
    /** Non-empty forces the project open empty and read-only, so a save can't overwrite the real content. */
    fatalErrors?: string[]
    /** Kept raw so the save flow echoes unparseable `.dt` files back verbatim. */
    unparsedDataTypeFiles?: RawProjectFile[]
    /** Captured pre-parse, so the save flow can re-upload unedited files byte-identical. */
    rawLoadedFiles?: Record<string, string>
    /** Gates backend writes only, not local editing/simulation. Absent means `true`. */
    canEdit?: boolean
    /** `null` means none exists; absent means this adapter doesn't expose READMEs. */
    readme?: string | null
    /** Converted from a pending PLCopen import; the caller must save immediately to clear the marker. */
    wasPendingPlcopenImport?: boolean
  }
  error?: {
    title: string
    description: string
    /** HTTP status when known — a 403 is a permission denial, not a load failure. */
    status?: number
  }
}

export interface WriteProjectFiles {
  projectPath: string
  /** Pre-serialized project.json content */
  projectJson: string
  /** Undefined for project types that don't own this file: skips the write rather than truncating it. */
  deviceConfig?: string
  /** Same optional semantics as `deviceConfig`. */
  pinMapping?: string
  /** Same optional semantics as `deviceConfig`. */
  libraryManifest?: string
  /** POU files with pre-serialized IEC text content */
  pouFiles: RawProjectFile[]
  /** Server config files with pre-serialized JSON content */
  serverFiles: RawProjectFile[]
  /** Remote device config files with pre-serialized JSON content */
  remoteDeviceFiles: RawProjectFile[]
  /** `datatypes/<Name>.dt`, one ST `TYPE…END_TYPE` declaration per file. */
  dataTypeFiles: RawProjectFile[]
  /** Relative paths to delete from disk (e.g. 'pous/programs/OldPou.st') */
  deletions: string[]
}

const RawProjectFileSchema = z.object({
  relativePath: z.string(),
  content: z.string(),
}) satisfies z.ZodType<RawProjectFile>

/** Runtime check: a TypeScript annotation on an IPC argument checks nothing. */
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

/** `signed-out` is 401/403/no session; `unreachable` is no answer or a 5xx. Absent when the cause is unknown. */
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
    /** Empty string for PLC projects or a missing manifest (the editor seeds a template on first save). */
    libraryManifest: string
    /** Raw POU files (.st, .il, .ld, .fbd, .py, .cpp, .json) */
    pouFiles: RawProjectFile[]
    /** Raw server config files from devices/servers/ */
    serverFiles: RawProjectFile[]
    /** Raw remote device config files from devices/remote/ */
    remoteDeviceFiles: RawProjectFile[]
    /** One ST `TYPE…END_TYPE` declaration each. Empty on projects that predate the format. */
    dataTypeFiles: RawProjectFile[]
    /** See {@link ProjectResponse.data.canEdit}. */
    canEdit?: boolean
    /** See {@link ProjectResponse.data.readme}. */
    readme?: string | null
    /** Set only when the directory is a bare pending-import marker instead of a normal project. */
    pendingPlcopenSource?: string
    /** Bytes exactly as the source handed them over, so unedited files re-upload unchanged. */
    rawLoadedFiles?: Record<string, string>
  }
  /** HTTP status when known, so a 403 forwarded by `openProjectByPath` isn't lost. */
  error?: { title: string; description: string; status?: number }
}

/** Distinguishes signed-out, no-projects-yet, and unreachable — states an empty list can't tell apart. */
export type CloudProjectsResult =
  | { status: 'ok'; projects: CloudProjectSummary[] }
  | { status: 'signed-out' }
  | { status: 'unreachable' }
  /** This build has no channel for cloud projects at all — distinct from `unreachable`. */
  | { status: 'unavailable' }

export interface CloudProjectSummary {
  id: string
  name: string
  /** IEC language slug, e.g. `st`. Absent on projects that never set one. */
  language?: string | null
  /** ISO timestamp of the last change, which is what "recent" is ordered by. */
  updatedAt: string
  /**
   * The project sits beyond the plan's private-project limit, so Edge answers
   * 403 to every write. Absent when the platform cannot tell, which reads as
   * "not locked" — a project wrongly shown as open still fails safely at the
   * API, whereas one wrongly shown as locked cannot be opened at all.
   */
  locked?: boolean
}

/** Flattened, with `depth` to read back as a tree. */
export interface CloudFolder {
  id: string
  /** Display-ready: the account's root folder arrives named after the user id. */
  name: string
  depth: number
}

export type CloudFoldersResult =
  | { status: 'ok'; folders: CloudFolder[] }
  | { status: 'signed-out' }
  | { status: 'unreachable' }

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

/** Runtime check; an unrecognised shape must map to the case that claims the least. */
export const CloudProjectsResultSchema = z.union([
  z.object({
    status: z.literal('ok'),
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        language: z.string().nullish(),
        updatedAt: z.string(),
        locked: z.boolean().optional(),
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
  /** Optional — only a platform with both local projects and Edge access has this. */
  listCloudFolders?(): Promise<CloudFoldersResult>

  /** Archives a local project and imports it into Edge; optional for the same reason as `listCloudFolders`. */
  uploadProjectToCloud?(params: UploadProjectParams): Promise<UploadProjectResult>

  /** Create a new project. */
  createProject(params: CreateProjectParams): Promise<ProjectResponse>

  openProject(): Promise<ProjectResponse>

  /** Open a project by its path or identifier. */
  openProjectByPath(projectPath: string): Promise<ProjectResponse>

  /** Save the entire project. All files are pre-serialized by the frontend. */
  saveProject(files: WriteProjectFiles): Promise<SaveResult>

  saveFile(filePath: string, content: unknown): Promise<SaveResult>

  /** Create a new POU file. */
  createPou(params: CreatePouParams): Promise<{ success: boolean; data?: unknown; error?: string }>

  /** Delete a POU file. */
  deletePou(filePath: string): Promise<{ success: boolean; error?: string }>

  /** Rename a POU file. */
  renamePou(params: RenamePouParams): Promise<{ success: boolean; data?: unknown; error?: string }>

  /** Returns the name the backend resolved, which may differ from `newName`. */
  renameProject(projectId: string, newName: string): Promise<{ success: boolean; name?: string; error?: string }>

  pickPath(): Promise<{ success: boolean; path?: string; error?: { title: string; description: string } }>

  /** Get list of recently opened projects. */
  getRecentProjects(): Promise<RecentProject[]>

  /** Server-ordered. Discriminated so signed-out, empty and offline read differently to the user. */
  listRecentCloudProjects?(limit: number): Promise<CloudProjectsResult>

  /** Touches the recent list only, not disk; re-opening the project by path re-adds it. */
  removeRecentProject(projectPath: string): Promise<{ success: boolean; error?: string }>

  /** Save As is the one flow that needs this explicitly, since it produces a location without a read. */
  trackRecentProject?(projectPath: string): Promise<{ success: boolean; error?: string }>

  /** Recursive. Implementations must confirm a top-level `project.json` first, to refuse arbitrary paths. */
  deleteProject(projectPath: string): Promise<{ success: boolean; error?: string }>

  readFileContent(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>

  /** No parsing: the frontend parses the returned content strings. */
  readProjectFiles(projectPath: string): Promise<RawProjectFiles>

  watchFile?(filePath: string): Promise<{ success: boolean; error?: string }>

  /** Stop watching a file. */
  unwatchFile?(filePath: string): Promise<{ success: boolean }>

  /** Stop watching all files. */
  unwatchAll?(): Promise<{ success: boolean }>

  onFileExternalChange?(callback: (filePath: string) => void): Unsubscribe

  /** `null` means no README exists. */
  getReadme?(projectId: string): Promise<string | null>

  /** `content === null` deletes the README; an empty string keeps the file present but empty. */
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

  pickPlcopenImportFile(): Promise<{ success: boolean; content?: string; error?: string }>

  exportPlcopenFile(defaultFileName: string, xml: string): Promise<{ success: boolean; error?: string }>

  /** `canceled` distinguishes a dismissed save dialog from a write failure. */
  exportPdfFile(
    defaultFileName: string,
    bytes: Uint8Array,
  ): Promise<{ success: boolean; canceled?: boolean; error?: string }>

  /** Rejects on failure. Editor renders on the main thread: `import.meta.url` workers don't compile under its CommonJS tsconfig. */
  renderPdf(request: PrintRequest): Promise<Uint8Array>

  /** Idempotent. Editor configures pdf.js in-process: Electron's CSP blocks a blob Worker, and its V8 lacks the `toHex()` the worker code needs. */
  preparePdfPreviewWorker(pdfjsLib: typeof PdfJsLib): Promise<void>
}
