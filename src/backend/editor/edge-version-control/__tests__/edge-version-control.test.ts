/**
 * Version control against Edge, with HTTP stubbed.
 *
 * What these tests protect is SAMENESS. The desktop and the web editor call the same
 * seventeen routes, and the promise made to the user is that a commit made from one
 * behaves like a commit made from the other. So the assertions here are deliberately
 * literal about method, path, query and body — a drifted query param is not a cosmetic
 * difference, it is a 400 the whitelist raises, and a dropped payload field is a commit
 * that quietly includes the wrong files.
 *
 * The other half is the failure taxonomy. "No session", "you may not", "it never
 * answered" and "these files conflict" are four different things, and the UI has a
 * different flow for each. Collapsing any pair of them produces the class of bug where a
 * dropped connection tells someone their branch cannot be created.
 */

import { edgeAuthedRequest } from '../../edge-account/edge-account-service'
import {
  applyStash,
  getBranchDiffWithBase,
  createBranch,
  createCommit,
  createStash,
  deleteBranch,
  discardChanges,
  dropStash,
  getChanges,
  getCommitFiles,
  listBranches,
  listCommits,
  listStashes,
  mergeBranches,
  popStash,
  previewSwitchCarry,
  restoreCommit,
  switchBranch,
} from '..'

jest.mock('../../edge-account/edge-account-service', () => ({
  edgeAuthedRequest: jest.fn(),
}))

const request = edgeAuthedRequest as jest.MockedFunction<typeof edgeAuthedRequest>

/** A successful envelope, in the `{ statusCode, data }` shape every Edge route answers. */
function ok(data: unknown, status = 200) {
  return { status, body: JSON.stringify({ statusCode: status, data }) }
}

