/**
 * Editor VersionControlPort adapter — Autonomy Edge, over IPC.
 *
 * Version control on the desktop is the same feature the web editor has, because it is
 * the same server doing the work: the git repository lives beside the project on Edge and
 * every operation here is one of the seventeen routes the web build calls. Nothing about
 * branching, carrying edits between branches or stashing is reimplemented locally, so the
 * two products cannot drift apart in behaviour — there is only one implementation of it.
 *
 * That also fixes the boundary of the feature. A project opened from disk has no
 * repository anywhere, so it has no history to show; the shared UI gates the whole
 * affordance on `isRemoteProjectPath(projectPath)` and never calls into here for one.
 *
 * REBUILDING THE TYPED ERRORS IS THE POINT OF THIS FILE. The main process cannot throw
 * `SwitchBranchCarryConflictError` at the renderer: IPC structure-clones the value and the
 * prototype does not survive, so every `instanceof` in the UI would quietly answer false
 * and a blocked branch switch would look like a button that does nothing. The main process
 * therefore reports failures as plain data, and `unwrap` below turns them back into the
 * exact error objects the components already branch on. The web adapter gets this for free
 * from axios; the desktop has to do it by hand, and doing it here keeps the components
 * identical between the two.
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
} from '../../shared/ports/version-control-port'

/**
 * Turn a reported failure back into the error the UI expects, or hand back the data.
 *
 * The two conflict kinds are the ones with real recovery flows behind them — the carry
 * modal reopens with the conflicted file list, and the stash panel offers to keep the
 * stash — so they have to arrive as their own classes. Everything else becomes a plain
 * `Error`, which is what the components' `catch` blocks log and toast.
 */
function unwrap<T>(result: VersionControlResult<T>): T {
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
      // Named as unreachable rather than as a failure of the operation: the branch was
      // not "not created", it is unknown whether it was, and the user needs to know the
      // difference before they try again.
      throw new Error(`Could not reach Autonomy Edge. ${failure.message}`)
    case 'http':
      throw new Error(failure.message)
    default: {
      const exhaustive: never = failure

      throw new Error(`Unhandled version-control failure: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * Bind one IPC channel, guarding against a main process that predates it.
 *
 * A renderer bundle is not always paired with the main bundle it was built beside — a
 * partial rebuild during development, or an app that updated one side, leaves the channel
 * missing. Reading straight through would raise `... is not a function`, and an unhandled
 * rejection inside a load effect takes down the whole workspace rather than the panel that
 * asked. This has already happened once, on the cloud project list, so every channel goes
 * through here and fails as an ordinary error the UI can report.
 */
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

    // Defaults to 'discard' here rather than relying on the main process, so the strategy
    // the server is asked for is decided in one place and matches the web adapter's
    // signature exactly.
    switchBranch: (projectId: string, branchName: string, strategy: SwitchBranchStrategy = 'discard') =>
      switchBranch(projectId, branchName, strategy),

    previewSwitchCarry: (projectId: string, targetBranch: string) => previewSwitchCarry(projectId, targetBranch),

    listCommits: (projectId: string, options: ListCommitsOptions = {}) => listCommits(projectId, options),

    createCommit: (projectId: string, message: string, files?: string[], branch?: string): Promise<Commit> =>
      createCommit(projectId, message, files, branch),

    getCommitFiles: (projectId: string, hash: string, branch?: string) => getCommitFiles(projectId, hash, branch),

    restoreCommit: (projectId: string, hash: string, branch?: string) => restoreCommit(projectId, hash, branch),

    // `branch` is accepted and dropped, exactly as the web adapter does: the backend's
    // validation whitelist rejects the query param and computes pending changes against
    // the worker's checked-out HEAD regardless, so forwarding it only earns a 400.
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

    // Stays in the renderer: it is synchronous by contract, and it is pure computation
    // over two file contents the caller already holds. Sending a whole LD program across
    // IPC to compute a diff and sending the result back would be slower and would not
    // make it any more correct. Shared module, so the desktop and the web produce the
    // same diff from the same bytes.
    computeGraphicalDiff: (originalContent: string, currentContent: string, filePath: string): GraphicalDiffResult =>
      computeGraphicalDiffImpl(originalContent, currentContent, filePath),
  }
}
