/**
 * The assistant's sign-in gate.
 *
 * What is pinned: a signed-out account shows the gate BEFORE any request is made and
 * keeps the entitlement reads from running; a 401 on a request turns into the same gate
 * and re-reads the account; a build with no Edge account is never gated; and the notice
 * offers a button only where a dialog does not already open by itself.
 */

import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from '@jest/globals'

import type { EdgeAccountPort, EdgeUserRead } from '../../../../../../middleware/shared/ports/edge-account-port'
import { EDITOR_CAPABILITIES, WEB_CAPABILITIES } from '../../../../../../middleware/shared/ports/platform-capabilities'
import { AIChatSignInNotice } from '../ai-chat-sign-in'
import { useAssistantAccess } from '../use-assistant-access'

const ADA = { id: 'u1', name: 'Ada', email: 'ada@example.com', username: 'ada' }

/** An account whose answer can be changed between reads, and which counts them. */
function fakeAccount(initial: EdgeUserRead): {
  port: EdgeAccountPort
  reads: () => number
  answer: (r: EdgeUserRead) => void
} {
  let current = initial
  let reads = 0
  const unreachable = () => {
    throw new Error('the gate must not call this')
  }
  const port: EdgeAccountPort = {
    frontendBaseUrl: 'https://edge.test',
    oauthProviders: [],
    oauthUrl: unreachable,
    fetchUser: () => {
      reads += 1
      return Promise.resolve(current)
    },
    fetchPlanCaption: () => Promise.resolve(null),
    signIn: unreachable,
    signOut: () => Promise.resolve(),
    session: {
      isExpired: () => false,
      isAbsent: () => true,
      onExpired: () => () => undefined,
      onRestored: () => () => undefined,
      markRestored: () => undefined,
    },
  }
  return {
    port,
    reads: () => reads,
    answer: (read) => {
      current = read
    },
  }
}

describe('useAssistantAccess', () => {
  it('never gates a build with no Edge account', () => {
    const { result } = renderHook(() => useAssistantAccess({ ...EDITOR_CAPABILITIES, hasEdgeAccount: false }))

    expect(result.current.needsSignIn).toBe(false)
    expect(result.current.ready).toBe(true)
    expect(result.current.noteRefusal(401)).toBe(false)
  })

  it('shows the gate before any request when the account is signed out', async () => {
    const account = fakeAccount({ status: 'no-session' })
    const { result } = renderHook(() => useAssistantAccess(EDITOR_CAPABILITIES, account.port))

    // Nothing is known yet: neither gated nor ready, so no entitlement read fires.
    expect(result.current.ready).toBe(false)

    await waitFor(() => expect(result.current.needsSignIn).toBe(true))
    expect(result.current.ready).toBe(false)
    expect(result.current.reason).toBe('signed-out')
  })

  it('is ready once the account is known good', async () => {
    const account = fakeAccount({ status: 'signed-in', user: ADA })
    const { result } = renderHook(() => useAssistantAccess(EDITOR_CAPABILITIES, account.port))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.needsSignIn).toBe(false)
  })

  it('turns a refused request into the gate and re-reads the account', async () => {
    const account = fakeAccount({ status: 'signed-in', user: ADA })
    const { result } = renderHook(() => useAssistantAccess(EDITOR_CAPABILITIES, account.port))
    await waitFor(() => expect(result.current.ready).toBe(true))
    const readsBefore = account.reads()

    // The session died server-side: the next account read says so.
    account.answer({ status: 'no-session' })
    let handled = false
    act(() => {
      handled = result.current.noteRefusal(401)
    })

    expect(handled).toBe(true)
    expect(result.current.needsSignIn).toBe(true)
    await waitFor(() => expect(account.reads()).toBeGreaterThan(readsBefore))
    await waitFor(() => expect(result.current.ready).toBe(false))
  })

  it('leaves every other failure alone', async () => {
    const account = fakeAccount({ status: 'signed-in', user: ADA })
    const { result } = renderHook(() => useAssistantAccess(EDITOR_CAPABILITIES, account.port))
    await waitFor(() => expect(result.current.ready).toBe(true))

    let handled = true
    act(() => {
      handled = result.current.noteRefusal(500)
    })

    expect(handled).toBe(false)
    expect(result.current.needsSignIn).toBe(false)
  })

  it('lifts the gate once a sign-in from the panel goes through', async () => {
    const account = fakeAccount({ status: 'no-session' })
    const { result } = renderHook(() => useAssistantAccess(EDITOR_CAPABILITIES, account.port))
    await waitFor(() => expect(result.current.needsSignIn).toBe(true))

    account.answer({ status: 'signed-in', user: ADA })
    act(() => {
      result.current.signedIn()
    })

    await waitFor(() => expect(result.current.needsSignIn).toBe(false))
    expect(result.current.ready).toBe(true)
  })

  it('applies on the web build too, where the account is required', async () => {
    const account = fakeAccount({ status: 'no-session' })
    const { result } = renderHook(() => useAssistantAccess(WEB_CAPABILITIES, account.port))

    await waitFor(() => expect(result.current.needsSignIn).toBe(true))
  })
})

describe('AIChatSignInNotice', () => {
  it('says what to do and offers the way in', () => {
    let opened = 0
    const { getByRole, getByText } = render(
      <AIChatSignInNotice
        reason='signed-out'
        onSignIn={() => {
          opened += 1
        }}
      />,
    )

    getByText('Sign in to Autonomy Edge to use the assistant.')
    fireEvent.click(getByRole('button', { name: 'Sign in' }))
    expect(opened).toBe(1)
  })

  it('tells someone whose session ended what happened, without a second dialog where one opens by itself', () => {
    const { queryByRole, getByText } = render(<AIChatSignInNotice reason='expired' />)

    getByText('Your session ended. Sign in to Autonomy Edge again to keep using the assistant.')
    expect(queryByRole('button')).toBeNull()
  })
})