/** The path and init of the nth call. */
function callArgs(index = 0) {
  const [path, init] = request.mock.calls[index]

  return { path, init: init ?? {} }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the routes match the ones the web build calls', () => {
  it('lists branches', async () => {
    request.mockResolvedValueOnce(ok({ branches: [{ id: 'b1', name: 'main' }] }))

    await expect(listBranches('p1')).resolves.toEqual({ ok: true, data: { branches: [{ id: 'b1', name: 'main' }] } })
    expect(callArgs().path).toBe('/projects/p1/branches')
  })

  it('creates a branch by name', async () => {
    request.mockResolvedValueOnce(ok({ branch: { id: 'b2', name: 'feature' } }))

    await createBranch('p1', 'feature')

    expect(callArgs()).toMatchObject({ path: '/projects/p1/branches', init: { method: 'POST', json: { name: 'feature' } } })
  })

  it('deletes a branch by id, with DELETE', async () => {
    request.mockResolvedValueOnce({ status: 204, body: '' })

    await expect(deleteBranch('p1', 'b2')).resolves.toEqual({ ok: true, data: null })
    expect(callArgs()).toMatchObject({ path: '/projects/p1/branches/b2', init: { method: 'DELETE' } })
  })

  it('switches a branch, sending the strategy', async () => {
    request.mockResolvedValueOnce(ok({ message: 'Switched', branch: 'feature' }))

    await switchBranch('p1', 'feature', 'carry')

    expect(callArgs().init).toMatchObject({ method: 'POST', json: { branchName: 'feature', strategy: 'carry' } })
  })

  it('previews a carry as a read, not a write', async () => {
    request.mockResolvedValueOnce(ok({ conflicts: [] }))

    await previewSwitchCarry('p1', 'feature')

    const { path, init } = callArgs()
    expect(path).toBe('/projects/p1/branches/preview-switch-carry?targetBranch=feature')
    // No method means GET. A preview that mutated would defeat its purpose.
    expect(init.method).toBeUndefined()
  })

  it('encodes a branch name that needs it', async () => {
    request.mockResolvedValueOnce(ok({ conflicts: [] }))

    await previewSwitchCarry('p1', 'feat/edge 602')

    expect(callArgs().path).toBe('/projects/p1/branches/preview-switch-carry?targetBranch=feat%2Fedge+602')
  })

  it('paginates commits, omitting what was not asked for', async () => {
    request.mockResolvedValueOnce(ok({ commits: [], total: 0, page: 1 }))
    await listCommits('p1', { limit: 20, offset: 40, branch: 'main' })
    expect(callArgs().path).toBe('/projects/p1/commits?limit=20&offset=40&branch=main')

    request.mockResolvedValueOnce(ok({ commits: [], total: 0, page: 1 }))
    await listCommits('p1')
    // No trailing `?`: an empty query string would be sent as a bare question mark.
    expect(callArgs(1).path).toBe('/projects/p1/commits')
  })

  it('sends offset zero, which is a real page and not a missing one', async () => {
    request.mockResolvedValueOnce(ok({ commits: [], total: 0, page: 1 }))

    await listCommits('p1', { offset: 0 })

    expect(callArgs().path).toBe('/projects/p1/commits?offset=0')
  })

  it('commits with a message, and only mentions files when given some', async () => {
    request.mockResolvedValueOnce(ok({ hash: 'abc' }))
    await createCommit('p1', 'Fix the ladder')
    expect(callArgs().init).toMatchObject({ method: 'POST', json: { message: 'Fix the ladder' } })
    expect(callArgs().init.json).not.toHaveProperty('files')

    request.mockResolvedValueOnce(ok({ hash: 'def' }))
    await createCommit('p1', 'Partial', ['pous/programs/main.st'], 'feature')
    expect(callArgs(1).init.json).toEqual({
      message: 'Partial',
      files: ['pous/programs/main.st'],
      branch: 'feature',
    })
  })

  it('reads a commit with its parent, for diffing', async () => {
    request.mockResolvedValueOnce(ok({ files: [], parentFiles: [], commit: { hash: 'abc' } }))

    await getCommitFiles('p1', 'abc', 'feat/x')

    expect(callArgs().path).toBe('/projects/p1/commits/abc/files?branch=feat%2Fx')
  })

  it('restores a commit', async () => {
    request.mockResolvedValueOnce(ok({ message: 'Restored', restoredCommit: { hash: 'abc' } }))

    await restoreCommit('p1', 'abc')

    expect(callArgs()).toMatchObject({ path: '/projects/p1/commits/abc/restore', init: { method: 'POST', json: {} } })
  })

  it('asks for change content only when the caller wants it', async () => {
    request.mockResolvedValueOnce(ok({ changes: [], hasChanges: false }))
    await getChanges('p1', true)
    expect(callArgs().path).toBe('/projects/p1/changes?includeContent=true')

    request.mockResolvedValueOnce(ok({ changes: [], hasChanges: false }))
    await getChanges('p1')
    expect(callArgs(1).path).toBe('/projects/p1/changes')
  })

  it('never sends a branch on the working-tree routes', async () => {
    // The backend's validation whitelist rejects the param outright, and pending changes
    // are computed against the checked-out HEAD regardless. Sending it earns a 400 and
    // nothing else — the same omission the web adapter documents.
    request.mockResolvedValueOnce(ok({ changes: [], hasChanges: false }))
    await getChanges('p1', true)
    expect(callArgs().path).not.toContain('branch')

    request.mockResolvedValueOnce({ status: 200, body: '{}' })
    await discardChanges('p1', ['a.st'])
    expect(JSON.stringify(callArgs(1).init.json)).not.toContain('branch')
  })

  it('lists, creates, applies, pops and drops stashes on their own routes', async () => {
    request.mockResolvedValueOnce(ok({ stashes: [] }))
    await listStashes('p1')
    expect(callArgs().path).toBe('/projects/p1/stashes')

    request.mockResolvedValueOnce(ok({ stash: { hash: 's1' } }))
    await createStash('p1', 'wip', ['a.st'])
    expect(callArgs(1).init).toMatchObject({ method: 'POST', json: { message: 'wip', files: ['a.st'] } })

    request.mockResolvedValueOnce(ok({ message: 'Applied' }))
    await applyStash('p1', 's1')
    expect(callArgs(2)).toMatchObject({ path: '/projects/p1/stashes/apply', init: { json: { ref: 's1' } } })

    request.mockResolvedValueOnce(ok({ message: 'Popped' }))
    await popStash('p1', 's1')
    expect(callArgs(3).path).toBe('/projects/p1/stashes/pop')

    request.mockResolvedValueOnce({ status: 200, body: '{}' })
    await dropStash('p1', 's1')
    expect(callArgs(4).path).toBe('/projects/p1/stashes/drop')
  })

  it('omits an empty file list from a stash rather than sending one', async () => {
    request.mockResolvedValueOnce(ok({ stash: { hash: 's1' } }))

    await createStash('p1', undefined, [])

    // An empty array would ask the server to stash nothing at all, which is not what
    // "stash everything" means.
    expect(callArgs().init.json).toEqual({})
  })

  it('allows git the time git needs', async () => {
    request.mockResolvedValueOnce(ok({ branches: [] }))

    await listBranches('p1')

    // 30s, matching the web build's axios timeout, so the same commit on the same
    // project gives up at the same point on both platforms. The 15s default is sized
    // for an auth round trip.
    expect(callArgs().init).toMatchObject({ timeoutMs: 30_000 })
  })
})

