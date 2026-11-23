import {
  createRuntimeTokenManager,
  type RuntimeCredentials,
  type TokenLoginResult,
  type TokenLoginTransport,
} from '../runtime-token-manager'

const OLD = { username: 'op', password: 'old-pass' }

/** A runtime that accepts exactly the account's current password, which the test can change. */
function makeRuntime(initialPassword: string) {
  const state = { password: initialPassword, deleted: false, issued: 0, logins: [] as RuntimeCredentials[] }
  const transport: TokenLoginTransport = {
    login(credentials) {
      state.logins.push({ ...credentials })
      if (state.deleted || credentials.password !== state.password) {
        return Promise.resolve<TokenLoginResult>({
          success: false,
          error: 'Wrong username or password',
          statusCode: 401,
        })
      }
      state.issued += 1
      return Promise.resolve<TokenLoginResult>({ success: true, token: `tok-${state.issued}` })
    },
  }
  return { state, transport }
}

describe('RuntimeTokenManager session end', () => {
  it('ends the session and forgets the credentials when the runtime refuses the re-sign-in (401)', async () => {
    const { state, transport } = makeRuntime(OLD.password)
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)
    let ended = 0
    m.onSessionEnded(() => {
      ended += 1
    })

    state.deleted = true
    expect(await m.refresh()).toBe(false)

    expect(ended).toBe(1)
    expect(m.hasToken()).toBe(false)
    expect(m.getUsername()).toBeNull()
    expect(await m.refresh()).toBe(false)
    expect(state.logins).toHaveLength(1)
  })

  it('does not end the session when the re-sign-in fails for another reason', async () => {
    const transport: TokenLoginTransport = {
      login: () => Promise.resolve({ success: false, error: 'Too many failed attempts', statusCode: 429 }),
    }
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)
    let ended = 0
    m.onSessionEnded(() => {
      ended += 1
    })
    expect(await m.refresh()).toBe(false)
    expect(ended).toBe(0)
    expect(m.getUsername()).toBe('op')
  })

  it('does not end the session on a transport failure', async () => {
    const transport: TokenLoginTransport = { login: () => Promise.reject(new Error('ECONNRESET')) }
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)
    let ended = 0
    m.onSessionEnded(() => {
      ended += 1
    })
    expect(await m.refresh()).toBe(false)
    expect(ended).toBe(0)
    expect(m.hasToken()).toBe(true)
  })

  it('stops notifying after unsubscribe', async () => {
    const { state, transport } = makeRuntime(OLD.password)
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)
    let ended = 0
    const unsubscribe = m.onSessionEnded(() => {
      ended += 1
    })
    unsubscribe()
    state.deleted = true
    await m.refresh()
    expect(ended).toBe(0)
  })
})

describe('RuntimeTokenManager own password change', () => {
  it('adopts the new password and signs in again with it after the change', async () => {
    const { state, transport } = makeRuntime(OLD.password)
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)
    const tokens: string[] = []
    m.onTokenChanged((t) => tokens.push(t))

    const params = { password: 'new-pass', currentPassword: 'old-pass' }
    const result = await m.changeOwnCredentials(
      params,
      () => {
        state.password = 'new-pass'
        return Promise.resolve({ success: true })
      },
      (r) => r.success,
    )

    expect(result).toEqual({ success: true })
    expect(state.logins).toEqual([{ username: 'op', password: 'new-pass' }])
    expect(m.getToken()).toBe('tok-1')
    expect(tokens).toEqual(['tok-1'])

    // A later re-sign-in uses the new password too.
    expect(await m.refresh()).toBe(true)
    expect(state.logins[1]).toEqual({ username: 'op', password: 'new-pass' })
  })

  it('lets a re-sign-in that runs during the change succeed with the new password, without ending the session', async () => {
    const { state, transport } = makeRuntime(OLD.password)
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)
    let ended = 0
    m.onSessionEnded(() => {
      ended += 1
    })

    await m.changeOwnCredentials(
      { password: 'new-pass' },
      async () => {
        state.password = 'new-pass'
        // A status poll hits 401 after the runtime ended the sessions but before the change returned.
        expect(await m.refresh()).toBe(true)
        return { success: true }
      },
      (r) => r.success,
    )

    expect(ended).toBe(0)
    expect(m.hasToken()).toBe(true)
    expect(state.logins.map((c) => c.password)).toEqual(['new-pass', 'new-pass'])
  })

  it('falls back to the current password when a re-sign-in runs before the change took effect', async () => {
    const { state, transport } = makeRuntime(OLD.password)
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)
    let ended = 0
    m.onSessionEnded(() => {
      ended += 1
    })

    await m.changeOwnCredentials(
      { password: 'new-pass' },
      async () => {
        expect(await m.refresh()).toBe(true)
        expect(m.getToken()).toBe('tok-1')
        state.password = 'new-pass'
        return { success: true }
      },
      (r) => r.success,
    )

    expect(ended).toBe(0)
    expect(state.logins.map((c) => c.password)).toEqual(['new-pass', 'old-pass', 'new-pass'])
    expect(m.getToken()).toBe('tok-2')
  })

  it('keeps the old credentials when the change fails', async () => {
    const { state, transport } = makeRuntime(OLD.password)
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)

    const result = await m.changeOwnCredentials(
      { password: 'new-pass' },
      () => Promise.resolve({ success: false, error: 'Current password is incorrect' }),
      (r) => r.success,
    )

    expect(result.success).toBe(false)
    expect(state.logins).toEqual([])
    expect(await m.refresh()).toBe(true)
    expect(state.logins).toEqual([OLD])
  })

  it('adopts a new username without signing in again', async () => {
    const { state, transport } = makeRuntime(OLD.password)
    const m = createRuntimeTokenManager(transport)
    m.setSession('tok-0', OLD)

    await m.changeOwnCredentials(
      { username: 'op2' },
      () => Promise.resolve({ success: true }),
      (r) => r.success,
    )

    expect(state.logins).toEqual([])
    expect(m.getUsername()).toBe('op2')
    expect(m.getToken()).toBe('tok-0')
  })
})
