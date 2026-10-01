/** The Edge account slot at the foot of the activity bar, exercised through `PlatformProvider` with a fake account port rather than module mocks. */

import { beforeEach, describe, expect, it } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { EdgeAccountPort, EdgeUserRead } from '../../../../../middleware/shared/ports/edge-account-port'
import {
  EDITOR_CAPABILITIES,
  type PlatformCapabilities,
} from '../../../../../middleware/shared/ports/platform-capabilities'
import { PlatformProvider } from '../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../middleware/shared/providers/types'
import { WorkspaceActivityBar } from '..'

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

/** Answers `/auth/me` with whatever it's told and counts reads; `null` means the read never resolves (in-flight). */
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

  return { port, reads: () => reads }
}

let capabilities: PlatformCapabilities

function renderBar(account: EdgeAccountPort) {
  const ports = makePorts({ capabilities, edgeAccount: account })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports}>{children}</PlatformProvider>
  )

  return render(<WorkspaceActivityBar />, { wrapper })
}

const SIGN_IN_LABEL = 'Sign in to Autonomy Edge'
const ACCOUNT_MENU = { name: /account: ada lovelace/i }

/** Waits for the account's first read to have gone out — the point at which `loading` is real. */
async function firstReadOf(account: ReturnType<typeof fakeAccount>) {
  await waitFor(() => expect(account.reads()).toBe(1))
}

/** The footer the exit arrow sits in, two levels up since the arrow is wrapped by its tooltip trigger. */
function footerOf(exitButton: HTMLElement): HTMLElement {
  const footer = exitButton.parentElement?.parentElement

  if (!footer) {
    throw new Error('exit button rendered with no footer')
  }

  return footer
}

/** True when `later` comes after `earlier` in document order. */
function follows(earlier: Element, later: Element): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('WorkspaceActivityBar — Edge account', () => {
  beforeEach(() => {
    capabilities = {
      ...EDITOR_CAPABILITIES,
      hasEdgeAccount: true,
      requiresEdgeAccount: true,
      isNativeApplication: false,
    }
  })

  it('shows the account menu when signed in', async () => {
    renderBar(fakeAccount({ status: 'signed-in', user: USER }).port)

    expect(await screen.findByRole('button', ACCOUNT_MENU)).not.toBeNull()
  })

  it('places the account below the exit arrow', async () => {
    renderBar(fakeAccount({ status: 'signed-in', user: USER }).port)

    const menu = await screen.findByRole('button', ACCOUNT_MENU)

    expect(follows(screen.getByLabelText('Exit'), menu)).toBe(true)
  })

  it('shows the sign-in gate when the session is gone', async () => {
    renderBar(fakeAccount({ status: 'no-session' }).port)

    expect(await screen.findByRole('dialog')).not.toBeNull()
    expect(screen.queryByRole('button', ACCOUNT_MENU)).toBeNull()
  })

  it('shows neither while the session is still being read', async () => {
    const account = fakeAccount(null)

    renderBar(account.port)
    await firstReadOf(account)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', ACCOUNT_MENU)).toBeNull()
  })

  describe('builds without an Edge account', () => {
    beforeEach(() => {
      capabilities = { ...capabilities, hasEdgeAccount: false }
    })

    it('renders no account UI', () => {
      renderBar(fakeAccount({ status: 'no-session' }).port)

      expect(screen.queryByRole('button', ACCOUNT_MENU)).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('tells the account hook to stay idle', () => {
      const account = fakeAccount({ status: 'no-session' })

      renderBar(account.port)

      expect(account.reads()).toBe(0)
    })

    it('leaves the exit arrow where it already sat', () => {
      renderBar(fakeAccount({ status: 'no-session' }).port)

      expect(footerOf(screen.getByLabelText('Exit')).classList.contains('pb-10')).toBe(true)
    })
  })

  describe('builds that have an account but do not require one', () => {
    beforeEach(() => {
      capabilities = { ...capabilities, requiresEdgeAccount: false, isNativeApplication: true }
    })

    it('offers the way in instead of imposing it', async () => {
      renderBar(fakeAccount({ status: 'no-session' }).port)

      expect(await screen.findByLabelText(SIGN_IN_LABEL)).not.toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('opens the same dialog when asked', async () => {
      renderBar(fakeAccount({ status: 'no-session' }).port)

      await userEvent.click(await screen.findByLabelText(SIGN_IN_LABEL))

      expect(await screen.findByRole('dialog')).not.toBeNull()
    })

    it('puts that control in the same slot the menu uses', async () => {
      renderBar(fakeAccount({ status: 'no-session' }).port)

      const signIn = await screen.findByLabelText(SIGN_IN_LABEL)

      expect(follows(screen.getByLabelText('Exit'), signIn)).toBe(true)
    })

    it('keeps the account menu once signed in', async () => {
      renderBar(fakeAccount({ status: 'signed-in', user: USER }).port)

      expect(await screen.findByRole('button', ACCOUNT_MENU)).not.toBeNull()
      expect(screen.queryByLabelText(SIGN_IN_LABEL)).toBeNull()
    })

    it('does not move the exit arrow between signed in and out', async () => {
      const signedOut = renderBar(fakeAccount({ status: 'no-session' }).port)
      await screen.findByLabelText(SIGN_IN_LABEL)
      expect(footerOf(signedOut.getByLabelText('Exit')).classList.contains('pb-3')).toBe(true)
      signedOut.unmount()

      const signedIn = renderBar(fakeAccount({ status: 'signed-in', user: USER }).port)
      await screen.findByRole('button', ACCOUNT_MENU)
      expect(footerOf(signedIn.getByLabelText('Exit')).classList.contains('pb-3')).toBe(true)
    })
  })

  it('tightens the foot of the bar when the account sits there', async () => {
    renderBar(fakeAccount({ status: 'signed-in', user: USER }).port)
    await screen.findByRole('button', ACCOUNT_MENU)

    expect(footerOf(screen.getByLabelText('Exit')).classList.contains('pb-3')).toBe(true)
  })

  it('does not move the exit arrow when the user signs out', async () => {
    renderBar(fakeAccount({ status: 'no-session' }).port)
    await screen.findByRole('dialog')

    expect(footerOf(screen.getByLabelText('Exit')).classList.contains('pb-3')).toBe(true)
  })

  it('keeps the exit button regardless of the account state', async () => {
    renderBar(fakeAccount({ status: 'no-session' }).port)
    await screen.findByRole('dialog')

    expect(screen.queryByLabelText('Exit')).not.toBeNull()
  })
})
