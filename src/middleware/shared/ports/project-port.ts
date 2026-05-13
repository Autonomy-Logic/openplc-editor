/**
 * ProjectPort — Abstracts project lifecycle operations (create, open, save, POU management).
 *
 * Editor adapter: Delegates to main process project-service and pou-service via IPC.
 *                 Files stored on local filesystem. Recent projects tracked in electron-store.
 * Web adapter:    Delegates to project-api.ts and in-memory state.
 *                 Projects stored on backend API. Recent projects tracked in cookies/localStorage.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.createProject()
 *   - window.bridge.openProject()
 *   - window.bridge.openProjectByPath()
 *   - window.bridge.saveProject()
 *   - window.bridge.saveFile()
 *   - window.bridge.createPouFile()
 *   - window.bridge.deletePouFile()
 *   - window.bridge.renamePouFile()
 *   - window.bridge.pathPicker()
 *   - window.bridge.retrieveRecent()
 *   - window.bridge.getRecent()
 *   - window.bridge.fileWatchStart()
 *   - window.bridge.fileWatchStop()
 *   - window.bridge.fileWatchStopAll()
 *   - window.bridge.fileReadContent()
 *   - window.bridge.onFileExternalChange()
 *
 * ## Web service methods replaced:
 *   - fetchProjectFromApi()
 *   - Project state in Zustand store
 */

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
    devicePinMapping?: DevicePin[]
    /** Warnings from parsing (e.g. dropped files that failed validation). */
    warnings?: string[]
    /**
     * Raw file contents as returned by the backend (path → text), captured
     * before parsing. Used by the save flow to upload byte-identical content
     * for files the user didn't edit, avoiding phantom "modified" diffs that
     * arise from parse-serialize formatting drift.
     */
    rawLoadedFiles?: Record<string, string>
  }
  error?: {
    title: string
    description: string
  }
}

/**
 * Pre-serialized project files for writing to disk.
 * All content is already serialized to strings — the backend is a dumb file writer.
 * Mirrors the read-side RawProjectFiles shape but oriented for writing.
 */
export interface WriteProjectFiles {
  projectPath: string
  /** Pre-serialized project.json content */
  projectJson: string
  /** Pre-serialized devices/configuration.json content.  `undefined`
   *  for project types that don't own this file (library projects);
   *  the backend skips the write rather than truncating the on-disk
   *  copy to an empty string. */
  deviceConfig?: string
  /** Pre-serialized devices/pin-mapping.json content.  Same
   *  optional-on-libraries semantics as `deviceConfig`. */
  pinMapping?: string
  /** Pre-serialized library.json content for library projects.
   *  `undefined` for PLC projects (no manifest file) and for
   *  library projects whose manifest tab hasn't been mounted this
   *  session (no in-memory buffer to persist).  Backend skips the
   *  write when undefined — never truncates the on-disk copy. */
  libraryManifest?: string
  /** POU files with pre-serialized IEC text content */
  pouFiles: RawProjectFile[]
  /** Server config files with pre-serialized JSON content */
  serverFiles: RawProjectFile[]
  /** Remote device config files with pre-serialized JSON content */
  remoteDeviceFiles: RawProjectFile[]
  /** Relative paths to delete from disk (e.g. 'pous/programs/OldPou.st') */
  deletions: string[]
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
    /** Raw content of `library.json` for library projects.  Empty
     *  string for PLC projects (no manifest file) and for library
     *  projects whose disk shape is missing the file (defensive —
     *  the manifest editor seeds a template on first save). */
    libraryManifest: string
    /** Raw POU files (.st, .il, .ld, .fbd, .py, .cpp, .json) */
    pouFiles: RawProjectFile[]
    /** Raw server config files from devices/servers/ */
    serverFiles: RawProjectFile[]
    /** Raw remote device config files from devices/remote/ */
    remoteDeviceFiles: RawProjectFile[]
  }
  error?: { title: string; description: string }
}

export interface ProjectPort {
  /** Create a new project. */
  createProject(params: CreateProjectParams): Promise<ProjectResponse>

  /**
   * Open a project via platform file picker.
   * Editor: shows native file dialog.
   * Web: may show file input or project list.
   */
  openProject(): Promise<ProjectResponse>

  /** Open a project by its path or identifier. */
  openProjectByPath(projectPath: string): Promise<ProjectResponse>

  /** Save the entire project. All files are pre-serialized by the frontend. */
  saveProject(files: WriteProjectFiles): Promise<{ success: boolean; error?: string }>

  /**
   * Save a single file within the project.
   * Editor: writes to disk.
   * Web: updates in-memory state and/or syncs to backend.
   */
  saveFile(filePath: string, content: unknown): Promise<{ success: boolean; error?: string }>

  /** Create a new POU file. */
  createPou(params: CreatePouParams): Promise<{ success: boolean; data?: unknown; error?: string }>

  /** Delete a POU file. */
  deletePou(filePath: string): Promise<{ success: boolean; error?: string }>

  /** Rename a POU file. */
  renamePou(params: RenamePouParams): Promise<{ success: boolean; data?: unknown; error?: string }>

  /**
   * Pick a filesystem path (for project location).
   * Editor: shows native directory picker dialog.
   * Web: may not be applicable (returns pre-configured path).
   */
  pickPath(): Promise<{ success: boolean; path?: string; error?: { title: string; description: string } }>

  /** Get list of recently opened projects. */
  getRecentProjects(): Promise<RecentProject[]>

  /**
   * Read a file's content by path.
   * Editor: reads from local filesystem via IPC.
   * Web: reads from in-memory project state or API.
   */
  readFileContent(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>

  /**
   * Read all raw project files from disk without parsing.
   * The frontend is responsible for parsing the returned content strings.
   * Editor: reads from local filesystem via IPC.
   * Web: reads from backend API.
   */
  readProjectFiles(projectPath: string): Promise<RawProjectFiles>

  /**
   * Start watching a file for external changes.
   * Editor: uses fs.watch via IPC.
   * Web: no-op (files don't change externally in browser).
   */
  watchFile?(filePath: string): Promise<{ success: boolean; error?: string }>

  /** Stop watching a file. */
  unwatchFile?(filePath: string): Promise<{ success: boolean }>

  /** Stop watching all files. */
  unwatchAll?(): Promise<{ success: boolean }>

  /**
   * Subscribe to external file change events.
   * Editor: fires when file changes on disk outside the editor.
   * Web: not applicable (never fires).
   */
  onFileExternalChange?(callback: (filePath: string) => void): Unsubscribe
}
