import {
  createRuntimeTokenManager,
  isSessionExpiredStatus,
  type RuntimeCredentials,
  type TokenLoginResult,
} from '../runtime-token-manager'

const ADDRESS = '10.0.0.5'
const FIRST_DELAY_S = 5
const MAX_DELAY_S = 300

type Throttle = { failures: number; nextAllowedAt: number }
type Reply = { status: number; msg?: string }

/**
 * A runtime with the sign-in throttle of `webserver/sessions.py`: a refused sign-in counts against the user key and
 * the address key, each key's wait doubles from 5 s to 300 s, a throttled attempt gets 429 and records nothing, and a
 * success clears only the user key. A password change ends every session of the account.
 */
function makeThrottledRuntime(username: string, password: string) {
  const state = {
    password,
    nowS: 0,
    issued: 0,
    validTokens: new Set<string>(),
    throttle: new Map<string, Throttle>(),
    logins: [] as Array<RuntimeCredentials & { status: number }>,
  }

  function keys(name: string): string[] {
    return [`user:${name.trim().toLowerCase()}`, `addr:${ADDRESS}`]
  }

  function waitFor(keyList: string[]): number {
    const waits = keyList.map((k) => (state.throttle.get(k)?.nextAllowedAt ?? 0) - state.nowS).filter((w) => w > 0)
    return waits.length > 0 ? Math.ceil(Math.max(...waits)) : 0
  }

  function recordFailure(keyList: string[]): void {
    for (const key of keyList) {
      const row = state.throttle.get(key) ?? { failures: 0, nextAllowedAt: 0 }
      row.failures += 1
      row.nextAllowedAt = state.nowS + Math.min(FIRST_DELAY_S * 2 ** (row.failures - 1), MAX_DELAY_S)
      state.throttle.set(key, row)
    }
  }

  function issue(): string {
    state.issued += 1
    const fresh = `tok-${state.issued}`
    state.validTokens.add(fresh)
    return fresh
  }

  function login(credentials: RuntimeCredentials): Promise<TokenLoginResult> {
    const keyList = keys(credentials.username)
    const record = (status: number) => state.logins.push({ ...credentials, status })
    if (waitFor(keyList) > 0) {
      record(429)
      return Promise.resolve({ success: false, error: 'Too many failed attempts', statusCode: 429 })
    }
    if (credentials.username !== username || credentials.password !== state.password) {
      recordFailure(keyList)
      record(401)
      return Promise.resolve({ success: false, error: 'Wrong username or password', statusCode: 401 })
    }
    state.throttle.delete(keyList[0])
    record(200)
    return Promise.resolve({ success: true, token: issue() })
  }

  /** PUT /api/update-user for the caller's own account. */
  function updateOwnPassword(token: string, newPassword: string, currentPassword: string): Reply {
    if (!state.validTokens.has(token)) return { status: 401, msg: 'Token has expired' }
    const keyList = keys(username)
    if (waitFor(keyList) > 0) return { status: 429, msg: 'Too many failed attempts' }
    if (currentPassword !== state.password) {
      recordFailure(keyList)
      return { status: 403, msg: 'Current password is incorrect' }
    }
    state.throttle.delete(keyList[0])
    state.password = newPassword
    state.validTokens.clear()
    return { status: 200 }
  }

  /** A permission refusal that leaves the account untouched. */
  function refuse(token: string): Reply {
    if (!state.validTokens.has(token)) return { status: 401, msg: 'Token has expired' }
    return { status: 403, msg: 'Only an admin can change roles' }
  }

  /** GET /api/status. */
  function status(token: string): Reply {
    return state.validTokens.has(token) ? { status: 200 } : { status: 401, msg: 'Token has expired' }
  }

  function expireTokens(): void {
    state.validTokens.clear()
  }

  function addressFailures(): number {
    return state.throttle.get(`addr:${ADDRESS}`)?.failures ?? 0
  }

  return { state, login, issue, updateOwnPassword, refuse, status, expireTokens, addressFailures }
}

type Runtime = ReturnType<typeof makeThrottledRuntime>

const OP = { username: 'op', password: 'old-pass' }

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function connect(rt: Runtime) {
  const m = createRuntimeTokenManager({ login: (c) => rt.login(c) })
  m.setSession(rt.issue(), OP)
  const events = { ended: 0 }
  m.onSessionEnded(() => {
    events.ended += 1
  })
  return { m, events }
}

