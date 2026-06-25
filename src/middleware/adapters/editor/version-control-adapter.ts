/**
 * Editor VersionControlPort adapter — no-op implementation.
 *
 * Version control is not supported on the desktop editor.
 * All methods return empty results or throw to indicate unsupported operations.
 * The UI guards these calls behind `capabilities.hasVersionControl === true`,
 * so these methods should never be reached at runtime.
 */

import type { GraphicalDiffResult, VersionControlPort } from '../../shared/ports/version-control-port'

export function createEditorVersionControlAdapter(): VersionControlPort {
  const unsupported = (method: string): never => {
    throw new Error(`VersionControl.${method}() is not supported in the desktop editor`)
  }

  return {
    listBranches: () => unsupported('listBranches'),
    createBranch: () => unsupported('createBranch'),
    deleteBranch: () => unsupported('deleteBranch'),
    switchBranch: () => unsupported('switchBranch'),
    previewSwitchCarry: () => unsupported('previewSwitchCarry'),
    listCommits: () => unsupported('listCommits'),
    createCommit: () => unsupported('createCommit'),
    getCommitFiles: () => unsupported('getCommitFiles'),
    restoreCommit: () => unsupported('restoreCommit'),
    getChanges: () => unsupported('getChanges'),
    discardChanges: () => unsupported('discardChanges'),
    computeGraphicalDiff: () => unsupported('computeGraphicalDiff') as unknown as GraphicalDiffResult,
    listStashes: () => unsupported('listStashes'),
    createStash: () => unsupported('createStash'),
    applyStash: () => unsupported('applyStash'),
    popStash: () => unsupported('popStash'),
    dropStash: () => unsupported('dropStash'),
  }
}
