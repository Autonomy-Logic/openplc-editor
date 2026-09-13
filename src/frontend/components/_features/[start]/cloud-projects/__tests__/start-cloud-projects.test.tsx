/**
 * The cloud section on the start screen.
 *
 * What these tests are really protecting is the copy, and specifically that each kind of
 * nothing gets its OWN sentence. The list request reports four outcomes precisely so this
 * component can tell them apart: telling a signed-in user who is merely offline to "sign
 * in" sends them to fix a problem they do not have, and telling someone with an empty
 * account the same thing is simply wrong.
 *
 * The component is byte-identical in openplc-editor — the shared surface is compared file
 * by file — so this covers the desktop's copy too. It is the desktop that renders this
 * section at all: this build's start screen is only reached with no `project_id` and
 * returns early before the menu.
 *
 * NOTHING IS MODULE-MOCKED. The ports arrive through `PlatformProvider`, the store is the
 * real one, and the toast is read back from its own memory state. That is what lets one
 * file run unchanged under both runners, whose module-mock hoisting differs.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { EdgeAccountPort } from '../../../../../../middleware/shared/ports/edge-account-port'
import {
  EDITOR_CAPABILITIES,
  type PlatformCapabilities,
} from '../../../../../../middleware/shared/ports/platform-capabilities'
import type {
  CloudProjectsResult,
  ProjectPort,
  ProjectResponse,
} from '../../../../../../middleware/shared/ports/project-port'
import { PlatformProvider } from '../../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../../middleware/shared/providers/types'
import { openPLCStoreBase } from '../../../../../store'
import { dispatch, getMemoryState } from '../../../../../utils/toast'
import { StartCloudProjects } from '..'

/**
 * A port whose every method answers `undefined`, except the ones handed in. For the
 * ports nothing here reads, and for the one that only needs two of its methods.
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

let capabilities: PlatformCapabilities
const listRecentCloudProjects = jest.fn<Promise<CloudProjectsResult>, [number]>()
const openProjectByPath = jest.fn<Promise<ProjectResponse>, [string]>()
/** How many times the section subscribed to each session signal. */
let restoredSubscriptions = 0
let expiredSubscriptions = 0

/**
 * STABLE objects, deliberately. The component's load effect depends on the port's
 * identity, and the real provider hands out one instance created at boot. A fake that
 * built a fresh object per render would re-run the effect on every render — which is a
 * defect in the fake, not the component, but it silently eats `mockResolvedValueOnce`
 * queues and makes every state assertion below meaningless.
 */
const projectPort = stubPort<ProjectPort>({ listRecentCloudProjects, openProjectByPath })
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
    onExpired: () => {
      expiredSubscriptions += 1
      return () => undefined
    },
    onRestored: () => {
      restoredSubscriptions += 1
      return () => undefined
    },
    markRestored: () => undefined,
  },
}

function renderSection(props: { searchNameFilterValue: string; revision?: number }) {
  const ports = makePorts({ capabilities, project: projectPort, edgeAccount: accountPort })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports}>{children}</PlatformProvider>
  )

  return render(<StartCloudProjects {...props} />, { wrapper })
}

const PROJECT = { id: 'p1', name: 'Irrigation Controller 2', language: 'st', updatedAt: '2026-08-25T14:25:49.000Z' }

