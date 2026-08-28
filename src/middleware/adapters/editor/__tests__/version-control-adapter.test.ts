/**
 * The editor's version-control adapter.
 *
 * This file exists for one reason above all others: the UI decides what to show by asking
 * `error instanceof SwitchBranchCarryConflictError`, and IPC destroys that. A class sent
 * through a structured clone arrives as a plain object, `instanceof` answers false, and a
 * blocked branch switch stops offering the conflict dialog and starts looking like a
 * button that does nothing at all. So the assertions below are about identity, not
 * message text — a test that only checked the wording would still pass while the feature
 * was broken.
 *
 * The rest guards the two things that are easy to get subtly wrong: a stale main process
 * must produce an error rather than take the workspace down with it, and the `branch`
 * argument on the working-tree calls must be swallowed here exactly as the web adapter
 * swallows it.
 */

import {
  MergeConflictError,
  StashConflictError,
  SwitchBranchCarryConflictError,
} from '../../../shared/ports/version-control-port'
import { createEditorVersionControlAdapter } from '../version-control-adapter'

const computeGraphicalDiffImpl = jest.fn((_original: string, _current: string, _path: string) => ({
  isLadder: true,
}))

jest.mock('../../../../backend/shared/utils/graphical-diff', () => ({
  computeGraphicalDiff: (original: string, current: string, path: string) =>
    computeGraphicalDiffImpl(original, current, path),
}))

/** Every channel the adapter binds, so a missing one is a deliberate act in a test. */
const CHANNELS = [
  'edgeVcListBranches',
  'edgeVcCreateBranch',
  'edgeVcDeleteBranch',
  'edgeVcSwitchBranch',
  'edgeVcPreviewSwitchCarry',
  'edgeVcListCommits',
  'edgeVcCreateCommit',
  'edgeVcGetCommitFiles',
  'edgeVcRestoreCommit',
  'edgeVcGetChanges',
  'edgeVcDiscardChanges',
  'edgeVcListStashes',
  'edgeVcCreateStash',
  'edgeVcApplyStash',
  'edgeVcPopStash',
  'edgeVcDropStash',
  'edgeVcBranchDiffWithBase',
  'edgeVcMergeBranches',
] as const

type Bridge = Record<string, jest.Mock>

function installBridge(): Bridge {
  const bridge: Bridge = {}

  for (const name of CHANNELS) {
    bridge[name] = jest.fn().mockResolvedValue({ ok: true, data: null })
  }

  Object.defineProperty(window, 'bridge', { value: bridge, writable: true, configurable: true })

  return bridge
}

let bridge: Bridge

beforeEach(() => {
  jest.clearAllMocks()
  bridge = installBridge()
})

describe('a reported failure becomes the error the UI branches on', () => {
  it('rebuilds a carry conflict, with its files', async () => {
    bridge.edgeVcSwitchBranch.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'carry-conflict', conflictedFiles: ['pous/programs/main.st', 'devices/configuration.json'] },
    })

    const vc = createEditorVersionControlAdapter()

    // `instanceof`, not the message: that is precisely what the clone breaks, and it is
    // what `branch-status-bar` tests to decide whether to reopen the conflict modal.
    await expect(vc.switchBranch('p1', 'feature', 'carry')).rejects.toBeInstanceOf(SwitchBranchCarryConflictError)

    await expect(vc.switchBranch('p1', 'feature', 'carry')).resolves.toBeDefined()
  })

  it('carries the conflicted paths through, because the modal lists them', async () => {
    const conflictedFiles = ['pous/programs/main.st']
    bridge.edgeVcSwitchBranch.mockResolvedValueOnce({ ok: false, failure: { kind: 'carry-conflict', conflictedFiles } })

    const vc = createEditorVersionControlAdapter()

    await expect(vc.switchBranch('p1', 'feature', 'carry')).rejects.toMatchObject({ conflictedFiles })
  })

  it('rebuilds a stash conflict for apply and for pop', async () => {
    bridge.edgeVcApplyStash.mockResolvedValueOnce({ ok: false, failure: { kind: 'stash-conflict' } })
    bridge.edgeVcPopStash.mockResolvedValueOnce({ ok: false, failure: { kind: 'stash-conflict' } })

    const vc = createEditorVersionControlAdapter()

    await expect(vc.applyStash('p1', 's1')).rejects.toBeInstanceOf(StashConflictError)
    await expect(vc.popStash('p1', 's1')).rejects.toBeInstanceOf(StashConflictError)
  })

  it('does not dress an ordinary failure up as a conflict', async () => {
    bridge.edgeVcSwitchBranch.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'http', status: 409, message: 'Branch already exists' },
    })

    const vc = createEditorVersionControlAdapter()
    const error = await vc.switchBranch('p1', 'feature', 'carry').catch((e: unknown) => e)

    // Otherwise the conflict modal opens with nothing in it.
    expect(error).not.toBeInstanceOf(SwitchBranchCarryConflictError)
    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : '').toBe('Branch already exists')
  })

  it('says plainly that there is no session', async () => {
    bridge.edgeVcListBranches.mockResolvedValueOnce({ ok: false, failure: { kind: 'signed-out' } })

    await expect(createEditorVersionControlAdapter().listBranches('p1')).rejects.toThrow(
      'Not signed in to Autonomy Edge.',
    )
  })

  it('says unreachable rather than implying the operation was refused', async () => {
    bridge.edgeVcCreateCommit.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'unreachable', message: 'ENOTFOUND' },
    })

    // The commit may or may not have landed. Wording it as a refusal would be the
    // dangerous direction to be wrong in.
    await expect(createEditorVersionControlAdapter().createCommit('p1', 'msg')).rejects.toThrow(
      /Could not reach Autonomy Edge/,
    )
  })
})

