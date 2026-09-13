import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { EdgeAccountMenu } from '..'

/** Where Edge lives, now handed in as a prop instead of read from the environment. */
const EDGE_BASE = 'https://edge.example.com'

const USER = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  username: 'ada',
  initialsColor: '#123456',
}

/** A sign-out callback that only counts. Enough for every assertion here. */
function signOutCounter() {
  let calls = 0

  return { onSignOut: () => void (calls += 1), count: () => calls }
}

async function openMenu() {
  await userEvent.setup().click(screen.getByRole('button', { name: /account: ada lovelace/i }))
}

describe('EdgeAccountMenu', () => {
  it('shows the account avatar as the trigger', () => {
    render(<EdgeAccountMenu edgeBaseUrl={EDGE_BASE} user={USER} onSignOut={signOutCounter().onSignOut} />)

    expect(screen.queryByRole('button', { name: /account: ada lovelace/i })).not.toBeNull()
  })

  it('shows the name once opened', async () => {
    render(<EdgeAccountMenu edgeBaseUrl={EDGE_BASE} user={USER} onSignOut={signOutCounter().onSignOut} />)
    await openMenu()

    expect(await screen.findByText('Ada Lovelace')).not.toBeNull()
  })

  // Every destination lives in Edge; the editor links out rather than rebuilding
  // them, and points at the same routes Edge's own dropdown navigates to.
  it('links to the dashboard, profile and settings on Edge', async () => {
    render(<EdgeAccountMenu edgeBaseUrl={EDGE_BASE} user={USER} onSignOut={signOutCounter().onSignOut} />)
    await openMenu()

    expect((await screen.findByRole('menuitem', { name: 'Dashboard' })).getAttribute('href')).toBe(
      'https://edge.example.com/dashboard',
    )
    // `/profile`, not `/{username}` — the latter is the public profile page.
    expect(screen.getByRole('menuitem', { name: 'Profile' }).getAttribute('href')).toBe(
      'https://edge.example.com/profile',
    )
    expect(screen.getByRole('menuitem', { name: 'Settings' }).getAttribute('href')).toBe(
      'https://edge.example.com/profile/settings',
    )
  })

  // Edge's pattern leads with a card naming the account rather than an action, and
  // captions it with the plan.
  it('heads the menu with the account, username and plan', async () => {
    render(
      <EdgeAccountMenu
        edgeBaseUrl={EDGE_BASE}
        user={USER}
        planCaption='Pro Plan'
        onSignOut={signOutCounter().onSignOut}
      />,
    )
    await openMenu()

    expect(await screen.findByText('Ada Lovelace')).not.toBeNull()
    expect(screen.queryByText('(ada)')).not.toBeNull()
    expect(screen.queryByText('Pro Plan')).not.toBeNull()
  })

  // No active subscription is a valid state; Edge omits the caption rather than
  // inventing one, and an empty line would read as a rendering fault.
  it('omits the caption when the plan is unknown', async () => {
    render(
      <EdgeAccountMenu edgeBaseUrl={EDGE_BASE} user={USER} planCaption={null} onSignOut={signOutCounter().onSignOut} />,
    )
    await openMenu()

    expect(await screen.findByText('Ada Lovelace')).not.toBeNull()
    expect(screen.queryByText(/plan/i)).toBeNull()
  })

  // Signing out here ends the one session both apps share — that is why the menu
  // is in the editor at all.
  it('calls back on sign out', async () => {
    const signOut = signOutCounter()
    render(<EdgeAccountMenu edgeBaseUrl={EDGE_BASE} user={USER} onSignOut={signOut.onSignOut} />)
    await openMenu()

    await userEvent.setup().click(await screen.findByRole('menuitem', { name: /sign out/i }))

    expect(signOut.count()).toBe(1)
  })

  /**
   * The start-screen menu passes the name into the trigger so the WHOLE row opens the
   * dropdown. Leaving the name outside it meant a user clicking the obvious target —
   * their own name, right beside the avatar — got nothing, and had to find the 20px
   * photo to reach Sign out.
   */
  describe('with a label in the trigger', () => {
    it('opens from a click on the label, not just the avatar', async () => {
      const signOut = signOutCounter()

      render(
        <EdgeAccountMenu
          edgeBaseUrl={EDGE_BASE}
          user={USER}
          onSignOut={signOut.onSignOut}
          label={<span>Ada Lovelace</span>}
          triggerClassName='w-48'
        />,
      )

      // The label is inside the trigger, so this is a click on the row.
      await userEvent.setup().click(screen.getByText('Ada Lovelace'))

      // Reaching Sign out is the point of opening it at all.
      await userEvent.setup().click(await screen.findByRole('menuitem', { name: /sign out/i }))
      expect(signOut.count()).toBe(1)
    })

    it('applies the caller geometry to the trigger', () => {
      render(
        <EdgeAccountMenu
          edgeBaseUrl={EDGE_BASE}
          user={USER}
          onSignOut={signOutCounter().onSignOut}
          triggerClassName='w-48 rounded-md'
        />,
      )

      const trigger = screen.getByRole('button', { name: /account: ada lovelace/i })

      expect(trigger.classList.contains('w-48')).toBe(true)
      // `cn` merges, so the caller's radius replaces the default `rounded-full`
      // instead of fighting it.
      expect(trigger.classList.contains('rounded-md')).toBe(true)
      expect(trigger.classList.contains('rounded-full')).toBe(false)
    })
  })

  it('keeps the trigger keyboard-focusable', () => {
    render(<EdgeAccountMenu edgeBaseUrl={EDGE_BASE} user={USER} onSignOut={signOutCounter().onSignOut} />)

    const trigger = screen.getByRole('button', { name: /account: ada lovelace/i })
    trigger.focus()

    expect(document.activeElement).toBe(trigger)
  })
})
