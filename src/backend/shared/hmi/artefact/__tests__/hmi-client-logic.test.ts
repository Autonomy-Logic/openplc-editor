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
  viewportEvent(width: number, height: number, ratio: number, n: number): Record<string, unknown>
  pointerEvent(kind: number, x: number, y: number, n: number): Record<string, unknown>
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

  it('builds viewport and pointer events in the ranges the runtime accepts', () => {
    expect(logic.viewportEvent(1280.4, 0, 20, 3)).toEqual({ t: 'v', w: 1280, h: 1, d: 8, n: 3 })
    expect(logic.viewportEvent(99999, 720, 0, 0)).toEqual({ t: 'v', w: 8192, h: 720, d: 1, n: 0 })
    expect(logic.pointerEvent(1, 12.5, -200000, 9)).toEqual({ t: 'p', k: 1, x: 12.5, y: -100000, n: 9 })
  })

  it('keeps the page free of inline scripts and styles, which the device CSP refuses', () => {
    const html = readFileSync(join(CLIENT_DIR, 'index.html'), 'utf8')
    expect(html).not.toMatch(/<script>|<style|\sstyle=|\son[a-z]+=/i)
    expect(html).toContain('<script src="hmi-client.js" defer></script>')
  })
})
