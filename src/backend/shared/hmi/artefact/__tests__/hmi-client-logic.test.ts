import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/* The browser client: resources/sources/hmi/client in the editor, src/assets/firmware/hmi/client on the web. */
const CLIENT_DIR =
  ['resources/sources/hmi/client', 'src/assets/firmware/hmi/client']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-client'

interface Sequencer {
  next(): number
  reset(): void
}

interface ClientLogic {
  TOKEN_KEY: string
  tokenExpiryMs(token: unknown): number
  tokenUsable(token: unknown, nowMs: number): boolean
  renewDelayMs(token: string, nowMs: number): number
  noticeFor(state: string): string | null
  signInMessage(status: number, retryAfter: string | null): string
  keyCode(event: Partial<KeyboardEvent> | null): number
  createSequencer(): Sequencer
  openEvent(n: number): Record<string, unknown>
  showEvent(page: number, n: number): Record<string, unknown>
  writeEvent(tag: number, value: Uint8Array, n: number): Record<string, unknown>
  parseWrites(bytes: Uint8Array): Array<{ tag: number; value: Uint8Array }> | null
  toQ4(v: number): number
  roleCode(status: unknown): number
  bytesOf(data: unknown): Uint8Array
}

const isClientLogic = (value: unknown): value is ClientLogic =>
  typeof value === 'object' && value !== null && 'renewDelayMs' in value && 'noticeFor' in value

/** Loads hmi-client.js into a scope without a document, as the client's own guard expects outside a page. */
function loadLogic(): ClientLogic {
  const scope: Record<string, unknown> = { atob: (s: string) => Buffer.from(s, 'base64').toString('binary') }
  const run = new Function('window', readFileSync(join(CLIENT_DIR, 'hmi-client.js'), 'utf8'))
  run(scope)
  const logic = scope.HmiClientLogic
  if (!isClientLogic(logic)) throw new Error('hmi-client.js did not define HmiClientLogic')
  return logic
}

const logic = loadLogic()
const jwt = (payload: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`
const NOW = 1_800_000_000_000

describe('the HMI browser client', () => {
  it('reads the expiry of a token and knows when it can still be presented', () => {
    const token = jwt({ exp: NOW / 1000 + 900 })
    expect(logic.tokenExpiryMs(token)).toBe(NOW + 900_000)
    expect(logic.tokenUsable(token, NOW)).toBe(true)
    expect(logic.tokenUsable(token, NOW + 900_000)).toBe(false)
    for (const bad of [null, 'abc', 'a.b.c', jwt({}), jwt({ exp: 'soon' }), 'a.!!!.c'])
      expect(logic.tokenUsable(bad, NOW)).toBe(false)
  })

  it('renews three minutes before the token expires, never sooner than 10 seconds', () => {
    expect(logic.renewDelayMs(jwt({ exp: NOW / 1000 + 900 }), NOW)).toBe(720_000)
    expect(logic.renewDelayMs(jwt({ exp: NOW / 1000 + 60 }), NOW)).toBe(10_000)
  })

  it('shows a notice for every state the runtime sends but live', () => {
    expect(logic.noticeFor('live')).toBeNull()
    expect(logic.noticeFor('stopped')).toBe('PLC stopped')
    expect(logic.noticeFor('out_of_date')).toBe('HMI out of date, rebuild the project')
    expect(logic.noticeFor('busy')).toBe('Device busy, try later')
    expect(logic.noticeFor('unavailable')).toBe('No HMI installed')
    expect(logic.noticeFor('fault')).toMatch(/error/)
    expect(logic.noticeFor('toString')).toBeNull()
  })

  it('words the sign-in failures', () => {
    expect(logic.signInMessage(401, null)).toBe('Wrong user name or password.')
    expect(logic.signInMessage(429, '7')).toBe('Too many attempts. Try again in 7 seconds.')
    expect(logic.signInMessage(429, null)).toBe('Too many attempts. Try again later.')
    expect(logic.signInMessage(0, null)).toBe('Device unreachable.')
    expect(logic.signInMessage(500, null)).toBe('Could not sign in (500).')
  })

  it('sends printable keys and the editing keys, nothing with a modifier', () => {
    expect(logic.keyCode({ key: 'a' })).toBe(97)
    expect(logic.keyCode({ key: 'é' })).toBe(0xe9)
    expect(logic.keyCode({ key: '😀' })).toBe(0x1f600)
    expect(logic.keyCode({ key: 'Enter' })).toBe(13)
    expect(logic.keyCode({ key: 'Backspace' })).toBe(8)
    expect(logic.keyCode({ key: 'Shift' })).toBe(0)
    expect(logic.keyCode({ key: 'c', ctrlKey: true })).toBe(0)
    expect(logic.keyCode(null)).toBe(0)
  })

  it('numbers events from 0 on each socket', () => {
    const seq = logic.createSequencer()
    expect([seq.next(), seq.next(), seq.next()]).toEqual([0, 1, 2])
    seq.reset()
    expect(seq.next()).toBe(0)
  })

  it('builds the open, show and write events the runtime accepts', () => {
    expect(logic.openEvent(0)).toEqual({ t: 'o', n: 0 })
    expect(logic.showEvent(3, 7)).toEqual({ t: 's', p: 3, n: 7 })
    const value = new Uint8Array([1])
    expect(logic.writeEvent(2, value, 8)).toEqual({ t: 'w', g: 2, v: value, n: 8 })
  })

  it('splits the writes the module queued into tag and value, each value a copy', () => {
    const bytes = new Uint8Array([1, 0, 1, 0, 1, 3, 0, 3, 0, 97, 98, 99, 4, 0, 0, 0])
    const writes = logic.parseWrites(bytes)
    expect(writes?.map((w) => [w.tag, [...w.value]])).toEqual([
      [1, [1]],
      [3, [97, 98, 99]],
      [4, []],
    ])
    bytes[4] = 0
    expect(writes?.[0].value[0]).toBe(1)
    expect(logic.parseWrites(new Uint8Array([1, 0, 2, 0, 1]))).toBeNull()
    expect(logic.parseWrites(new Uint8Array([1, 0, 1]))).toBeNull()
    expect(logic.parseWrites(new Uint8Array([]))).toEqual([])
  })

  it('turns CSS pixels into Q4 logical units, clamped', () => {
    expect(logic.toQ4(12.5)).toBe(200)
    expect(logic.toQ4(-1e9)).toBe(-16777216)
  })

  it('takes the role only from a live status that names one', () => {
    expect(logic.roleCode({ state: 'live', role: 2 })).toBe(2)
    for (const bad of [null, {}, { role: 4 }, { role: -1 }, { role: 1.5 }, { role: '2' }])
      expect(logic.roleCode(bad)).toBe(-1)
  })

  it('reads binary payloads as bytes and anything else as nothing', () => {
    expect([...logic.bytesOf(new Uint8Array([1, 2]).buffer)]).toEqual([1, 2])
    expect([...logic.bytesOf(new Uint8Array([0, 5, 6]).subarray(1))]).toEqual([5, 6])
    expect(logic.bytesOf('text').length).toBe(0)
  })

  it('keeps the page free of inline scripts and styles, which the device CSP refuses', () => {
    const html = readFileSync(join(CLIENT_DIR, 'index.html'), 'utf8')
    expect(html).not.toMatch(/<script>|<style|\sstyle=|\son[a-z]+=/i)
    expect(html).toContain('<script src="hmi-client.js" defer></script>')
  })
})
