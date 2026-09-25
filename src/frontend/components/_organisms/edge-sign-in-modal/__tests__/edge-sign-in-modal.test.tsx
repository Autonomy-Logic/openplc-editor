/** The sign-in dialog's exits: a password sign-in it ran itself, and a provider sign-in that finished somewhere else. */

import { describe, expect, it, jest } from '@jest/globals'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EdgeAccountPort } from '../../../../../middleware/shared/ports/edge-account-port'
import { EdgeSignInModal } from '..'

/** A port whose restoration listeners the test fires by hand, standing in for the main process's IPC event. */
function fakeAccount() {
  const restoredListeners = new Set<() => void>()
  const restore = () => {
    for (const listener of [...restoredListeners]) {
      listener()
    }
  }

  const port: EdgeAccountPort = {
    frontendBaseUrl: 'https://edge.example.com',
    oauthProviders: [],
    oauthUrl: () => '',
    fetchUser: () => Promise.resolve({ status: 'no-session' }),
    fetchPlanCaption: () => Promise.resolve(null),
    // Like the real adapters: a successful password sign-in announces the restoration before resolving.
    signIn: () => {
      restore()
      return Promise.resolve({
        status: 'signed-in',
        user: { id: 'u1', name: 'Ada', email: 'ada@example.com', username: 'ada' },
      })
    },
    signOut: () => Promise.resolve(),
    session: {
      isExpired: () => true,
      isAbsent: () => true,
      onExpired: () => () => undefined,
      onRestored: (listener) => {
        restoredListeners.add(listener)
        return () => {
          restoredListeners.delete(listener)
        }
      },
      markRestored: () => undefined,
    },
  }

  return { port, restore, listenerCount: () => restoredListeners.size }
}

describe('EdgeSignInModal', () => {
  it('closes when a provider sign-in restores the session while it is open', () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)

    act(() => account.restore())

    expect(onSignedIn).toHaveBeenCalledTimes(1)
  })

  it('ignores a restoration while closed', () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    render(<EdgeSignInModal open={false} onSignedIn={onSignedIn} account={account.port} />)

    act(() => account.restore())

    expect(account.listenerCount()).toBe(0)
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('reports a password sign-in once, although it also restores the session', async () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)

    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    expect(onSignedIn).toHaveBeenCalledTimes(1)
  })

  it('reports again after being reopened', () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    const { rerender } = render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)
    act(() => account.restore())

    rerender(<EdgeSignInModal open={false} onSignedIn={onSignedIn} account={account.port} />)
    rerender(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)
    act(() => account.restore())

    expect(onSignedIn).toHaveBeenCalledTimes(2)
  })
})
