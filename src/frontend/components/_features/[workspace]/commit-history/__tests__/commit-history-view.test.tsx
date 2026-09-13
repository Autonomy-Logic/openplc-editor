/**
 * The commit's full-file view.
 *
 * This component is byte-identical in openplc-editor — it is on the compared shared
 * surface — so this file covers the desktop's screen too. That is the point of it having
 * been extracted: the desktop reached this feature through a route it does not have, and
 * the fix was one screen for both products rather than a second implementation.
 *
 * What is worth protecting here is the status column. A/M/D drive what the user believes
 * changed in a commit, and the interesting case is the fourth one: a graphical file whose
 * BYTES differ while its program does not. Older commits captured transient canvas state
 * (selection, drag positions), so a byte comparison alone marks half a project as modified
 * and buries the real change. The semantic diff is what keeps that honest.
 *
 * NOTHING IS MODULE-MOCKED. The version-control and theme ports arrive through
 * `PlatformProvider`; the panels, the restore modal and the diff pane are the real ones.
 * Monaco never comes up — its loader has nothing to fetch here — so the diff pane is
 * observed by the header it puts over the file. That is what lets one file run unchanged
 * under both runners, whose module-mock hoisting differs.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../../../middleware/shared/ports/platform-capabilities'
import type { ThemePort } from '../../../../../../middleware/shared/ports/theme-port'
import type {
  Commit,
  CommitFile,
  CommitInfo,
  GraphicalDiffResult,
  VersionControlPort,
} from '../../../../../../middleware/shared/ports/version-control-port'
import { PlatformProvider } from '../../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../../middleware/shared/providers/types'
import { CommitHistoryView } from '..'

/**
 * A port whose every method answers `undefined`, except the ones handed in. For the
 * ports nothing here reads, and for the ones that only need a method or three.
 */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function makePorts(overrides: Partial<PlatformPorts>): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
    ...overrides,
  }
}

type CommitFiles = { files: CommitFile[]; parentFiles: CommitFile[]; commit: CommitInfo }

const getCommitFiles = jest.fn<Promise<CommitFiles>, [string, string]>()
const restoreCommit = jest.fn<Promise<{ message: string; restoredCommit: Commit }>, [string, string]>()
const computeGraphicalDiff = jest.fn<GraphicalDiffResult, [string, string, string]>()

const versionControl = stubPort<VersionControlPort>({ getCommitFiles, restoreCommit, computeGraphicalDiff })
const theme = stubPort<ThemePort>({ getCurrentTheme: () => 'light' })
const ports = makePorts({ versionControl, theme })

const COMMIT = {
  hash: 'abc1234567',
  shortHash: 'abc1234',
  message: 'Initial commit',
  author: 'me',
  timestamp: '2026-07-31T00:00:00.000Z',
}

/** A semantic diff with nothing but the fields the status column reads. */
function graphicalDiff(changedIndexes: number[]): GraphicalDiffResult {
  return {
    flows: [],
    changedIndexes,
    variableDiff: [],
    nodeDiffMaps: { original: new Map(), current: new Map() },
    edgeDiffMaps: [],
    isLadder: true,
  }
}

const onBack = jest.fn<void, []>()
const onRestored = jest.fn<void, []>()

function renderView(initialFile?: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports}>{children}</PlatformProvider>
  )

  return render(
    <CommitHistoryView
      projectId='p1'
      commitHash='abc1234567'
      initialFile={initialFile}
      onBack={onBack}
      onRestored={onRestored}
    />,
    { wrapper },
  )
}

/** The confirm button inside the restore modal, told apart from the header's own Restore. */
function confirmRestoreButton(): HTMLElement {
  const card = screen.getByText('Restore to This Version?').parentElement

  if (!card) {
    throw new Error('restore modal rendered with no card')
  }

  return within(card).getByRole('button', { name: 'Restore' })
}

beforeEach(() => {
  getCommitFiles.mockReset()
  restoreCommit.mockReset()
  computeGraphicalDiff.mockReset()
  onBack.mockReset()
  onRestored.mockReset()
  computeGraphicalDiff.mockReturnValue(graphicalDiff([1]))
  getCommitFiles.mockResolvedValue({ commit: COMMIT, files: [], parentFiles: [] })
})

