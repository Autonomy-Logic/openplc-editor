import { createEditorVersionControlAdapter } from '../version-control-adapter'

describe('createEditorVersionControlAdapter', () => {
  const adapter = createEditorVersionControlAdapter()

  const methods: Array<[string, () => unknown]> = [
    ['listBranches', () => adapter.listBranches('p')],
    ['createBranch', () => adapter.createBranch('p', 'b')],
    ['deleteBranch', () => adapter.deleteBranch('p', 'b')],
    ['switchBranch', () => adapter.switchBranch('p', 'b')],
    ['previewSwitchCarry', () => adapter.previewSwitchCarry('p', 'b')],
    ['listCommits', () => adapter.listCommits('p')],
    ['createCommit', () => adapter.createCommit('p', 'm')],
    ['getCommitFiles', () => adapter.getCommitFiles('p', 'h')],
    ['restoreCommit', () => adapter.restoreCommit('p', 'h')],
    ['getChanges', () => adapter.getChanges('p')],
    ['discardChanges', () => adapter.discardChanges('p')],
    ['computeGraphicalDiff', () => adapter.computeGraphicalDiff('a', 'b', 'pou')],
  ]

  it.each(methods)('throws unsupported error from %s', (method, call) => {
    expect(call).toThrow(`VersionControl.${method}() is not supported in the desktop editor`)
  })
})