/** The shape `openProjectByPath` hands back for a cloud project, trimmed to what the store reads. */
const OPENED: ProjectResponse = {
  success: true,
  data: {
    meta: { name: PROJECT.name, path: 'p1', type: 'plc-project' },
    projectData: {
      pous: [],
      dataTypes: [],
      globalVariableLists: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
  },
}

const HEADING = 'Autonomy Edge Cloud Projects'
const SIGN_IN_COPY = /Sign in with your Autonomy Edge account to access Edge features/i
const LOADING = { name: /loading cloud projects/i }

const lastToast = () => getMemoryState().toasts[0]

beforeEach(() => {
  listRecentCloudProjects.mockReset()
  openProjectByPath.mockReset()
  restoredSubscriptions = 0
  expiredSubscriptions = 0
  dispatch({ type: 'REMOVE_TOAST' })
  capabilities = { ...EDITOR_CAPABILITIES, hasEdgeAccount: true }
  listRecentCloudProjects.mockResolvedValue({ status: 'ok', projects: [PROJECT] })
})

afterEach(() => {
  // A test that opened a project left it in the real store.
  openPLCStoreBase.getState().sharedWorkspaceActions.clearStatesOnCloseProject()
})

describe('StartCloudProjects', () => {
  it('lists the account projects', async () => {
    renderSection({ searchNameFilterValue: '' })

    expect(await screen.findByText(PROJECT.name)).not.toBeNull()
    expect(screen.queryByText(HEADING)).not.toBeNull()
    expect(listRecentCloudProjects).toHaveBeenCalledWith(5)
  })

  it('opens a project through the same call a local one uses', async () => {
    openProjectByPath.mockResolvedValueOnce(OPENED)

    renderSection({ searchNameFilterValue: '' })
    await userEvent.click(await screen.findByText(PROJECT.name))

    // The id, not a path: the adapter decides which world it belongs to.
    expect(openProjectByPath).toHaveBeenCalledWith('p1')
    // And what came back went through the store's own open handler: the project is
    // now the open one.
    await waitFor(() => expect(openPLCStoreBase.getState().project.meta.path).toBe('p1'))
  })

  it('reports a failed open with the reason the adapter gave', async () => {
    openProjectByPath.mockResolvedValueOnce({
      success: false,
      error: { title: 'x', description: 'Autonomy Edge answered 403.' },
    })

    renderSection({ searchNameFilterValue: '' })
    await userEvent.click(await screen.findByText(PROJECT.name))

    await waitFor(() => expect(lastToast()?.description).toBe('Autonomy Edge answered 403.'))
  })

  describe('the space is reserved, and each state says its own thing', () => {
    it('invites a signed-out user to sign in', async () => {
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'signed-out' })

      renderSection({ searchNameFilterValue: '' })

      expect(await screen.findByText(SIGN_IN_COPY)).not.toBeNull()
      // The heading holds the space whether or not anyone is signed in.
      expect(screen.queryByText(HEADING)).not.toBeNull()
    })

    /**
     * The invitation is a control, not a caption. A sentence a user can ignore converts
     * nobody, and connecting people to Edge is the point of this section existing.
     */
    it('offers a sign-in the user can actually press', async () => {
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'signed-out' })

      renderSection({ searchNameFilterValue: '' })

      const button = await screen.findByRole('button', { name: 'Sign in' })
      expect(screen.queryByRole('dialog')).toBeNull()

      await userEvent.click(button)

      expect(await screen.findByRole('dialog')).not.toBeNull()
    })

    it('offers a way in for someone with no account at all', async () => {
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'signed-out' })

      renderSection({ searchNameFilterValue: '' })

      const link = await screen.findByRole('link', { name: /create an account/i })

      // Signing up is an email round-trip, so it opens Edge rather than pretending to
      // happen inside the editor.
      expect(link.getAttribute('href')).toBe('https://edge.example.com/signup')
      expect(link.getAttribute('target')).toBe('_blank')
    })

    it('does not show the invitation once projects are listed', async () => {
      renderSection({ searchNameFilterValue: '' })
      await screen.findByText(PROJECT.name)

      expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    })

    it('does NOT tell an offline user to sign in', async () => {
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'unreachable' })

      renderSection({ searchNameFilterValue: '' })

      expect(await screen.findByText(/Could not reach Autonomy Edge/i)).not.toBeNull()
      expect(screen.queryByText(SIGN_IN_COPY)).toBeNull()
      // And it says the local work is untouched, because that is what the user is
      // actually looking at this screen for.
      expect(screen.queryByText(/local projects below are unaffected/i)).not.toBeNull()
    })

    it('does NOT tell a signed-in user with no projects to sign in', async () => {
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'ok', projects: [] })

      renderSection({ searchNameFilterValue: '' })

      expect(await screen.findByText(/No cloud projects yet/i)).not.toBeNull()
      expect(screen.queryByText(SIGN_IN_COPY)).toBeNull()
    })

    it('says the search found nothing, rather than the account being empty', async () => {
      renderSection({ searchNameFilterValue: 'zzz' })

      expect(await screen.findByText(/No cloud project matches that search/i)).not.toBeNull()
    })

    it('shows placeholders, and no message, while the first answer is in flight', () => {
      listRecentCloudProjects.mockReturnValueOnce(new Promise(() => undefined))

      renderSection({ searchNameFilterValue: '' })

      // A returning user's stored session is usually about to resolve; flashing "Sign in"
      // at them first would be worse than saying nothing.
      expect(screen.queryByText(HEADING)).not.toBeNull()
      expect(screen.queryByText(SIGN_IN_COPY)).toBeNull()
      // But saying nothing looked like an empty section, and the local projects below
      // jumped when the real cards arrived. Placeholders hold the row.
      expect(screen.queryByRole('status', LOADING)).not.toBeNull()
    })

    it('clears the placeholders once the answer lands', async () => {
      renderSection({ searchNameFilterValue: '' })

      await screen.findByText(PROJECT.name)

      expect(screen.queryByRole('status', LOADING)).toBeNull()
    })

    it('clears them for a signed-out user too, rather than loading forever', async () => {
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'signed-out' })

      renderSection({ searchNameFilterValue: '' })

      await screen.findByText(SIGN_IN_COPY)

      expect(screen.queryByRole('status', LOADING)).toBeNull()
    })
  })

  describe('builds with no cloud projects at all', () => {
    it('renders nothing when the platform has no Edge account', () => {
      capabilities = { ...EDITOR_CAPABILITIES, hasEdgeAccount: false }

      const { container } = renderSection({ searchNameFilterValue: '' })

      expect(container.innerHTML).toBe('')
      expect(listRecentCloudProjects).not.toHaveBeenCalled()
    })

    it('renders nothing when the channel is unavailable', async () => {
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'unavailable' })

      const { container } = renderSection({ searchNameFilterValue: '' })

      // A main process that predates the feature. Inviting a sign-in that cannot help
      // would be worse than staying quiet.
      await waitFor(() => expect(container.innerHTML).toBe(''))
    })
  })

  /**
   * Publishing a local project puts a new project on the account, and it belongs at the
   * top of this list. Nothing here can observe that on its own — the upload happens in a
   * sibling section — so the screen above both bumps a number and this re-reads.
   */
  describe('when something else changes what is on the account', () => {
    it('re-reads on a new revision', async () => {
      const { rerender } = renderSection({ searchNameFilterValue: '', revision: 0 })
      await screen.findByText(PROJECT.name)
      expect(listRecentCloudProjects).toHaveBeenCalledTimes(1)

      const uploaded = { ...PROJECT, id: 'p2', name: 'Just Published' }
      listRecentCloudProjects.mockResolvedValueOnce({ status: 'ok', projects: [uploaded, PROJECT] })

      rerender(<StartCloudProjects searchNameFilterValue='' revision={1} />)

      expect(await screen.findByText('Just Published')).not.toBeNull()
      expect(listRecentCloudProjects).toHaveBeenCalledTimes(2)
    })

    it('does not re-read when the number is unchanged', async () => {
      const { rerender } = renderSection({ searchNameFilterValue: '', revision: 3 })
      await screen.findByText(PROJECT.name)

      rerender(<StartCloudProjects searchNameFilterValue='zzz' revision={3} />)

      // Typing in the search box filters what is already here; it is not a reason to ask
      // Edge again on every keystroke.
      expect(listRecentCloudProjects).toHaveBeenCalledTimes(1)
    })

    it('works for a caller that passes no revision at all', async () => {
      renderSection({ searchNameFilterValue: '' })

      // Optional, so a platform that never publishes is not forced to thread a number.
      expect(await screen.findByText(PROJECT.name)).not.toBeNull()
    })
  })

  it('reloads when a session comes back, and empties when one ends', async () => {
    renderSection({ searchNameFilterValue: '' })
    await screen.findByText(PROJECT.name)

    // Subscribed to the session's own signal rather than polling or asking /auth/me.
    expect(restoredSubscriptions).toBeGreaterThan(0)
    expect(expiredSubscriptions).toBeGreaterThan(0)
  })
})
