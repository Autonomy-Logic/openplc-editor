/**
 * The start-screen account.
 *
 * The guarantee worth pinning down is the one that differs from the activity bar: this
 * dialog NEVER opens on its own, on either build. The activity bar opens it unprompted
 * where `requiresEdgeAccount` is set, and that is right there — a project was asked for
 * and could not be reached. Here nothing has been asked for, and forcing a login onto
 * the screen a user lands on would block an editor that is usable without an account.
 *
 * The component is byte-identical in openplc-editor (the shared surface is compared
 * file by file), so this covers the desktop's copy too.
 *
 * NOTHING IS MODULE-MOCKED. The section reads the platform through `PlatformProvider`,
 * so the account arrives as a fake port and the real hook, menu and dialog run on top
 * of it — the same way they do in the app. That is what lets one file run unchanged
 * under both runners, whose module-mock hoisting differs.
 */

import { describe, expect, it } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { EdgeAccountPort, EdgeUserRead } from '../../../../../../middleware/shared/ports/edge-account-port'
import {
  EDITOR_CAPABILITIES,
  type PlatformCapabilities,
} from '../../../../../../middleware/shared/ports/platform-capabilities'
import { PlatformProvider } from '../../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../../middleware/shared/providers/types'
import { StartAccountSection } from '..'

const USER = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', username: 'ada' }

/** A port whose every method answers `undefined` — for the ports nothing here reads. */
function stubPort<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_, prop) => (typeof prop === 'string' ? () => undefined : undefined),
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

/**
 * An Edge account that answers `/auth/me` with whatever it is told to, and counts
 * how often it was asked. `null` means the read never comes back — the in-flight case.
 */
function fakeAccount(read: EdgeUserRead | null, session: { expired: boolean } = { expired: false }) {
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
      isExpired: () => session.expired,
      // An expiry that was a real session dying, not a 401 on a session that never was.
      isAbsent: () => !session.expired,
      onExpired: () => () => undefined,
      onRestored: () => () => undefined,
      markRestored: () => undefined,
    },
  }

  return { port, reads: () => reads }
}

function renderSection({
  account,
  capabilities = {},
}: {
  account: EdgeAccountPort | undefined
  capabilities?: Partial<PlatformCapabilities>
}) {
  const ports = makePorts({
    edgeAccount: account,
    capabilities: { ...EDITOR_CAPABILITIES, hasEdgeAccount: true, requiresEdgeAccount: false, ...capabilities },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports}>{children}</PlatformProvider>
  )

  return render(<StartAccountSection />, { wrapper })
}

const SIGN_IN_LABEL = 'Sign in to Autonomy Edge'

describe('StartAccountSection', () => {
  it('offers a way in without opening anything', async () => {
    renderSection({ account: fakeAccount({ status: 'no-session' }).port })

    expect(await screen.findByLabelText(SIGN_IN_LABEL)).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the dialog when asked', async () => {
    renderSection({ account: fakeAccount({ status: 'no-session' }).port })

    await userEvent.click(await screen.findByLabelText(SIGN_IN_LABEL))

    expect(await screen.findByRole('dialog')).not.toBeNull()
  })

  /**
   * The whole point of this component existing separately from the activity bar's
   * slot. On the web, `requiresEdgeAccount` is true and the activity bar opens the
   * dialog unprompted — but the start screen is reached with no project asked for, so
   * forcing a login there would block a screen that works without one.
   */
  it('still does not open by itself where an account is required', async () => {
    renderSection({
      account: fakeAccount({ status: 'no-session' }).port,
      capabilities: { requiresEdgeAccount: true },
    })

    expect(await screen.findByLabelText(SIGN_IN_LABEL)).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the same dropdown and the name once signed in', async () => {
    renderSection({ account: fakeAccount({ status: 'signed-in', user: USER }).port })

    expect(await screen.findByRole('button', { name: /account: ada lovelace/i })).not.toBeNull()
    expect(screen.queryByText('Ada Lovelace')).not.toBeNull()
    expect(screen.queryByLabelText(SIGN_IN_LABEL)).toBeNull()
  })

  // Someone whose session died under them is not being welcomed.
  it('names an expiry rather than greeting the user', async () => {
    renderSection({ account: fakeAccount({ status: 'no-session' }, { expired: true }).port })

    expect(await screen.findByText('Session ended')).not.toBeNull()
  })

  it('renders nothing while the first read is in flight', async () => {
    const account = fakeAccount(null)

    const { container } = renderSection({ account: account.port })

    // The read went out and has not come back: nothing on screen. A row that appears
    // and then vanishes is worse than a beat of nothing.
    await waitFor(() => expect(account.reads()).toBe(1))
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing on a build with no Edge account', async () => {
    const account = fakeAccount({ status: 'no-session' })

    const { container } = renderSection({ account: account.port, capabilities: { hasEdgeAccount: false } })

    expect(container.innerHTML).toBe('')
    // And it tells the hook to stay idle rather than polling an API that has no
    // account endpoints — the autonomy-node build. An idle hook never asks.
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(account.reads()).toBe(0)
  })

  it('renders nothing when the platform supplies no account port', () => {
    const { container } = renderSection({ account: undefined })

    expect(container.innerHTML).toBe('')
  })
})
