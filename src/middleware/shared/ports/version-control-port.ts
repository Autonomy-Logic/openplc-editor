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
 *   - POST   /projects/{id}/branches/switch      — Switch active branch (discard or carry strategy)
 *   - GET    /projects/{id}/branches/preview-switch-carry — Dry-run carry to detect conflicts
 *   - GET    /projects/{id}/commits              — List commits (paginated)
 *   - POST   /projects/{id}/commits              — Create commit
 *   - GET    /projects/{id}/commits/{hash}/files  — Get files at commit (with parent for diffing)
 *   - POST   /projects/{id}/commits/{hash}/restore — Restore to a previous commit
 *   - GET    /projects/{id}/changes              — Get pending (uncommitted) changes
 *   - POST   /projects/{id}/discard-changes      — Discard pending changes
 *   - GET    /projects/{id}/stashes              — List stashes
 *   - POST   /projects/{id}/stashes              — Stash pending changes
 *   - POST   /projects/{id}/stashes/apply        — Apply a stash (keep it)
 *   - POST   /projects/{id}/stashes/pop          — Apply a stash and drop it
 *   - POST   /projects/{id}/stashes/drop         — Drop a stash
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
  /** HEAD (committed) content. Present only when getChanges is called with
   *  `includeContent`. Empty string for added files. */
  before?: string
  /** Working-tree content. Present only when getChanges is called with
   *  `includeContent`. Empty string for deleted files. */
  after?: string
}

export interface Stash {
  /** Stack position label at list time, e.g. `stash@{0}`. */
  ref: string
  /** Stack index at list time. */
  index: number
  /** Stash commit SHA — stable identifier used for apply/pop/drop. */
  hash: string
  /** User-facing message. */
  message: string
  /** Branch the stash was created on. */
  branch: string
  /** ISO-8601 creation timestamp. */
  createdAt: string
}

/** Raised when apply/pop cannot complete cleanly (server returns 409). */
export class StashConflictError extends Error {
  constructor(message = 'Stash could not be applied cleanly') {
    super(message)
    this.name = 'StashConflictError'
  }
}

export type SwitchBranchStrategy = 'discard' | 'carry'

/**
 * Thrown by `switchBranch` when called with `strategy: 'carry'` and the
 * server detects conflicts that would block the carry. The project state on
 * the server is unchanged — the user can pick discard, cancel, or resolve
 * conflicts manually before retrying.
 */
export class SwitchBranchCarryConflictError extends Error {
  readonly conflictedFiles: string[]

  constructor(conflictedFiles: string[]) {
    super(`Carry conflicts in ${conflictedFiles.length} file(s)`)
    this.name = 'SwitchBranchCarryConflictError'
    this.conflictedFiles = conflictedFiles
  }
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

  /**
   * Switch to a different branch (server-side checkout). When the working
   * tree has uncommitted edits, `strategy` controls what happens to them:
   *   - 'discard' (default): the edits are wiped, matching the historical
   *     behaviour of this endpoint.
   *   - 'carry': the edits are transported to the target branch. If the
   *     carry would conflict, the call rejects with a `SwitchBranchCarryConflictError`
   *     and the project state is left untouched.
   */
  switchBranch(
    projectId: string,
    branchName: string,
    strategy?: SwitchBranchStrategy,
  ): Promise<{ message: string; branch: string }>

  /**
   * Predict whether carrying the current uncommitted edits to `targetBranch`
   * would conflict. Returns the list of conflicted files (empty when carry
   * is safe). Read-only — never mutates project state.
   */
  previewSwitchCarry(projectId: string, targetBranch: string): Promise<{ conflicts: string[] }>

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

  /**
   * Get pending (uncommitted) changes. When `includeContent` is true, each
   * change also carries `before` (HEAD) and `after` (working-tree) content so
   * the caller can render a diff without further requests.
   */
  getChanges(
    projectId: string,
    branch?: string,
    includeContent?: boolean,
  ): Promise<{ changes: PendingChange[]; hasChanges: boolean }>

  /** Discard pending changes. Optionally specify which files to discard. */
  discardChanges(projectId: string, files?: string[], branch?: string): Promise<void>

  /** List the project's stashes (most recent first). */
  listStashes(projectId: string): Promise<{ stashes: Stash[] }>

  /**
   * Stash pending changes, reverting the working tree to the last commit.
   * Optionally restrict the stash to specific files.
   */
  createStash(projectId: string, message?: string, files?: string[]): Promise<{ stash: Stash }>

  /** Re-apply a stash onto the working tree, keeping it on the stack. Throws {@link StashConflictError} on conflict. */
  applyStash(projectId: string, ref: string): Promise<{ message: string }>

  /** Re-apply a stash and drop it on success. Throws {@link StashConflictError} on conflict (stash kept). */
  popStash(projectId: string, ref: string): Promise<{ message: string }>

  /** Permanently remove a stash without applying it. */
  dropStash(projectId: string, ref: string): Promise<void>

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