const unauthorized = (r: Reply) => isSessionExpiredStatus(r.status)
const ok = (r: Reply) => r.status === 200

function failedLogins(rt: Runtime): number {
  return rt.state.logins.filter((l) => l.status !== 200).length
}

describe('runtime throttle model', () => {
  it('doubles each key, answers 429 while throttled, and a success clears only the user key', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    expect((await rt.login({ username: 'op', password: 'bad' })).statusCode).toBe(401)
    expect((await rt.login(OP)).statusCode).toBe(429)
    rt.state.nowS += FIRST_DELAY_S
    expect((await rt.login({ username: 'op', password: 'bad' })).statusCode).toBe(401)
    expect(rt.state.throttle.get('user:op')?.nextAllowedAt).toBe(rt.state.nowS + 2 * FIRST_DELAY_S)
    rt.state.nowS += 2 * FIRST_DELAY_S
    expect((await rt.login(OP)).success).toBe(true)
    expect(rt.state.throttle.has('user:op')).toBe(false)
    expect(rt.addressFailures()).toBe(2)
  })
})

describe('RuntimeTokenManager own-account change against the throttle', () => {
  it('waits for an accepted password change before signing in, and signs in once with the new password', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m, events } = connect(rt)
    const reply = deferred<Reply>()

    const change = m.changeOwnCredentials(
      { password: 'new-pass' },
      async (token) => {
        const r = rt.updateOwnPassword(token, 'new-pass', 'old-pass')
        return reply.promise.then(() => r)
      },
      unauthorized,
      ok,
    )
    await flush()
    // The runtime ended the sessions; a status poll sees 401 before the change returned.
    const poll = m.withAuth((t) => Promise.resolve(rt.status(t)), unauthorized)
    await flush()
    expect(rt.state.logins).toEqual([])

    reply.resolve({ status: 200 })
    expect((await change).status).toBe(200)
    expect((await poll).status).toBe(200)

    expect(rt.state.logins).toEqual([{ username: 'op', password: 'new-pass', status: 200 }])
    expect(failedLogins(rt)).toBe(0)
    expect(events.ended).toBe(0)
    expect(m.hasToken()).toBe(true)
    expect(rt.status(m.getToken() ?? '').status).toBe(200)
    expect(rt.addressFailures()).toBe(0)
  })

  it('keeps the current password in use when the change is refused, without a failed login', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m, events } = connect(rt)
    const reply = deferred<Reply>()

    const change = m.changeOwnCredentials(
      { password: 'new-pass' },
      async (token) => {
        const r = rt.refuse(token)
        return reply.promise.then(() => r)
      },
      unauthorized,
      ok,
    )
    await flush()
    rt.expireTokens()
    const poll = m.withAuth((t) => Promise.resolve(rt.status(t)), unauthorized)
    await flush()
    expect(rt.state.logins).toEqual([])

    reply.resolve({ status: 403 })
    expect((await change).status).toBe(403)
    expect((await poll).status).toBe(200)

    expect(rt.state.logins).toEqual([{ ...OP, status: 200 }])
    expect(events.ended).toBe(0)
    expect(m.getUsername()).toBe('op')
    expect(await m.refresh()).toBe(true)
    expect(rt.state.logins.map((l) => l.password)).toEqual(['old-pass', 'old-pass'])
    expect(failedLogins(rt)).toBe(0)
    expect(rt.addressFailures()).toBe(0)
  })

  it('keeps the current password when the runtime rejects the current password, and makes no login for that 403', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m } = connect(rt)

    const result = await m.changeOwnCredentials(
      { password: 'new-pass' },
      (token) => Promise.resolve(rt.updateOwnPassword(token, 'new-pass', 'wrong')),
      unauthorized,
      ok,
    )

    expect(result).toEqual({ status: 403, msg: 'Current password is incorrect' })
    expect(rt.state.logins).toEqual([])
    expect(rt.state.password).toBe('old-pass')
    rt.expireTokens()
    rt.state.nowS += FIRST_DELAY_S
    expect(await m.refresh()).toBe(true)
    expect(rt.state.logins).toEqual([{ ...OP, status: 200 }])
  })

  it('re-signs in with the current password when the change request itself finds the token expired', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m, events } = connect(rt)
    rt.expireTokens()

    const result = await m.changeOwnCredentials(
      { password: 'new-pass' },
      (token) => Promise.resolve(rt.updateOwnPassword(token, 'new-pass', 'old-pass')),
      unauthorized,
      ok,
    )

    expect(result.status).toBe(200)
    expect(rt.state.logins).toEqual([
      { ...OP, status: 200 },
      { username: 'op', password: 'new-pass', status: 200 },
    ])
    expect(events.ended).toBe(0)
    expect(rt.status(m.getToken() ?? '').status).toBe(200)
  })

  it('shares one sign-in among every refresh requested during the change', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m } = connect(rt)
    const reply = deferred<Reply>()

    const change = m.changeOwnCredentials(
      { password: 'new-pass' },
      async (token) => {
        const r = rt.updateOwnPassword(token, 'new-pass', 'old-pass')
        return reply.promise.then(() => r)
      },
      unauthorized,
      ok,
    )
    await flush()
    const refreshes = [m.refresh(), m.refresh(), m.refresh()]
    await flush()
    expect(rt.state.logins).toEqual([])
    reply.resolve({ status: 200 })
    await change
    expect(await Promise.all(refreshes)).toEqual([true, true, true])
    expect(rt.state.logins).toEqual([{ username: 'op', password: 'new-pass', status: 200 }])
  })

  it('never escalates the address key across repeated changes with expiries and refusals', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m, events } = connect(rt)
    let current = 'old-pass'

    for (let round = 0; round < 8; round += 1) {
      const accept = round % 2 === 0
      const next = `pass-${round}`
      const reply = deferred<Reply>()
      const change = m.changeOwnCredentials(
        { password: next },
        async (token) => {
          const r = accept ? rt.updateOwnPassword(token, next, current) : rt.refuse(token)
          return reply.promise.then(() => r)
        },
        unauthorized,
        ok,
      )
      await flush()
      rt.expireTokens()
      const poll = m.withAuth((t) => Promise.resolve(rt.status(t)), unauthorized)
      await flush()
      reply.resolve({ status: 0 })
      await change
      expect((await poll).status).toBe(200)
      if (accept) current = next
      rt.state.nowS += 1
    }

    expect(failedLogins(rt)).toBe(0)
    expect(rt.addressFailures()).toBe(0)
    expect(rt.state.throttle.size).toBe(0)
    expect(events.ended).toBe(0)
    expect(m.hasToken()).toBe(true)
    expect(rt.state.password).toBe(current)
  })

  it('adopts a new username without signing in again', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m } = connect(rt)

    await m.changeOwnCredentials({ username: 'op2' }, () => Promise.resolve<Reply>({ status: 200 }), unauthorized, ok)

    expect(rt.state.logins).toEqual([])
    expect(m.getUsername()).toBe('op2')
  })

  it('signs in with the current password after a change whose request failed in transit', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m } = connect(rt)
    const failure = deferred<Reply>()

    const change = m.changeOwnCredentials(
      { password: 'new-pass' },
      () => failure.promise.then(() => Promise.reject(new Error('ECONNRESET'))),
      unauthorized,
      ok,
    )
    await flush()
    rt.expireTokens()
    const refreshed = m.refresh()
    failure.resolve({ status: 0 })
    await expect(change).rejects.toThrow('ECONNRESET')
    expect(await refreshed).toBe(true)
    expect(rt.state.logins).toEqual([{ ...OP, status: 200 }])
  })

  it('does not sign in after a logout during the change', async () => {
    const rt = makeThrottledRuntime('op', 'old-pass')
    const { m } = connect(rt)
    const reply = deferred<Reply>()

    const change = m.changeOwnCredentials(
      { password: 'new-pass' },
      async (token) => {
        const r = rt.updateOwnPassword(token, 'new-pass', 'old-pass')
        return reply.promise.then(() => r)
      },
      unauthorized,
      ok,
    )
    await flush()
    const refreshed = m.refresh()
    m.clear()
    reply.resolve({ status: 200 })
    await change
    expect(await refreshed).toBe(false)
    expect(rt.state.logins).toEqual([])
    expect(m.getUsername()).toBeNull()
  })
})

describe('isSessionExpiredStatus', () => {
  it('is true only for 401', () => {
    expect(isSessionExpiredStatus(401)).toBe(true)
    for (const status of [undefined, 0, 200, 400, 403, 404, 409, 422, 429, 500, 503]) {
      expect(isSessionExpiredStatus(status)).toBe(false)
    }
  })
})