describe('the four kinds of failure stay apart', () => {
  it('reports no session when there is no token to spend', async () => {
    request.mockResolvedValueOnce(null)

    await expect(listBranches('p1')).resolves.toEqual({ ok: false, failure: { kind: 'signed-out' } })
  })

  it('reports no session on a 401 that survived a renewal', async () => {
    request.mockResolvedValueOnce({ status: 401, body: '{}' })

    await expect(listBranches('p1')).resolves.toEqual({ ok: false, failure: { kind: 'signed-out' } })
  })

  it('keeps a 403 apart from being signed out', async () => {
    request.mockResolvedValueOnce({ status: 403, body: JSON.stringify({ message: 'Read-only project' }) })

    // Signing in again cannot fix a project the account may read but not write, so
    // telling the user to do that would send them in a circle.
    await expect(createBranch('p1', 'x')).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 403, message: 'Read-only project' },
    })
  })

  it('reports unreachable on a transport failure, NOT a refusal', async () => {
    request.mockRejectedValueOnce(new Error('ENOTFOUND'))

    await expect(createBranch('p1', 'x')).resolves.toEqual({
      ok: false,
      failure: { kind: 'unreachable', message: 'ENOTFOUND' },
    })
  })

  it('reports a 500 as an HTTP failure with its status', async () => {
    request.mockResolvedValueOnce({ status: 500, body: '' })

    await expect(listBranches('p1')).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 500, message: 'Autonomy Edge answered 500.' },
    })
  })

  it('joins a validation error list into something readable', async () => {
    request.mockResolvedValueOnce({
      status: 400,
      body: JSON.stringify({ message: ['name must be a string', 'name should not be empty'] }),
    })

    await expect(createBranch('p1', 'x')).resolves.toMatchObject({
      failure: { message: 'name must be a string; name should not be empty' },
    })
  })

  it('does not report an unreadable 2xx body as a success', async () => {
    request.mockResolvedValueOnce({ status: 200, body: '<html>gateway</html>' })

    // A proxy's error page with a 200 on it is not a branch list.
    await expect(listBranches('p1')).resolves.toMatchObject({ ok: false, failure: { kind: 'http' } })
  })
})

describe('the two conflicts the UI can recover from', () => {
  it('names a blocked carry, with the files that blocked it', async () => {
    request.mockResolvedValueOnce({
      status: 409,
      // Top level, not inside `data` — the same place the web adapter reads it from.
      body: JSON.stringify({ hasConflicts: true, conflictedFiles: ['pous/programs/main.st'] }),
    })

    await expect(switchBranch('p1', 'feature', 'carry')).resolves.toEqual({
      ok: false,
      failure: { kind: 'carry-conflict', conflictedFiles: ['pous/programs/main.st'] },
    })
  })

  it('treats a 409 without hasConflicts as an ordinary failure', async () => {
    request.mockResolvedValueOnce({ status: 409, body: JSON.stringify({ message: 'Branch already exists' }) })

    // Only `hasConflicts` means a carry was rejected. Reading every 409 on the route as
    // a carry conflict would reopen the conflict modal with an empty file list.
    await expect(switchBranch('p1', 'feature', 'carry')).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 409, message: 'Branch already exists' },
    })
  })

  it('names a stash that will not apply cleanly', async () => {
    request.mockResolvedValueOnce({ status: 409, body: '{}' })

    await expect(applyStash('p1', 's1')).resolves.toEqual({ ok: false, failure: { kind: 'stash-conflict' } })
  })

  it('names the same for pop, where the stash is kept', async () => {
    request.mockResolvedValueOnce({ status: 409, body: '{}' })

    await expect(popStash('p1', 's1')).resolves.toEqual({ ok: false, failure: { kind: 'stash-conflict' } })
  })

  it('does not invent a conflict on a route that cannot have one', async () => {
    request.mockResolvedValueOnce({ status: 409, body: '{}' })

    // `createBranch` passes no 409 handler, so a name collision stays what it is.
    await expect(createBranch('p1', 'main')).resolves.toMatchObject({ failure: { kind: 'http', status: 409 } })
  })
})

