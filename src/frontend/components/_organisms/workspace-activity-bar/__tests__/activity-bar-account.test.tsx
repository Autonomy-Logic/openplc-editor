/**
 * The Edge account slot at the foot of the activity bar.
 *
 * NOTHING IS MODULE-MOCKED. The bar reads the platform through `PlatformProvider`, so
 * the account arrives as a fake port and the real hook, menu and sign-in dialog run on
 * top of it; the rest of the bar renders against stub ports and the real store. That is
 * what lets one file run unchanged under both runners, whose module-mock hoisting
 * differs.
 */

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

/**
 * An Edge account that answers `/auth/me` with whatever it is told to, and counts
 * how often it was asked. `null` means the read never comes back — the in-flight case.
 *
 * Present here so the account menu and the sign-in gate are reachable; a platform
 * without an Edge account supplies no port, and the bar renders neither.
 */
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

/**
 * The footer the exit arrow sits in — the element whose bottom padding follows the
 * account slot. Two levels up: the arrow is wrapped by its tooltip trigger.
 */
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

  // It belongs at the foot of the bar, under the exit arrow — the account is a
  // destination, not one of the tools above the divider.
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

  // A slow /auth/me must not flash a sign-in prompt at someone already signed in.
  it('shows neither while the session is still being read', async () => {
    const account = fakeAccount(null)

    renderBar(account.port)
    await firstReadOf(account)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', ACCOUNT_MENU)).toBeNull()
  })

  // The autonomy-node build shares this component but points at its own API,
  // where Edge's account endpoints do not exist.
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

      // An idle hook never asks who is signed in.
      expect(account.reads()).toBe(0)
    })

    /**
     * The exit arrow is an EXISTING control, and on a build with no account slot it
     * is still the last thing in the bar. Making room below it for a menu that build
     * never renders moved it ~28px down the activity bar — a visible change to
     * something the account work was not supposed to touch.
     */
    it('leaves the exit arrow where it already sat', () => {
      renderBar(fakeAccount({ status: 'no-session' }).port)

      expect(footerOf(screen.getByLabelText('Exit')).classList.contains('pb-10')).toBe(true)
    })
  })

  /**
   * The desktop editor: it has an Edge account, for cloud projects, but opens local
   * projects from disk and works offline. Same component, same slot, same dialog —
   * the only difference is that nothing is forced on someone who never asked.
   */
  describe('builds that have an account but do not require one', () => {
    beforeEach(() => {
      capabilities = { ...capabilities, requiresEdgeAccount: false, isNativeApplication: true }
    })

    it('offers the way in instead of imposing it', async () => {
      renderBar(fakeAccount({ status: 'no-session' }).port)

      expect(await screen.findByLabelText(SIGN_IN_LABEL)).not.toBeNull()
      // The editor stays usable: no dialog until it is asked for.
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

    // The slot is occupied either way, so the foot keeps its tighter gap and the exit
    // arrow does not move when someone signs in or out.
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

  // The other side of it: where the account DOES render, it is the last thing in
  // the bar and takes the smaller gap it was designed with.
  it('tightens the foot of the bar when the account sits there', async () => {
    renderBar(fakeAccount({ status: 'signed-in', user: USER }).port)
    await screen.findByRole('button', ACCOUNT_MENU)

    expect(footerOf(screen.getByLabelText('Exit')).classList.contains('pb-3')).toBe(true)
  })

  // Not gated on being signed in: that would move the exit arrow on every sign-in
  // and again on every sign-out.
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
