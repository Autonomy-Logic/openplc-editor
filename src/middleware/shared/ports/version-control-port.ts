/**
 * VersionControlPort — Abstracts version control operations (branches, commits, change tracking).
 *
 * Editor adapter: No-op implementation. Returns empty arrays and no-ops.
 *                 Version control is not supported on the desktop editor.
 * Web adapter:    Delegates to Edge API endpoints under /projects/{projectId}/.
 *                 Cookie-based authentication via the shared axios instance.
 *
 * ## Web API endpoints:
 *   - GET    /projects/{id}/branches            — List branches
 *   - POST   /projects/{id}/branches            — Create branch
 *   - DELETE /projects/{id}/branches/{branchId}  — Delete branch
 *   - POST   /projects/{id}/branches/switch      — Switch active branch
 *   - GET    /projects/{id}/commits              — List commits (paginated)
 *   - POST   /projects/{id}/commits              — Create commit
 *   - GET    /projects/{id}/commits/{hash}/files  — Get files at commit (with parent for diffing)
 *   - POST   /projects/{id}/commits/{hash}/restore — Restore to a previous commit
 *   - GET    /projects/{id}/changes              — Get pending (uncommitted) changes
 *   - POST   /projects/{id}/discard-changes      — Discard pending changes
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Branch {
  id: string
  projectId: string
  name: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface Commit {
  id: string
  hash: string
  shortHash: string
  message: string
  author: string
  timestamp: string
  parentHash: string | null
}

export interface CommitFile {
  path: string
  content: string
}

export interface CommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  timestamp: string
}

export interface PendingChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ListCommitsOptions {
  limit?: number
  offset?: number
  branch?: string
}

export interface VersionControlPort {
  /** List all branches for a project. */
  listBranches(projectId: string): Promise<{ branches: Branch[] }>

  /** Create a new branch. */
  createBranch(projectId: string, name: string): Promise<{ branch: Branch }>

  /** Delete a branch by ID. */
  deleteBranch(projectId: string, branchId: string): Promise<void>

  /** Switch to a different branch (server-side checkout). */
  switchBranch(projectId: string, branchName: string): Promise<{ message: string; branch: string }>

  /** List commits with optional pagination. */
  listCommits(
    projectId: string,
    options?: ListCommitsOptions,
  ): Promise<{ commits: Commit[]; total: number; page: number }>

  /** Create a new commit. Optionally specify which files to include. */
  createCommit(projectId: string, message: string, files?: string[], branch?: string): Promise<Commit>

  /** Get file contents at a specific commit, plus parent files for diffing. */
  getCommitFiles(
    projectId: string,
    hash: string,
    branch?: string,
  ): Promise<{ files: CommitFile[]; parentFiles: CommitFile[]; commit: CommitInfo }>

  /** Restore the project to a previous commit state. */
  restoreCommit(projectId: string, hash: string, branch?: string): Promise<{ message: string; restoredCommit: Commit }>

  /** Get pending (uncommitted) changes. */
  getChanges(projectId: string, branch?: string): Promise<{ changes: PendingChange[]; hasChanges: boolean }>

  /** Discard pending changes. Optionally specify which files to discard. */
  discardChanges(projectId: string, files?: string[], branch?: string): Promise<void>

  /** Compute graphical diff between two file versions (LD/FBD). */
  computeGraphicalDiff(originalContent: string, currentContent: string, filePath: string): GraphicalDiffResult
}

// ---------------------------------------------------------------------------
// Graphical diff types (returned by computeGraphicalDiff)
// ---------------------------------------------------------------------------

export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged'

export interface FlowData {
  nodes: unknown[]
  edges: unknown[]
}

export interface ParsedVariable {
  name: string
  type: string
  class: string
  location?: string
  initialValue?: string
}

export interface VarDiffEntry {
  name: string
  status: DiffStatus
  original?: ParsedVariable
  current?: ParsedVariable
}

export interface GraphicalDiffResult {
  flows: {
    original: FlowData | null
    current: FlowData | null
    originalHeight: number
    currentHeight: number
    originalWidth: number
    currentWidth: number
  }[]
  changedIndexes: number[]
  variableDiff: VarDiffEntry[]
  nodeDiffMaps: { original: Map<string, DiffStatus>; current: Map<string, DiffStatus> }
  edgeDiffMaps: { original: Map<string, DiffStatus>; current: Map<string, DiffStatus> }[]
  isLadder: boolean
}
