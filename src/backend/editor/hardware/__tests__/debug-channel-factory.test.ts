/**
 * The factory turns a resolved config into an openable channel, and two of its
 * properties are load-bearing and invisible:
 *
 *  - the WebSocket token is read from the token MANAGER when `create()` runs,
 *    not captured when the candidate is built. Nothing observable breaks when
 *    that regresses — until a 15-minute JWT expires mid-session and the runtime
 *    rejects the first command on a channel opened after the refresh. It DID
 *    regress once, silently, in a merge that re-applied the surrounding change
 *    on top of an extraction taken from before it.
 *
 *  - `descriptor` carries the endpoint ALONE. Callers pair it with `transport`
 *    themselves, and one is matched against a raw OS port path.
 */

import type { DebugConnectionConfig } from '@root/middleware/shared/ports/types'

import { toDebugCandidate } from '../debug-channel-factory'

const wsConstructorArgs: Array<{ host: string; port: number; token: string; rejectUnauthorized: boolean }> = []

jest.mock('../../../shared/debug/websocket-debug-transport', () => ({
  WebSocketDebugTransport: jest.fn().mockImplementation((options: (typeof wsConstructorArgs)[number]) => {
    wsConstructorArgs.push(options)
    return { kind: 'websocket-transport' }
  }),
}))

const websocketConfig = (jwtToken: string | undefined = 'token-at-login'): DebugConnectionConfig => ({
  connectionType: 'websocket',
  connectionParams: { ipAddress: '192.168.2.4', jwtToken },
})

beforeEach(() => {
  wsConstructorArgs.length = 0
})

describe('toDebugCandidate — websocket', () => {
  it('presents the token the manager holds NOW, not the one the session opened with', () => {
    let current = 'token-at-login'
    const candidate = toDebugCandidate(websocketConfig(), { getToken: () => current })

    // The refresh happens between building the candidate and opening it, which
    // is exactly the window a closure over the login token gets wrong.
    current = 'token-after-refresh'
    candidate?.create()

    expect(wsConstructorArgs).toHaveLength(1)
    expect(wsConstructorArgs[0].token).toBe('token-after-refresh')
  })

  it('falls back to the config token before the manager has a session', () => {
    const candidate = toDebugCandidate(websocketConfig('token-at-login'), { getToken: () => null })
    candidate?.create()
    expect(wsConstructorArgs[0].token).toBe('token-at-login')
  })

  it('falls back to the config token when no manager is injected at all', () => {
    const candidate = toDebugCandidate(websocketConfig('token-at-login'))
    candidate?.create()
    expect(wsConstructorArgs[0].token).toBe('token-at-login')
  })

  it('describes the endpoint alone, so callers that add the transport do not print it twice', () => {
    const candidate = toDebugCandidate(websocketConfig(), { getToken: () => 'live' })
    expect(candidate?.transport).toBe('websocket')
    expect(candidate?.descriptor).toBe('192.168.2.4')
  })

  it('refuses a config with no host, or with no token from either source', () => {
    expect(
      toDebugCandidate({ connectionType: 'websocket', connectionParams: { ipAddress: '', jwtToken: 't' } }),
    ).toBeNull()
    expect(toDebugCandidate({ connectionType: 'websocket', connectionParams: { ipAddress: '192.168.2.4' } })).toBeNull()
  })

  it('builds the channel when only the MANAGER has a token: it, not the config, is the authority', () => {
    const candidate = toDebugCandidate(
      { connectionType: 'websocket', connectionParams: { ipAddress: '192.168.2.4' } },
      { getToken: () => 'from-the-manager' },
    )
    candidate?.create()
    expect(wsConstructorArgs[0].token).toBe('from-the-manager')
  })

  it('throws on open, rather than opening an unauthenticated socket, if the token vanishes meanwhile', () => {
    let token: string | null = 'live'
    const candidate = toDebugCandidate(
      { connectionType: 'websocket', connectionParams: { ipAddress: '192.168.2.4' } },
      { getToken: () => token },
    )
    token = null
    expect(() => candidate?.create()).toThrow(/log in again/)
    expect(wsConstructorArgs).toHaveLength(0)
  })
})

describe('toDebugCandidate — serial', () => {
  it('keeps the endpoint bare: it is matched against the raw port path on release', () => {
    const candidate = toDebugCandidate({
      connectionType: 'rtu',
      connectionParams: { port: '/dev/cu.usbmodem11301', baudRate: 115200, slaveId: 1 },
    })

    expect(candidate?.transport).toBe('rtu')
    expect(candidate?.descriptor).toBe('/dev/cu.usbmodem11301')
  })
})
