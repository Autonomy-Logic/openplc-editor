/**
 * Editor VersionControlPort adapter — Autonomy Edge, over IPC. IPC structure-clones thrown
 * errors, so their prototypes (and `instanceof` checks in the UI) don't survive the crossing;
 * `unwrap` below rebuilds the typed errors from plain data the main process reports instead.
 */

import { computeGraphicalDiff as computeGraphicalDiffImpl } from '../../../backend/shared/utils/graphical-diff'
import type {
  BranchDiffWithBase,
  Commit,
  GraphicalDiffResult,
  ListCommitsOptions,
  MergeResult,
  SwitchBranchStrategy,
  VersionControlPort,
  VersionControlResult,
} from '../../shared/ports/version-control-port'
import {
  MergeConflictError,
  StashConflictError,
  SwitchBranchCarryConflictError,
  VersionControlResultSchema,
} from '../../shared/ports/version-control-port'

// Turns a reported failure back into the error the UI expects (or hands back the data). The two
// conflict kinds have real recovery flows keyed off their class; everything else becomes a plain `Error`.
function unwrap<T>(result: VersionControlResult<T>): T {
  // Validated first: `result` crossed IPC and its declared type checks nothing at runtime, so an
  // unreadable answer would otherwise raise or fall through the exhaustive branch below.
  const envelope = VersionControlResultSchema.safeParse(result)

  if (!envelope.success) {
    throw new Error('Autonomy Edge returned an answer this build of the editor cannot read.')
  }

  if (result.ok) {
    return result.data
  }

  const { failure } = result

  switch (failure.kind) {
    case 'carry-conflict':
      throw new SwitchBranchCarryConflictError(failure.conflictedFiles)
    case 'stash-conflict':
      throw new StashConflictError()
    case 'merge-conflict':
      throw new MergeConflictError(failure.conflictedFiles, failure.message)
    case 'signed-out':
      throw new Error('Not signed in to Autonomy Edge.')
    case 'unreachable':
      // Named "unreachable", not a failed operation: whether it actually happened is unknown.
      throw new Error(`Could not reach Autonomy Edge. ${failure.message}`)
    case 'http':
      throw new Error(failure.message)
    default: {
      const exhaustive: never = failure

      throw new Error(`Unhandled version-control failure: ${JSON.stringify(exhaustive)}`)
    }
  }
}

// Binds one IPC channel, guarding against a main process that predates it (a partial rebuild or
// mismatched update can leave the channel missing) — fails as an ordinary reportable error instead
// of an unhandled rejection that takes down the whole workspace.
function channel<A extends unknown[], T>(
  fn: ((...args: A) => Promise<VersionControlResult<T>>) | undefined,
  name: string,
): (...args: A) => Promise<T> {
  return async (...args: A) => {
    if (typeof fn !== 'function') {
      throw new Error(`Version control is unavailable in this build of the editor (${name} is missing).`)
    }

    return unwrap(await fn(...args))
  }
}

export function createEditorVersionControlAdapter(): VersionControlPort {
  const { bridge } = window

  // Bound once, at construction: the channel set cannot change while the app runs, so
  // the guard above is paid once per channel rather than on every call.
  const listBranches = channel(bridge.edgeVcListBranches, 'edge-vc:list-branches')
  const createBranch = channel(bridge.edgeVcCreateBranch, 'edge-vc:create-branch')
  const deleteBranch = channel(bridge.edgeVcDeleteBranch, 'edge-vc:delete-branch')
  const switchBranch = channel(bridge.edgeVcSwitchBranch, 'edge-vc:switch-branch')
  const previewSwitchCarry = channel(bridge.edgeVcPreviewSwitchCarry, 'edge-vc:preview-switch-carry')
  const listCommits = channel(bridge.edgeVcListCommits, 'edge-vc:list-commits')
  const createCommit = channel(bridge.edgeVcCreateCommit, 'edge-vc:create-commit')
  const getCommitFiles = channel(bridge.edgeVcGetCommitFiles, 'edge-vc:get-commit-files')
  const restoreCommit = channel(bridge.edgeVcRestoreCommit, 'edge-vc:restore-commit')
  const getChanges = channel(bridge.edgeVcGetChanges, 'edge-vc:get-changes')
  const discardChanges = channel(bridge.edgeVcDiscardChanges, 'edge-vc:discard-changes')
  const listStashes = channel(bridge.edgeVcListStashes, 'edge-vc:list-stashes')
  const createStash = channel(bridge.edgeVcCreateStash, 'edge-vc:create-stash')
  const applyStash = channel(bridge.edgeVcApplyStash, 'edge-vc:apply-stash')
  const popStash = channel(bridge.edgeVcPopStash, 'edge-vc:pop-stash')
  const dropStash = channel(bridge.edgeVcDropStash, 'edge-vc:drop-stash')
  const branchDiffWithBase = channel(bridge.edgeVcBranchDiffWithBase, 'edge-vc:branch-diff-with-base')
  const merge = channel(bridge.edgeVcMergeBranches, 'edge-vc:merge-branches')

  return {
    listBranches: (projectId: string) => listBranches(projectId),

    createBranch: (projectId: string, name: string) => createBranch(projectId, name),

    deleteBranch: async (projectId: string, branchId: string) => {
      await deleteBranch(projectId, branchId)
    },

    // Defaults to 'discard' here (not in the main process) to match the web adapter's signature exactly.
    switchBranch: (projectId: string, branchName: string, strategy: SwitchBranchStrategy = 'discard') =>
      switchBranch(projectId, branchName, strategy),

    previewSwitchCarry: (projectId: string, targetBranch: string) => previewSwitchCarry(projectId, targetBranch),

    listCommits: (projectId: string, options: ListCommitsOptions = {}) => listCommits(projectId, options),

    createCommit: (projectId: string, message: string, files?: string[], branch?: string): Promise<Commit> =>
      createCommit(projectId, message, files, branch),

    getCommitFiles: (projectId: string, hash: string, branch?: string) => getCommitFiles(projectId, hash, branch),

    restoreCommit: (projectId: string, hash: string, branch?: string) => restoreCommit(projectId, hash, branch),

    // `branch` is accepted and dropped, as the web adapter does too: the backend rejects it and
    // computes changes against the worker's checked-out HEAD regardless.
    getChanges: (projectId: string, _branch?: string, includeContent?: boolean) =>
      getChanges(projectId, includeContent),

    discardChanges: async (projectId: string, files?: string[], _branch?: string) => {
      await discardChanges(projectId, files)
    },

    listStashes: (projectId: string) => listStashes(projectId),

    createStash: (projectId: string, message?: string, files?: string[]) => createStash(projectId, message, files),

    applyStash: (projectId: string, ref: string) => applyStash(projectId, ref),

    popStash: (projectId: string, ref: string) => popStash(projectId, ref),

    dropStash: async (projectId: string, ref: string) => {
      await dropStash(projectId, ref)
    },

    getBranchDiffWithBase: (projectId: string, source: string, target: string): Promise<BranchDiffWithBase> =>
      branchDiffWithBase(projectId, source, target),

    mergeBranches: (params: {
      projectId: string
      sourceBranch: string
      targetBranch: string
      commitMessage?: string
      resolutions?: Record<string, string>
    }): Promise<MergeResult> => merge(params),

    // Stays in the renderer: pure, synchronous computation over content the caller already holds;
    // a shared module keeps desktop and web producing the same diff from the same bytes.
    computeGraphicalDiff: (originalContent: string, currentContent: string, filePath: string): GraphicalDiffResult =>
      computeGraphicalDiffImpl(originalContent, currentContent, filePath),
  }
}