describe('a stale main process fails as an error, not as a crash', () => {
  it('reports the missing channel by name', async () => {
    delete bridge.edgeVcListBranches

    // A renderer bundle is not always paired with the main bundle beside it. Reading
    // straight through would raise "... is not a function" inside a load effect and take
    // the whole workspace down — which has already happened once, on the cloud list.
    await expect(createEditorVersionControlAdapter().listBranches('p1')).rejects.toThrow(
      /edge-vc:list-branches is missing/,
    )
  })

  it('still builds the adapter, so the rest of the workspace loads', () => {
    delete bridge.edgeVcListBranches

    expect(() => createEditorVersionControlAdapter()).not.toThrow()
  })
})

describe('the calls reach the right channel with the right arguments', () => {
  it('passes branch operations straight through', async () => {
    const vc = createEditorVersionControlAdapter()

    await vc.createBranch('p1', 'feature')
    expect(bridge.edgeVcCreateBranch).toHaveBeenCalledWith('p1', 'feature')

    await vc.deleteBranch('p1', 'b2')
    expect(bridge.edgeVcDeleteBranch).toHaveBeenCalledWith('p1', 'b2')

    await vc.previewSwitchCarry('p1', 'feature')
    expect(bridge.edgeVcPreviewSwitchCarry).toHaveBeenCalledWith('p1', 'feature')
  })

  it('defaults a switch to discard, matching the web adapter signature', async () => {
    await createEditorVersionControlAdapter().switchBranch('p1', 'feature')

    // Carrying edits on an unstated strategy could move work onto a branch the user did
    // not mean to touch.
    expect(bridge.edgeVcSwitchBranch).toHaveBeenCalledWith('p1', 'feature', 'discard')
  })

  it('defaults commit options to an empty object rather than undefined', async () => {
    await createEditorVersionControlAdapter().listCommits('p1')

    expect(bridge.edgeVcListCommits).toHaveBeenCalledWith('p1', {})
  })

  it('drops the branch argument on the working-tree calls', async () => {
    const vc = createEditorVersionControlAdapter()

    await vc.getChanges('p1', 'feature', true)
    // The backend's whitelist rejects the param and computes against the checked-out
    // HEAD anyway. Same omission the web adapter documents.
    expect(bridge.edgeVcGetChanges).toHaveBeenCalledWith('p1', true)

    await vc.discardChanges('p1', ['a.st'], 'feature')
    expect(bridge.edgeVcDiscardChanges).toHaveBeenCalledWith('p1', ['a.st'])
  })

  it('unwraps the data on success', async () => {
    bridge.edgeVcListBranches.mockResolvedValueOnce({ ok: true, data: { branches: [{ id: 'b1' }] } })

    await expect(createEditorVersionControlAdapter().listBranches('p1')).resolves.toEqual({
      branches: [{ id: 'b1' }],
    })
  })

  it('resolves the void operations without handing back the envelope', async () => {
    bridge.edgeVcDropStash.mockResolvedValueOnce({ ok: true, data: null })

    await expect(createEditorVersionControlAdapter().dropStash('p1', 's1')).resolves.toBeUndefined()
  })
})

describe('the graphical diff', () => {
  it('runs locally, on the shared implementation', () => {
    const vc = createEditorVersionControlAdapter()

    const result = vc.computeGraphicalDiff('<before/>', '<after/>', 'pous/programs/main.xml')

    // Synchronous by contract, and pure computation over content the caller already
    // holds — sending a whole LD program across IPC to diff it would be slower and no
    // more correct. Shared module, so the desktop and the web produce the same diff.
    expect(computeGraphicalDiffImpl).toHaveBeenCalledWith('<before/>', '<after/>', 'pous/programs/main.xml')
    expect(result).toEqual({ isLadder: true })
  })
})

describe('the merge conflict crosses IPC as itself', () => {
  it('rebuilds MergeConflictError, with the files the resolver needs', async () => {
    bridge.edgeVcMergeBranches.mockResolvedValueOnce({
      ok: false,
      failure: {
        kind: 'merge-conflict',
        conflictedFiles: ['pous/programs/main.st', 'devices/configuration.json'],
        message: 'Merge conflicts detected',
      },
    })

    const vc = createEditorVersionControlAdapter()
    const error = await vc
      .mergeBranches?.({ projectId: 'p1', sourceBranch: 'feature', targetBranch: 'main' })
      .catch((e: unknown) => e)

    // `instanceof`, not the message: the screen opens its conflict resolver on the type,
    // and the prototype is exactly what a structured clone destroys.
    expect(error).toBeInstanceOf(MergeConflictError)
    expect(error).toMatchObject({ conflictedFiles: ['pous/programs/main.st', 'devices/configuration.json'] })
  })

  it('passes the merge through on success', async () => {
    bridge.edgeVcMergeBranches.mockResolvedValueOnce({
      ok: true,
      data: { message: 'Merged', mergeCommit: { shortHash: 'abc1234' } },
    })

    const vc = createEditorVersionControlAdapter()

    await expect(
      vc.mergeBranches?.({ projectId: 'p1', sourceBranch: 'feature', targetBranch: 'main' }),
    ).resolves.toMatchObject({ message: 'Merged' })
  })

  it('reaches the diff channel with both branches', async () => {
    bridge.edgeVcBranchDiffWithBase.mockResolvedValueOnce({ ok: true, data: { conflicts: [] } })

    await createEditorVersionControlAdapter().getBranchDiffWithBase?.('p1', 'feature', 'main')

    expect(bridge.edgeVcBranchDiffWithBase).toHaveBeenCalledWith('p1', 'feature', 'main')
  })
})
