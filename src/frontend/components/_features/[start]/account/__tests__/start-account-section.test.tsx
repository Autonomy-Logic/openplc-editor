/**
 * The section is exercised through `PlatformProvider` with a fake port, not module
 * mocks, so this file runs unchanged under both runners.
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

/** A fake Edge account port; `read: null` never resolves, simulating the in-flight case. */
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

    await waitFor(() => expect(account.reads()).toBe(1))
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing on a build with no Edge account', async () => {
    const account = fakeAccount({ status: 'no-session' })

    const { container } = renderSection({ account: account.port, capabilities: { hasEdgeAccount: false } })

    expect(container.innerHTML).toBe('')
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(account.reads()).toBe(0)
  })

  it('renders nothing when the platform supplies no account port', () => {
    const { container } = renderSection({ account: undefined })

    expect(container.innerHTML).toBe('')
  })
})
