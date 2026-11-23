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
