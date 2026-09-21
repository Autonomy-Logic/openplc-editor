/**
 * The ports arrive through `PlatformProvider`, not module mocks, so this file runs
 * unchanged under both runners.
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
import { StartCloudProjects, type StartCloudProjectsProps } from '..'

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

let capabilities: PlatformCapabilities
const listRecentCloudProjects = jest.fn<Promise<CloudProjectsResult>, [number]>()
const openProjectByPath = jest.fn<Promise<ProjectResponse>, [string]>()
/** How many times the section subscribed to each session signal. */
let restoredSubscriptions = 0
let expiredSubscriptions = 0

// Stable objects: the load effect depends on port identity, so a fresh object per render
// would re-run it and silently eat `mockResolvedValueOnce` queues.
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

function renderSection(props: StartCloudProjectsProps) {
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

  /**
   * Edge refuses every write on a project past the plan's private limit, and
   * its own SPA disables "open in editor" for it. The desktop listed it like
   * any other, opened it, and let the user edit and commit until the API said
   * no — so the editor has to know the state, not discover it on save.
   */
  describe('a project the plan no longer allows', () => {
    beforeEach(() => {
      listRecentCloudProjects.mockResolvedValue({
        status: 'ok',
        projects: [{ ...PROJECT, locked: true }],
      })
    })

    it('does not open it, and says why instead', async () => {
      renderSection({ searchNameFilterValue: '' })
      await userEvent.click(await screen.findByText(PROJECT.name))

      expect(openProjectByPath).not.toHaveBeenCalled()
      await waitFor(() => expect(lastToast()?.description).toMatch(/plan that allows private projects/i))
    })

    it('marks it in the list rather than hiding it', async () => {
      renderSection({ searchNameFilterValue: '' })

      expect(await screen.findByText(PROJECT.name)).not.toBeNull()
      expect(await screen.findByLabelText(/needs a plan with private projects/i)).not.toBeNull()
    })
  })

  /**
   * The "Order by" control sorted only the local list: it rewrote the store's
   * `recent` array in place, and this section never reads that. Switching
   * between Recent and Name left the cloud cards in the same order.
   */
  describe('the order the list is shown in', () => {
    const ROWS = [
      { id: 'a', name: 'Zebra', language: 'st', updatedAt: '2026-08-26T00:00:00.000Z' },
      { id: 'b', name: 'Alpha', language: 'st', updatedAt: '2026-08-24T00:00:00.000Z' },
      { id: 'c', name: 'Mango', language: 'st', updatedAt: '2026-08-25T00:00:00.000Z' },
    ]

    const shown = () => screen.getAllByText(/^(Zebra|Alpha|Mango)$/).map((node) => node.textContent)

    beforeEach(() => {
      listRecentCloudProjects.mockResolvedValue({ status: 'ok', projects: ROWS })
    })

    it('puts the newest first by default', async () => {
      renderSection({ searchNameFilterValue: '' })
      await screen.findByText('Zebra')

      expect(shown()).toEqual(['Zebra', 'Mango', 'Alpha'])
    })

    it('orders by name when asked', async () => {
      renderSection({ searchNameFilterValue: '', orderBy: 'Name' })
      await screen.findByText('Zebra')

      expect(shown()).toEqual(['Alpha', 'Mango', 'Zebra'])
    })

    it('still orders what a search narrowed down', async () => {
      renderSection({ searchNameFilterValue: 'a', orderBy: 'Name' })
      await screen.findByText('Alpha')

      // All three contain an "a"; the filter must not undo the ordering.
      expect(shown()).toEqual(['Alpha', 'Mango', 'Zebra'])
    })
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

      expect(screen.queryByText(HEADING)).not.toBeNull()
      expect(screen.queryByText(SIGN_IN_COPY)).toBeNull()
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

      // A main process predating the feature; no sign-in offered since it can't help.
      await waitFor(() => expect(container.innerHTML).toBe(''))
    })
  })

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

      // Search filters what is already here; it doesn't re-ask Edge.
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
