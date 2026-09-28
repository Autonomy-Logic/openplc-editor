/** The sign-in dialog's exits: a password sign-in it ran itself, and a provider sign-in that finished somewhere else. */

import { describe, expect, it, jest } from '@jest/globals'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EdgeAccountPort, EdgeSignInOutcome } from '../../../../../middleware/shared/ports/edge-account-port'
import { EdgeSignInModal } from '..'

const ADA = { id: 'u1', name: 'Ada', email: 'ada@example.com', username: 'ada' }

interface FakeAccountOptions {
  /** Whether a successful password sign-in fires `onRestored`, as the adapters do only for a session announced dead. */
  signInRestores?: boolean
}

/** A port whose restoration listeners the test fires by hand, standing in for the main process's IPC event. */
function fakeAccount({ signInRestores = true }: FakeAccountOptions = {}) {
  const restoredListeners = new Set<() => void>()
  const restore = () => {
    for (const listener of [...restoredListeners]) {
      listener()
    }
  }

  // Answers queue up so a test can hold a sign-in in flight and settle it later.
  const pending: Array<(outcome: EdgeSignInOutcome) => void> = []
  let answerAtOnce = true

  const port: EdgeAccountPort = {
    frontendBaseUrl: 'https://edge.example.com',
    oauthProviders: [],
    oauthUrl: () => '',
    fetchUser: () => Promise.resolve({ status: 'no-session' }),
    fetchPlanCaption: () => Promise.resolve(null),
    // Like the real adapters: a success that restores the session announces it before resolving.
    signIn: () => {
      const settle = (outcome: EdgeSignInOutcome) => {
        if (outcome.status === 'signed-in' && signInRestores) {
          restore()
        }

        return outcome
      }

      if (answerAtOnce) {
        return Promise.resolve(settle({ status: 'signed-in', user: ADA }))
      }

      return new Promise<EdgeSignInOutcome>((resolve) => {
        pending.push((outcome) => resolve(settle(outcome)))
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

  return {
    port,
    restore,
    listenerCount: () => restoredListeners.size,
    holdSignIns: () => {
      answerAtOnce = false
    },
    settleSignIn: (outcome: EdgeSignInOutcome) => pending.shift()?.(outcome),
  }
}

async function submitPassword() {
  await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))
}

describe('EdgeSignInModal', () => {
  it('closes when a provider sign-in restores the session while it is open', () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)

    act(() => account.restore())

    expect(onSignedIn).toHaveBeenCalledTimes(1)
    expect(onSignedIn).toHaveBeenCalledWith({ sessionRestored: true })
  })

  it('ignores a restoration while closed', () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    render(<EdgeSignInModal open={false} onSignedIn={onSignedIn} account={account.port} />)

    act(() => account.restore())

    expect(account.listenerCount()).toBe(0)
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('reports a password sign-in once, as restored, although it also resolves the submit', async () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)
    await submitPassword()

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    expect(onSignedIn).toHaveBeenCalledTimes(1)
    expect(onSignedIn).toHaveBeenCalledWith({ sessionRestored: true })
  })

  it('reports a password sign-in that restored nothing as unrestored, so the caller re-reads itself', async () => {
    const account = fakeAccount({ signInRestores: false })
    const onSignedIn = jest.fn()

    render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)
    await submitPassword()

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    expect(onSignedIn).toHaveBeenCalledTimes(1)
    expect(onSignedIn).toHaveBeenCalledWith({ sessionRestored: false })
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

  it('keeps a failure from an earlier opening out of the fresh form', async () => {
    const account = fakeAccount()
    const onSignedIn = jest.fn()

    const { rerender } = render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)
    account.holdSignIns()
    await submitPassword()
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeTruthy()

    rerender(<EdgeSignInModal open={false} onSignedIn={onSignedIn} account={account.port} />)
    rerender(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)

    await act(async () => {
      account.settleSignIn({ status: 'invalid-credentials' })
      await Promise.resolve()
    })

    expect(screen.queryByText('Email or password is incorrect.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('still reports a success from an earlier opening: the session is signed in either way', async () => {
    const account = fakeAccount({ signInRestores: false })
    const onSignedIn = jest.fn()

    const { rerender } = render(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)
    account.holdSignIns()
    await submitPassword()

    rerender(<EdgeSignInModal open={false} onSignedIn={onSignedIn} account={account.port} />)
    rerender(<EdgeSignInModal open onSignedIn={onSignedIn} account={account.port} />)

    await act(async () => {
      account.settleSignIn({ status: 'signed-in', user: ADA })
      await Promise.resolve()
    })

    expect(onSignedIn).toHaveBeenCalledTimes(1)
    expect(onSignedIn).toHaveBeenCalledWith({ sessionRestored: false })
  })
})