describe('the file list', () => {
  it('marks a file the commit introduced as added', async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [{ path: 'pous/programs/main.st', content: 'x := TRUE;' }],
      parentFiles: [],
    })

    renderView()

    expect(await screen.findByText('main.st')).not.toBeNull()
    expect(screen.queryByTitle('Added')).not.toBeNull()
  })

  it('marks a changed file as modified', async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [{ path: 'a.st', content: 'after' }],
      parentFiles: [{ path: 'a.st', content: 'before' }],
    })

    renderView()

    expect(await screen.findByTitle('Modified')).not.toBeNull()
  })

  it('lists a file the commit removed as deleted', async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [],
      parentFiles: [{ path: 'gone.st', content: 'was here' }],
    })

    renderView()

    // Present in the parent and absent now: the tree has to show it, because a deletion
    // is a change the reviewer needs to see.
    expect(await screen.findByText('gone.st')).not.toBeNull()
    expect(screen.queryByTitle('Deleted')).not.toBeNull()
  })

  it('hides a file whose bytes changed but whose program did not', async () => {
    // Transient canvas state — selection, drag positions — leaked into older commits.
    computeGraphicalDiff.mockReturnValue(graphicalDiff([]))
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [
        { path: 'pous/main.ld', content: '{"selected":true}' },
        { path: 'real.st', content: 'after' },
      ],
      parentFiles: [
        { path: 'pous/main.ld', content: '{"selected":false}' },
        { path: 'real.st', content: 'before' },
      ],
    })

    renderView()

    await screen.findByText('real.st')
    // Otherwise a commit that touched one file claims to have touched the whole project.
    expect(screen.queryByText('main.ld')).toBeNull()
    expect(screen.queryByText('1 file')).not.toBeNull()
  })

  it('still shows a graphical file whose program really did change', async () => {
    computeGraphicalDiff.mockReturnValue(graphicalDiff([2]))
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [{ path: 'pous/main.ld', content: 'b' }],
      parentFiles: [{ path: 'pous/main.ld', content: 'a' }],
    })

    renderView()

    expect(await screen.findByText('main.ld')).not.toBeNull()
  })

  it("keeps infrastructure files out of the user's view", async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [{ path: 'a.st', content: 'x' }],
      parentFiles: [{ path: 'git-data.tar.gz', content: 'blob' }],
    })

    renderView()

    // The migration's leftover archive shows up as a deletion. Nobody would recognise it.
    await screen.findByText('a.st')
    expect(screen.queryByText('git-data.tar.gz')).toBeNull()
  })

  it('narrows the list by the search box, and says so', async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [
        { path: 'pous/alpha.st', content: 'a' },
        { path: 'pous/beta.st', content: 'b' },
      ],
      parentFiles: [],
    })

    renderView()
    await screen.findByText('alpha.st')

    // Focused by hand rather than clicked: in this environment every element sits at
    // (0,0), so a click there lands inside the resize handle's hit area and the panel
    // library swallows it before the box gets focus. The typing itself is real.
    const box = screen.getByPlaceholderText('Search files...')
    box.focus()
    await userEvent.type(box, 'alpha', { skipClick: true })

    expect(screen.queryByText('beta.st')).toBeNull()
    expect(screen.queryByText('1 of 2 files')).not.toBeNull()
  })
})

describe('the diff pane', () => {
  it('shows nothing until a file is chosen', async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [{ path: 'a.st', content: 'x' }],
      parentFiles: [],
    })

    renderView()

    expect(await screen.findByText('Select a file to view the diff')).not.toBeNull()
  })

  it('opens straight onto the file the panel was clicked from', async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [{ path: 'pous/programs/main.st', content: 'x' }],
      parentFiles: [],
    })

    // The whole reason `initialFile` exists: clicking a file in the source-control panel
    // should land on that file's diff, not on an empty pane.
    renderView('pous/programs/main.st')

    // The pane names the file it is diffing — the tree only ever shows the leaf.
    expect(await screen.findByText('pous/programs/main.st')).not.toBeNull()
    expect(screen.queryByText('Select a file to view the diff')).toBeNull()
  })

  it('shows the diff for a file picked from the tree', async () => {
    getCommitFiles.mockResolvedValueOnce({
      commit: COMMIT,
      files: [{ path: 'pous/a.st', content: 'x' }],
      parentFiles: [],
    })

    renderView()
    await userEvent.click(await screen.findByText('a.st'))

    expect(screen.queryByText('pous/a.st')).not.toBeNull()
    expect(screen.queryByText('Select a file to view the diff')).toBeNull()
  })
})

describe('the header', () => {
  it('identifies the commit being read', async () => {
    renderView()

    expect(await screen.findByText('Initial commit')).not.toBeNull()
    expect(screen.queryByText('abc1234')).not.toBeNull()
  })

  it('leaves through the host, not through a URL', async () => {
    renderView()
    await screen.findByText('Initial commit')

    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    // The desktop has no router to navigate; the host decides what leaving means.
    expect(onBack).toHaveBeenCalled()
  })

  it('tells the host to reload after a restore', async () => {
    restoreCommit.mockResolvedValueOnce({
      message: 'restored',
      restoredCommit: { ...COMMIT, id: 'c1', parentHash: null },
    })
    renderView()
    await screen.findByText('Initial commit')

    await userEvent.click(screen.getByRole('button', { name: /restore/i }))
    await userEvent.click(confirmRestoreButton())

    expect(restoreCommit).toHaveBeenCalledWith('p1', 'abc1234567')
    // A restore rewrote the working tree, so what the editor holds is stale. Leaving the
    // user on it would have them editing a copy that no longer exists.
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
  })

  it('does not claim success when the restore failed', async () => {
    restoreCommit.mockRejectedValueOnce(new Error('403'))
    renderView()
    await screen.findByText('Initial commit')

    await userEvent.click(screen.getByRole('button', { name: /restore/i }))
    await userEvent.click(confirmRestoreButton())

    await waitFor(() => expect(restoreCommit).toHaveBeenCalled())
    // Said inside the modal the reader is still looking at, rather than swallowed.
    expect(await screen.findByText('403')).not.toBeNull()
    expect(onRestored).not.toHaveBeenCalled()
  })
})

describe('while it cannot show anything', () => {
  it('says it is loading rather than showing an empty tree', () => {
    getCommitFiles.mockReturnValueOnce(new Promise(() => undefined))

    renderView()

    expect(screen.queryByText('Loading commit files...')).not.toBeNull()
  })

  it('offers a way out when the commit cannot be read', async () => {
    getCommitFiles.mockRejectedValueOnce(new Error('unreachable'))

    renderView()

    expect(await screen.findByText('Failed to load commit files')).not.toBeNull()
    await userEvent.click(screen.getByText('Back to workspace'))
    expect(onBack).toHaveBeenCalled()
  })
})
