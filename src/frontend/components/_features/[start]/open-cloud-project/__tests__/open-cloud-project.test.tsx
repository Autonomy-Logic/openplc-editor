/**
 * The Open → Autonomy Edge dialog: browse the folder tree, pick a project, open it.
 *
 * Driven through `PlatformProvider` with stub ports and the real store, like the
 * start-screen tests, so the file runs unchanged under jest and vitest.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { EdgeAccountPort } from '../../../../../../middleware/shared/ports/edge-account-port'
import { EDITOR_CAPABILITIES } from '../../../../../../middleware/shared/ports/platform-capabilities'
import type {
  CloudFoldersResult,
  CloudProjectsResult,
  ProjectPort,
  ProjectResponse,
} from '../../../../../../middleware/shared/ports/project-port'
import { PlatformProvider } from '../../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../../middleware/shared/providers/types'
import { getMemoryState } from '../../../../../utils/toast'
import { OpenCloudProjectModal } from '..'

/** A port whose every method answers `undefined`, except the ones handed in. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const FOLDERS: CloudFoldersResult = {
  status: 'ok',
  folders: [
    { id: 'root', name: 'Root (/)', depth: 0 },
    { id: 'machines', name: 'Machines', depth: 1 },
  ],
}

/** What each folder holds; the locked one sits in `Machines`. */
const PROJECTS_BY_FOLDER: Record<string, CloudProjectsResult> = {
  root: {
    status: 'ok',
    projects: [{ id: 'p-pump', name: 'Pump Station', language: 'st', updatedAt: '2026-08-24T10:00:00.000Z' }],
  },
  machines: {
    status: 'ok',
    projects: [
      { id: 'p-press', name: 'Press Line', language: 'ld', updatedAt: '2026-08-20T10:00:00.000Z', locked: true },
    ],
  },
}

let foldersAnswer: CloudFoldersResult = FOLDERS
/** Every project id the dialog tried to open, in order. */
const openedIds: string[] = []
let openAnswer: ProjectResponse = { success: false, error: { title: 'x', description: 'Autonomy Edge answered 500.' } }

const projectPort = stubPort<ProjectPort>({
  listCloudFolders: () => Promise.resolve(foldersAnswer),
  listCloudProjectsInFolder: (folderId: string) =>
    Promise.resolve(PROJECTS_BY_FOLDER[folderId] ?? { status: 'ok', projects: [] }),
  openProjectByPath: (id: string) => {
    openedIds.push(id)
    return Promise.resolve(openAnswer)
  },
})

const accountPort: EdgeAccountPort = {
  frontendBaseUrl: 'https://edge.example.com',
  oauthProviders: [],
  oauthUrl: () => '',
  fetchUser: () => Promise.resolve({ status: 'no-session' }),
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

function makePorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: projectPort,
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    edgeAccount: accountPort,
    capabilities: { ...EDITOR_CAPABILITIES, hasEdgeAccount: true },
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider ports={makePorts()}>{children}</PlatformProvider>
}

const lastToast = () => getMemoryState().toasts[0]

/** How many times the dialog asked to close itself. */
let closeRequests = 0

function renderDialog() {
  return render(<OpenCloudProjectModal open onOpenChange={(open) => void (open || (closeRequests += 1))} />, {
    wrapper: Wrapper,
  })
}

beforeEach(() => {
  foldersAnswer = FOLDERS
  openedIds.length = 0
  closeRequests = 0
  openAnswer = { success: false, error: { title: 'x', description: 'Autonomy Edge answered 500.' } }
})

describe('browsing', () => {
  it('shows the folder tree and lands on the root', async () => {
    renderDialog()

    expect(await screen.findByRole('button', { name: /Root \(\/\)/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /Machines/ })).not.toBeNull()
    // The root's project is what shows first, without a click.
    expect(await screen.findByText('Pump Station')).not.toBeNull()
  })

  it("lists the chosen folder's projects when a folder is clicked", async () => {
    renderDialog()
    await screen.findByText('Pump Station')

    await userEvent.click(screen.getByRole('button', { name: /Machines/ }))

    expect(await screen.findByText('Press Line')).not.toBeNull()
    expect(screen.queryByText('Pump Station')).toBeNull()
  })

  it('offers a sign-in when there is no session', async () => {
    foldersAnswer = { status: 'signed-out' }
    renderDialog()

    expect(await screen.findByRole('button', { name: 'Sign in' })).not.toBeNull()
  })
})

describe('opening', () => {
  it('opens through the same call the start-screen cards use', async () => {
    renderDialog()

    await userEvent.click(await screen.findByText('Pump Station'))

    await waitFor(() => expect(openedIds).toEqual(['p-pump']))
  })

  it('reports a failed open with the reason the adapter gave', async () => {
    renderDialog()

    await userEvent.click(await screen.findByText('Pump Station'))

    await waitFor(() => expect(lastToast()?.description).toBe('Autonomy Edge answered 500.'))
    expect(closeRequests).toBe(0)
  })

  /**
   * A project over the plan's private limit is refused here, with Edge's own
   * words, rather than opened into a session where every save would bounce.
   */
  it('refuses a locked project and does not try to open it', async () => {
    renderDialog()
    await screen.findByText('Pump Station')
    await userEvent.click(screen.getByRole('button', { name: /Machines/ }))

    await userEvent.click(await screen.findByText('Press Line'))

    expect(openedIds).toEqual([])
    await waitFor(() => expect(lastToast()?.description).toMatch(/plan that allows private projects/i))
  })
})
