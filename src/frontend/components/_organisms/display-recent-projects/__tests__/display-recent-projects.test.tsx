import { beforeEach, describe, expect, it } from '@jest/globals'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { EdgeAccountPort, EdgeUserRead } from '../../../../../middleware/shared/ports/edge-account-port'
import { EDITOR_CAPABILITIES } from '../../../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../../../middleware/shared/ports/project-port'
import { PlatformProvider } from '../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../middleware/shared/providers/types'
import { openPLCStoreBase } from '../../../../store'
import { dispatch, getMemoryState } from '../../../../utils/toast'
import DisplayRecentProjects from '..'

const RECENT = [
  {
    name: 'Irrigation',
    path: '/Users/me/Projects/irrigation',
    lastOpenedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
]

const USER = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', username: 'ada' }

/** A port whose every method answers `undefined`, except the ones handed in. */
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

/** An Edge account whose `fetchUser` answers `read`, or never resolves when `read` is null. */
function fakeAccount(read: EdgeUserRead | null) {
  let reads = 0

  const port: EdgeAccountPort = {
    frontendBaseUrl: 'https://edge.example.com',
    oauthProviders: [],
    oauthUrl: () => '',
    fetchUser: () => {
      reads += 1
      return read ? Promise.resolve(read) : new Promise(() => undefined)
    },
    fetchPlanCaption: () => Promise.resolve(null),
    signIn: () => Promise.resolve({ status: 'failed' }),
    signOut: () => Promise.resolve(),
    session: {
      isExpired: () => false,
      isAbsent: () => true,
      onExpired: () => () => undefined,
      onRestored: () => () => undefined,
      markRestored: () => undefined,
    },
  }

  /** Resolves once the first read has gone out and its answer has been applied. */
  const settled = async () => {
    await waitFor(() => expect(reads).toBe(1))
    await act(async () => {
      await Promise.resolve()
    })
  }

  return { port, settled }
}

/** The project port, with the publish dialog's two calls answered and the list's three idle. */
const projectPort = stubPort<ProjectPort>({
  listCloudFolders: () => Promise.resolve({ status: 'ok', folders: [{ id: 'root', name: 'Root (/)', depth: 0 }] }),
  uploadProjectToCloud: () => Promise.resolve({ status: 'ok', projectId: 'new-project-id', uploadedFiles: 3 }),
  removeRecentProject: () => Promise.resolve({ success: true }),
  getRecentProjects: () => Promise.resolve([]),
  openProjectByPath: () => Promise.resolve({ success: false }),
})

function renderList(account: EdgeAccountPort, props: { onProjectUploaded?: () => void } = {}) {
  const ports = makePorts({
    capabilities: { ...EDITOR_CAPABILITIES, hasEdgeAccount: true },
    project: projectPort,
    edgeAccount: account,
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports}>{children}</PlatformProvider>
  )

  return render(<DisplayRecentProjects searchNameFilterValue='' {...props} />, { wrapper })
}

const lastToast = () => getMemoryState().toasts[0]

beforeEach(() => {
  openPLCStoreBase.getState().workspaceActions.setRecent(RECENT)
  dispatch({ type: 'REMOVE_TOAST' })
})

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Project actions' }))
}

/** Through the real dialog: wait for its folders, then press Upload. */
async function finishUpload() {
  await screen.findByRole('radio', { name: /Root/ })
  await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
}

describe('the publish entry', () => {
  it('is offered to someone signed in', async () => {
    renderList(fakeAccount({ status: 'signed-in', user: USER }).port)
    await openMenu()

    expect(await screen.findByText('Upload to Cloud')).not.toBeNull()
  })

  it('is not offered to someone who is not', async () => {
    const account = fakeAccount({ status: 'no-session' })

    renderList(account.port)
    await account.settled()
    await openMenu()

    // A menu entry that only exists to say "sign in first" is worse than no entry.
    expect(screen.queryByText('Upload to Cloud')).toBeNull()
    // The entries that manage the local copy are unaffected by any of this.
    expect(screen.queryByText('Remove from list')).not.toBeNull()
  })

  it('is not offered while the account is still being read', async () => {
    const account = fakeAccount(null)

    renderList(account.port)
    await account.settled()
    await openMenu()

    // Better to appear a beat late than to flicker in and out under the cursor.
    expect(screen.queryByText('Remove from list')).not.toBeNull()
    expect(screen.queryByText('Upload to Cloud')).toBeNull()
  })
})

describe('after a project is published', () => {
  it('tells the screen above, so the cloud list re-reads', async () => {
    let announced = 0

    renderList(fakeAccount({ status: 'signed-in', user: USER }).port, {
      onProjectUploaded: () => void (announced += 1),
    })
    await openMenu()
    await userEvent.click(await screen.findByText('Upload to Cloud'))
    await finishUpload()

    // The cloud list is a sibling section that cannot see this happen on its own.
    await waitFor(() => expect(announced).toBe(1))
  })

  it('says the local copy is untouched, because that is the worry', async () => {
    renderList(fakeAccount({ status: 'signed-in', user: USER }).port)
    await openMenu()
    await userEvent.click(await screen.findByText('Upload to Cloud'))
    await finishUpload()

    await waitFor(() => expect(lastToast()?.description).toContain('unchanged'))
  })

  it('closes the dialog', async () => {
    renderList(fakeAccount({ status: 'signed-in', user: USER }).port)
    await openMenu()
    await userEvent.click(await screen.findByText('Upload to Cloud'))
    await finishUpload()

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('works for a caller that does not care to be told', async () => {
    renderList(fakeAccount({ status: 'signed-in', user: USER }).port)
    await openMenu()
    await userEvent.click(await screen.findByText('Upload to Cloud'))

    // Optional: the callback is a courtesy to the screen, not a requirement of the list.
    await expect(finishUpload()).resolves.toBeUndefined()
    await waitFor(() => expect(lastToast()?.title).toBe('Uploaded to Autonomy Edge'))
  })
})
