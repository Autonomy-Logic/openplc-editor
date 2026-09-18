import { z } from 'zod'

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
  /** HEAD content; only with `includeContent`. Empty string for added files. */
  before?: string
  /** Working-tree content; only with `includeContent`. Empty string for deleted files. */
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

export interface BranchDiffFile {
  path: string
  content: string
  type: 'file' | 'directory'
}

export interface BranchCommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  authorEmail: string
  timestamp: string
  branch: string
  parentHash: string | null
}

export interface BranchSnapshot {
  branch: string
  commit: BranchCommitInfo
  files: BranchDiffFile[]
}

/** `base` is null when the two branches share no history. */
export interface BranchDiffWithBase {
  source: BranchSnapshot
  target: BranchSnapshot
  base: BranchSnapshot | null
  conflicts: string[]
}

export interface MergeResult {
  message: string
  mergeCommit: BranchCommitInfo
  sourceBranch: string
  targetBranch: string
}

/** Raised on a server 409: every conflicting file needs a decision, and an incomplete resolution set counts as none. */
export class MergeConflictError extends Error {
  readonly conflictedFiles: string[]

  constructor(conflictedFiles: string[], message = 'The merge has conflicts that need resolving') {
    super(message)
    this.name = 'MergeConflictError'
    this.conflictedFiles = conflictedFiles
  }
}

/** How a version-control operation can fail, as data rather than an exception (IPC structure-clones the value). */
export type VersionControlFailure =
  | { kind: 'signed-out' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'carry-conflict'; conflictedFiles: string[] }
  | { kind: 'stash-conflict' }
  | { kind: 'merge-conflict'; conflictedFiles: string[]; message: string }
  | { kind: 'http'; status: number; message: string }

export type VersionControlResult<T> = { ok: true; data: T } | { ok: false; failure: VersionControlFailure }

/** Runtime check: a result arriving over IPC establishes nothing at the type level. */
export const VersionControlFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signed-out') }),
  z.object({ kind: z.literal('unreachable'), message: z.string() }),
  z.object({ kind: z.literal('carry-conflict'), conflictedFiles: z.array(z.string()) }),
  z.object({ kind: z.literal('stash-conflict') }),
  z.object({ kind: z.literal('merge-conflict'), conflictedFiles: z.array(z.string()), message: z.string() }),
  z.object({ kind: z.literal('http'), status: z.number(), message: z.string() }),
]) satisfies z.ZodType<VersionControlFailure>

/** No `satisfies z.ZodType<...>` here: a zod key admitting `undefined` is inferred optional, so `data: unknown` would mismatch `data?: unknown`. */
export const VersionControlResultSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), failure: VersionControlFailureSchema }),
])

/** Thrown by `switchBranch` with `strategy: 'carry'` on blocking conflicts; server state is left unchanged. */
export class SwitchBranchCarryConflictError extends Error {
  readonly conflictedFiles: string[]

  constructor(conflictedFiles: string[]) {
    super(`Carry conflicts in ${conflictedFiles.length} file(s)`)
    this.name = 'SwitchBranchCarryConflictError'
    this.conflictedFiles = conflictedFiles
  }
}

export interface ListCommitsOptions {
  limit?: number
  offset?: number
  branch?: string
}

export interface VersionControlPort {
  /** Optional; gated by `capabilities.hasBranchMerge`. */
  getBranchDiffWithBase?(projectId: string, source: string, target: string): Promise<BranchDiffWithBase>

  /** Supply every conflicting file in `resolutions`, or the call rejects with {@link MergeConflictError}. */
  mergeBranches?(params: {
    projectId: string
    sourceBranch: string
    targetBranch: string
    commitMessage?: string
    resolutions?: Record<string, string>
  }): Promise<MergeResult>
  /** List all branches for a project. */
  listBranches(projectId: string): Promise<{ branches: Branch[] }>

  /** Create a new branch. */
  createBranch(projectId: string, name: string): Promise<{ branch: Branch }>

  /** Delete a branch by ID. */
  deleteBranch(projectId: string, branchId: string): Promise<void>

  /** Server-side checkout. `strategy` 'discard' (default) wipes uncommitted edits; 'carry' transports them, rejecting with `SwitchBranchCarryConflictError` on conflict. */
  switchBranch(
    projectId: string,
    branchName: string,
    strategy?: SwitchBranchStrategy,
  ): Promise<{ message: string; branch: string }>

  /** Read-only prediction; changes nothing on the server. */
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

  /** `includeContent` fills `before`/`after` so a diff can be rendered without further requests. */
  getChanges(
    projectId: string,
    branch?: string,
    includeContent?: boolean,
  ): Promise<{ changes: PendingChange[]; hasChanges: boolean }>

  /** Discard pending changes. Optionally specify which files to discard. */
  discardChanges(projectId: string, files?: string[], branch?: string): Promise<void>

  /** List the project's stashes (most recent first). */
  listStashes(projectId: string): Promise<{ stashes: Stash[] }>

  /** Reverts the working tree to the last commit. */
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
