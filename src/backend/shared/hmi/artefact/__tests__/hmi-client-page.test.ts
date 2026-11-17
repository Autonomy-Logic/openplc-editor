import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/* The browser client: resources/sources/hmi/client in the editor, src/assets/firmware/hmi/client on the web. */
const CLIENT_DIR =
  ['resources/sources/hmi/client', 'src/assets/firmware/hmi/client']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-client'

const TOKEN_KEY = 'openplc-hmi-token'

type Handler = (...args: unknown[]) => void

/** A Socket.IO client socket as the page uses it: handlers by event, connected and active flags. */
class FakeSocket {
  handlers = new Map<string, Handler>()
  connected = false
  active = true
  closed = false
  on(event: string, handler: Handler): this {
    this.handlers.set(event, handler)
    return this
  }
  off(): this {
    this.handlers.clear()
    return this
  }
  emit(): this {
    return this
  }
  connect(): this {
    return this
  }
  disconnect(): this {
    this.closed = true
    return this
  }
  fire(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args)
  }
}

interface FakeResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  headers: { get: (name: string) => string | null }
}

const respond = (status: number, body: unknown = {}): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  headers: { get: () => null },
})

const token = (expSeconds: number, id: string): string =>
  `h.${btoa(JSON.stringify({ exp: expSeconds, jti: id })).replace(/=+$/, '')}.s`

interface Page {
  sockets: FakeSocket[]
  calls: string[]
  /** Answers the next request to `path`; requests not answered stay pending. */
  answer: (path: string, response: FakeResponse) => void
}

/** Loads index.html and hmi-client.js into the test document with fake fetch, Socket.IO and WebAssembly. */
function loadPage(stored: string | null): Page {
  const html = readFileSync(join(CLIENT_DIR, 'index.html'), 'utf8')
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? ''
  localStorage.clear()
  if (stored) localStorage.setItem(TOKEN_KEY, stored)
  const sockets: FakeSocket[] = []
  const calls: string[] = []
  const pending = new Map<string, Array<(r: FakeResponse) => void>>()
  Object.assign(window, {
    io: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  Object.assign(globalThis, {
    fetch: (path: string) => {
      calls.push(path)
      return new Promise<FakeResponse>((resolve) => {
        const queue = pending.get(path) ?? []
        queue.push(resolve)
        pending.set(path, queue)
      })
    },
  })
  WebAssembly.instantiateStreaming = () => new Promise(() => undefined)
  new Function('window', readFileSync(join(CLIENT_DIR, 'hmi-client.js'), 'utf8'))(window)
  return {
    sockets,
    calls,
    answer: (path, response) => {
      const resolve = pending.get(path)?.shift()
      if (!resolve) throw new Error(`no pending request to ${path}`)
      resolve(response)
    },
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const formShown = () => !(document.getElementById('sign-in')?.hidden ?? true)

describe('the HMI browser client page', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-16T12:00:00Z'))
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const now = () => Math.floor(Date.now() / 1000)

  it('drops a renewal that answers after the viewer was signed out', async () => {
    const page = loadPage(token(now() + 900, 'a'))
    page.answer('/api/renew', respond(200, { access_token: token(now() + 900, 'b') }))
    await settle()
    expect(page.sockets).toHaveLength(1)

    await jest.advanceTimersByTimeAsync(12 * 60 * 1000)
    expect(page.calls.filter((c) => c === '/api/renew')).toHaveLength(2)
    page.sockets[0].fire('hmi_signed_out')
    expect(formShown()).toBe(true)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()

    page.answer('/api/renew', respond(200, { access_token: token(now() + 900, 'c') }))
    await settle()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(page.calls.filter((c) => c === '/api/renew')).toHaveLength(2)
  })

  it('returns to the form when a refused connection belongs to a session the device ended', async () => {
    const page = loadPage(token(now() + 900, 'a'))
    page.answer('/api/renew', respond(200, { access_token: token(now() + 900, 'b') }))
    await settle()
    const socket = page.sockets[0]
    socket.active = false
    socket.fire('connect_error', new Error('unauthorized'))
    expect(page.calls).not.toContain('/api/whoami')

    await jest.advanceTimersByTimeAsync(2000)
    expect(page.calls).toContain('/api/whoami')
    page.answer('/api/whoami', respond(401))
    await settle()
    expect(formShown()).toBe(true)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('asks again later, waiting longer each time, while the device keeps refusing a session it still has', async () => {
    const page = loadPage(token(now() + 900, 'a'))
    page.answer('/api/renew', respond(200, { access_token: token(now() + 900, 'b') }))
    await settle()
    page.sockets[0].active = false
    page.sockets[0].fire('connect_error', new Error('busy'))
    await jest.advanceTimersByTimeAsync(2000)
    page.answer('/api/whoami', respond(200))
    await settle()
    expect(page.sockets).toHaveLength(2)
    expect(formShown()).toBe(false)

    page.sockets[1].active = false
    page.sockets[1].fire('connect_error', new Error('busy'))
    await jest.advanceTimersByTimeAsync(2000)
    expect(page.calls.filter((c) => c === '/api/whoami')).toHaveLength(1)
    await jest.advanceTimersByTimeAsync(2000)
    expect(page.calls.filter((c) => c === '/api/whoami')).toHaveLength(2)
  })
})
