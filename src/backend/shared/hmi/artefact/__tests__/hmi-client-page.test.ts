import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/* The browser client: resources/sources/hmi/client in the editor, src/assets/firmware/hmi/client on the web. */
const CLIENT_DIR =
  ['resources/sources/hmi/client', 'src/assets/firmware/hmi/client']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-client'

const TOKEN_KEY = 'openplc-hmi-token'

type Handler = (...args: unknown[]) => void

/** A Socket.IO client socket as the page uses it: handlers by event, connected and active flags, events sent. */
class FakeSocket {
  handlers = new Map<string, Handler>()
  connected = false
  active = true
  closed = false
  sent: Array<Record<string, unknown>> = []
  on(event: string, handler: Handler): this {
    this.handlers.set(event, handler)
    return this
  }
  off(): this {
    this.handlers.clear()
    return this
  }
  emit(event: string, data: Record<string, unknown>): this {
    if (event === 'in') this.sent.push(data)
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

/** The module's exports as hmi-client.js calls them, faked: page, sign-out flag and queued writes are settable. */
class FakeModule {
  memory = new WebAssembly.Memory({ initial: 1 })
  page = 0
  signOut = 0
  frames = 0
  role = -1
  writes: number[] = []
  valuesSeen: number[][] = []
  pointers: number[][] = []
  exports(): Record<string, unknown> {
    const OUT = 0
    const IN = 4096
    return {
      memory: this.memory,
      hmi_bh_init: (_w: number, _h: number, role: number) => ((this.role = role), 0),
      hmi_bh_frame_ms: () => 50,
      hmi_bh_frame: () => {
        this.frames++
        return 0
      },
      hmi_bh_page: () => this.page,
      hmi_bh_sign_out: () => this.signOut,
      hmi_bh_render: () => 0,
      hmi_bh_dirty_y0: () => 0,
      hmi_bh_dirty_rows: () => 0,
      hmi_bh_resize: () => undefined,
      hmi_bh_pointer: (...args: number[]) => this.pointers.push(args),
      hmi_bh_key: () => undefined,
      hmi_bh_out: () => {
        new Uint8Array(this.memory.buffer, OUT, this.writes.length).set(this.writes)
        return OUT
      },
      hmi_bh_out_len: () => this.writes.length,
      hmi_bh_out_clear: () => (this.writes = []),
      hmi_bh_reset_writes: () => undefined,
      hmi_bh_in: () => IN,
      hmi_bh_values: (len: number) => {
        const bytes = [...new Uint8Array(this.memory.buffer, IN, len)]
        this.valuesSeen.push(bytes)
        return bytes[0] | (bytes[1] << 8)
      },
    }
  }
}

interface Page {
  sockets: FakeSocket[]
  calls: string[]
  module: FakeModule
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
  const module = new FakeModule()
  Object.assign(WebAssembly, {
    compileStreaming: () => Promise.resolve({}),
    instantiate: () => Promise.resolve({ exports: module.exports() }),
  })
  new Function('window', readFileSync(join(CLIENT_DIR, 'hmi-client.js'), 'utf8'))(window)
  return {
    sockets,
    calls,
    module,
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

  it('drops a renewal that answers after the device ended the session', async () => {
    const page = loadPage(token(now() + 900, 'a'))
    page.answer('/api/renew', respond(200, { access_token: token(now() + 900, 'b') }))
    await settle()
    expect(page.sockets).toHaveLength(1)

    await jest.advanceTimersByTimeAsync(12 * 60 * 1000)
    expect(page.calls.filter((c) => c === '/api/renew')).toHaveLength(2)
    page.sockets[0].fire('disconnect', 'io server disconnect')
    page.answer('/api/whoami', respond(401))
    await settle()
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

  /** A signed-in page whose socket connected and whose device answered live for an operator. */
  async function livePage(): Promise<Page> {
    const page = loadPage(token(now() + 900, 'a'))
    page.answer('/api/renew', respond(200, { access_token: token(now() + 900, 'b') }))
    await settle()
    const socket = page.sockets[0]
    socket.connected = true
    socket.fire('connect')
    socket.fire('hmi_status', { state: 'live', role: 2 })
    await settle()
    return page
  }

  it('opens the viewer, runs the screens with the role the device sent and shows the screen shown', async () => {
    const page = await livePage()
    const socket = page.sockets[0]
    expect(page.module.role).toBe(2)
    expect(socket.sent.slice(0, 2)).toEqual([
      { t: 'o', n: 0 },
      { t: 's', p: 0, n: 1 },
    ])
    expect(document.getElementById('notice')?.hidden).toBe(true)
    const canvas = document.getElementById('surface')
    expect(canvas?.style.width).toBe(`${window.innerWidth}px`)
    expect(canvas?.style.height).toBe(`${window.innerHeight}px`)
    const frames = page.module.frames
    await jest.advanceTimersByTimeAsync(500)
    expect(page.module.frames).toBeGreaterThanOrEqual(frames + 9)

    page.module.page = 1
    await jest.advanceTimersByTimeAsync(60)
    expect(socket.sent.filter((e) => e.t === 's')).toEqual([
      { t: 's', p: 0, n: 1 },
      { t: 's', p: 1, n: 2 },
    ])
  })

  it('sends each write the screens queued, in order, numbered with the other events', async () => {
    const page = await livePage()
    const socket = page.sockets[0]
    page.module.writes = [1, 0, 1, 0, 1, 3, 0, 2, 0, 104, 105]
    await jest.advanceTimersByTimeAsync(60)
    const writes = socket.sent.filter((e) => e.t === 'w')
    expect(writes.map((w) => [w.g, [...(w.v instanceof Uint8Array ? w.v : [])], w.n])).toEqual([
      [1, [1], 2],
      [3, [104, 105], 3],
    ])
    await jest.advanceTimersByTimeAsync(60)
    expect(socket.sent.filter((e) => e.t === 'w')).toHaveLength(2)
  })

  it('hands values to the screens and acknowledges them', async () => {
    const page = await livePage()
    const acks: number[] = []
    page.sockets[0].fire('hmi_values', new Uint8Array([0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1]).buffer, () =>
      acks.push(1),
    )
    expect(page.module.valuesSeen).toEqual([[0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1]])
    expect(acks).toEqual([1])
  })

  it('stops the screens while the device is not live and dims the last frame', async () => {
    const page = await livePage()
    page.sockets[0].fire('hmi_status', { state: 'stopped' })
    expect(document.getElementById('notice')?.textContent).toBe('PLC stopped')
    const frames = page.module.frames
    await jest.advanceTimersByTimeAsync(500)
    expect(page.module.frames).toBe(frames)
    page.sockets[0].fire('hmi_status', { state: 'live', role: 2 })
    await settle()
    await jest.advanceTimersByTimeAsync(100)
    expect(page.module.frames).toBeGreaterThan(frames)
    expect(page.sockets[0].sent.filter((e) => e.t === 's').length).toBe(2)
  })

  it('signs out through the device when a screen asks, and returns to the form', async () => {
    const page = await livePage()
    page.module.signOut = 1
    await jest.advanceTimersByTimeAsync(60)
    expect(page.calls).toContain('/api/logout')
    expect(formShown()).toBe(true)
    expect(document.getElementById('sign-in-message')?.textContent).toBe('Signed out.')
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(page.sockets[0].closed).toBe(true)
  })
})
