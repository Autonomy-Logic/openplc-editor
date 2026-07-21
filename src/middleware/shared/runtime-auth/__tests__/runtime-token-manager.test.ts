import { createRuntimeTokenManager, type TokenLoginTransport } from '../runtime-token-manager'

const CREDS = { username: 'admin', password: 'openplc' }

/**
 * A controllable login transport. Each call to `login` resolves with the next
 * queued result (or a default success), and records the credentials it saw.
 */
function makeTransport(results?: Array<{ success: boolean; token?: string; error?: string }>) {
  const queue = [...(results ?? [])]
  const calls: Array<{ username: string; password: string }> = []
  let deferredResolvers: Array<(v: { success: boolean; token?: string }) => void> = []
  const transport: TokenLoginTransport & {
    calls: typeof calls
    resolveNext: (v: { success: boolean; token?: string }) => void
    pending: number
  } = {
    calls,
    get pending() {
      return deferredResolvers.length
    },
    resolveNext(v) {
      const r = deferredResolvers.shift()
      if (r) r(v)
    },
    login(credentials) {
      calls.push({ ...credentials })
      if (queue.length > 0) return Promise.resolve(queue.shift()!)
      // No queued result → return a promise the test resolves manually (for
      // single-flight timing tests).
      return new Promise((resolve) => {
        deferredResolvers.push(resolve)
      })
    },
  }
  return transport
}