describe('the routes whose answer nobody reads', () => {
  it.each([
    ['a 204 with no body', { status: 204, body: '' }],
    ['a 200 with an empty object', { status: 200, body: '{}' }],
    ['a 200 with a real envelope', { status: 200, body: JSON.stringify({ statusCode: 200, data: {} }) }],
  ])('treats %s as success', async (_label, response) => {
    request.mockResolvedValueOnce(response)

    await expect(dropStash('p1', 's1')).resolves.toEqual({ ok: true, data: null })
  })

  it('still reports a real failure on those routes', async () => {
    request.mockResolvedValueOnce({ status: 403, body: '{}' })

    await expect(discardChanges('p1')).resolves.toMatchObject({ ok: false, failure: { status: 403 } })
  })
})


describe('merging', () => {
  it('asks for the three-way diff with both branches named', async () => {
    request.mockResolvedValueOnce(ok({ source: {}, target: {}, base: null, conflicts: [] }))

    await getBranchDiffWithBase('p1', 'feature', 'main')

    expect(callArgs().path).toBe('/projects/p1/branches-diff-with-base?source=feature&target=main')
  })

  it('encodes branch names that need it', async () => {
    request.mockResolvedValueOnce(ok({ conflicts: [] }))

    await getBranchDiffWithBase('p1', 'feat/edge 602', 'main')

    expect(callArgs().path).toContain('source=feat%2Fedge+602')
  })

  it('posts the merge with both branches and the message', async () => {
    request.mockResolvedValueOnce(ok({ message: 'Merged', mergeCommit: { hash: 'abc' } }))

    await mergeBranches({
      projectId: 'p1',
      sourceBranch: 'feature',
      targetBranch: 'main',
      commitMessage: 'Merge feature',
    })

    expect(callArgs()).toMatchObject({
      path: '/projects/p1/branches/merge',
      init: { method: 'POST', json: { sourceBranch: 'feature', targetBranch: 'main', commitMessage: 'Merge feature' } },
    })
  })

  it('omits the message and resolutions when there are none', async () => {
    request.mockResolvedValueOnce(ok({ message: 'Merged' }))

    await mergeBranches({ projectId: 'p1', sourceBranch: 'feature', targetBranch: 'main' })

    const json = callArgs().init.json as Record<string, unknown>
    expect(json).toEqual({ sourceBranch: 'feature', targetBranch: 'main' })
  })

  it('sends resolutions when the user decided per file', async () => {
    request.mockResolvedValueOnce(ok({ message: 'Merged' }))

    await mergeBranches({
      projectId: 'p1',
      sourceBranch: 'feature',
      targetBranch: 'main',
      resolutions: { 'pous/programs/main.st': 'x := TRUE;' },
    })

    expect((callArgs().init.json as { resolutions: Record<string, string> }).resolutions).toEqual({
      'pous/programs/main.st': 'x := TRUE;',
    })
  })

  it('names a conflict as its own kind, with the files', async () => {
    request.mockResolvedValueOnce({
      status: 409,
      // Top level, like the carry rejection — the same place the web adapter reads it.
      body: JSON.stringify({
        hasConflicts: true,
        conflictedFiles: ['pous/programs/main.st'],
        message: 'Merge conflicts detected',
      }),
    })

    await expect(
      mergeBranches({ projectId: 'p1', sourceBranch: 'feature', targetBranch: 'main' }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'merge-conflict',
        conflictedFiles: ['pous/programs/main.st'],
        message: 'Merge conflicts detected',
      },
    })
  })

  it('treats a 409 without hasConflicts as an ordinary failure', async () => {
    request.mockResolvedValueOnce({ status: 409, body: JSON.stringify({ message: 'Nothing to merge' }) })

    // Otherwise the resolver opens with an empty file list.
    await expect(
      mergeBranches({ projectId: 'p1', sourceBranch: 'feature', targetBranch: 'main' }),
    ).resolves.toMatchObject({ failure: { kind: 'http', status: 409 } })
  })

  it('does NOT report a merge as failed when the server never answered', async () => {
    request.mockRejectedValueOnce(new Error('ECONNRESET'))

    // A merge writes a commit. An unanswered POST may well have made one, so calling it a
    // failure invites the user to merge the same branch twice.
    await expect(
      mergeBranches({ projectId: 'p1', sourceBranch: 'feature', targetBranch: 'main' }),
    ).resolves.toMatchObject({ failure: { kind: 'unreachable' } })
  })
})