describe('createRuntimeTokenManager', () => {
  describe('initial state', () => {
    it('starts with no token', () => {
      const m = createRuntimeTokenManager(makeTransport())
      expect(m.getToken()).toBeNull()
      expect(m.hasToken()).toBe(false)
    })
  })

  describe('setSession / clear', () => {
    it('adopts a token and reports hasToken', () => {
      const m = createRuntimeTokenManager(makeTransport())
      m.setSession('tok-1', CREDS)
      expect(m.getToken()).toBe('tok-1')
      expect(m.hasToken()).toBe(true)
    })

    it('clear forgets the token and credentials (so refresh can no longer run)', async () => {
      const m = createRuntimeTokenManager(makeTransport([{ success: true, token: 'x' }]))
      m.setSession('tok-1', CREDS)
      m.clear()
      expect(m.getToken()).toBeNull()
      expect(m.hasToken()).toBe(false)
      // No credentials left → refresh is a no-op.
      expect(await m.refresh()).toBe(false)
    })

    it('treats an empty-string token as not-held', () => {
      const m = createRuntimeTokenManager(makeTransport())
      m.setSession('', CREDS)
      expect(m.hasToken()).toBe(false)
    })
  })

  describe('refresh', () => {
    it('returns false when there are no stored credentials', async () => {
      const t = makeTransport()
      const m = createRuntimeTokenManager(t)
      expect(await m.refresh()).toBe(false)
      expect(t.calls).toHaveLength(0)
    })

    it('re-authenticates with stored credentials and adopts the new token', async () => {
      const t = makeTransport([{ success: true, token: 'tok-2' }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      expect(await m.refresh()).toBe(true)
      expect(m.getToken()).toBe('tok-2')
      expect(t.calls).toEqual([CREDS])
    })

    it('returns false and keeps the old token when the runtime rejects re-login', async () => {
      const t = makeTransport([{ success: false, error: 'bad creds' }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      expect(await m.refresh()).toBe(false)
      expect(m.getToken()).toBe('tok-1')
    })

    it('returns false when login succeeds but yields no token', async () => {
      const t = makeTransport([{ success: true }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      expect(await m.refresh()).toBe(false)
      expect(m.getToken()).toBe('tok-1')
    })

    it('treats a thrown transport error as a failed refresh', async () => {
      const t: TokenLoginTransport = {
        login: () => Promise.reject(new Error('network down')),
      }
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      expect(await m.refresh()).toBe(false)
      expect(m.getToken()).toBe('tok-1')
    })

    it('is single-flight: concurrent refreshes share one login call', async () => {
      const t = makeTransport() // no queued results → manual resolution
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)

      const a = m.refresh()
      const b = m.refresh()
      // Both joined the same in-flight login.
      expect(t.pending).toBe(1)

      t.resolveNext({ success: true, token: 'tok-2' })
      expect(await a).toBe(true)
      expect(await b).toBe(true)
      expect(t.calls).toHaveLength(1)
      expect(m.getToken()).toBe('tok-2')
    })

    it('allows a fresh refresh after a previous one settled', async () => {
      const t = makeTransport([
        { success: true, token: 'tok-2' },
        { success: true, token: 'tok-3' },
      ])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      expect(await m.refresh()).toBe(true)
      expect(await m.refresh()).toBe(true)
      expect(t.calls).toHaveLength(2)
      expect(m.getToken()).toBe('tok-3')
    })
  })

  describe('withAuth', () => {
    it('runs the operation with the current token and returns its result when authorized', async () => {
      const m = createRuntimeTokenManager(makeTransport())
      m.setSession('tok-1', CREDS)
      const seen: string[] = []
      const result = await m.withAuth(
        (token) => {
          seen.push(token)
          return Promise.resolve({ code: 200 })
        },
        (r) => r.code === 401,
      )
      expect(result).toEqual({ code: 200 })
      expect(seen).toEqual(['tok-1'])
    })

    it('refreshes and retries once with the new token on an unauthorized result', async () => {
      const t = makeTransport([{ success: true, token: 'tok-2' }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      const seen: string[] = []
      const result = await m.withAuth(
        (token) => {
          seen.push(token)
          return Promise.resolve({ code: token === 'tok-2' ? 200 : 401 })
        },
        (r) => r.code === 401,
      )
      expect(result).toEqual({ code: 200 })
      expect(seen).toEqual(['tok-1', 'tok-2']) // first attempt, then retry with fresh token
    })

    it('returns the unauthorized result without retrying when refresh fails', async () => {
      const t = makeTransport([{ success: false }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      let attempts = 0
      const result = await m.withAuth(
        () => {
          attempts += 1
          return Promise.resolve({ code: 401 })
        },
        (r) => r.code === 401,
      )
      expect(result).toEqual({ code: 401 })
      expect(attempts).toBe(1) // no retry because refresh failed
    })

    it('does not retry when the result is authorized even if a refresh would succeed', async () => {
      const t = makeTransport([{ success: true, token: 'tok-2' }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      const result = await m.withAuth(
        () => Promise.resolve({ code: 200 }),
        (r) => r.code === 401,
      )
      expect(result).toEqual({ code: 200 })
      expect(t.calls).toHaveLength(0) // refresh never called
    })

    it('passes an empty string to the operation when there is no token yet', async () => {
      const m = createRuntimeTokenManager(makeTransport())
      const seen: string[] = []
      await m.withAuth(
        (token) => {
          seen.push(token)
          return Promise.resolve({ code: 200 })
        },
        (r) => r.code === 401,
      )
      expect(seen).toEqual([''])
    })
  })

  describe('onTokenChanged', () => {
    it('notifies subscribers with the fresh token on refresh', async () => {
      const t = makeTransport([{ success: true, token: 'tok-2' }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      const seen: string[] = []
      m.onTokenChanged((tok) => seen.push(tok))
      await m.refresh()
      expect(seen).toEqual(['tok-2'])
    })

    it('stops notifying after unsubscribe', async () => {
      const t = makeTransport([
        { success: true, token: 'tok-2' },
        { success: true, token: 'tok-3' },
      ])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      const seen: string[] = []
      const unsubscribe = m.onTokenChanged((tok) => seen.push(tok))
      await m.refresh()
      unsubscribe()
      await m.refresh()
      expect(seen).toEqual(['tok-2']) // second refresh not observed
    })

    it('does not notify when a refresh fails', async () => {
      const t = makeTransport([{ success: false }])
      const m = createRuntimeTokenManager(t)
      m.setSession('tok-1', CREDS)
      const seen: string[] = []
      m.onTokenChanged((tok) => seen.push(tok))
      await m.refresh()
      expect(seen).toEqual([])
    })
  })
})
