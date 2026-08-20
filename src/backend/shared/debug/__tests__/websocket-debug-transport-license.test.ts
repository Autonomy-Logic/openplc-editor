/**
 * License function codes (0x48 anchor / 0x49 write / 0x4A read) over the
 * runtime-v4 debug WebSocket. Mocks socket.io-client so the test exercises the
 * REAL PDU framing: builder -> spaced-hex envelope -> canned runtime response ->
 * parser.
 *
 * This is the editor side of the transport-agnostic activation: the same PDUs the
 * serial and TCP clients send, so a network target licenses through one code path
 * instead of a second, medium-specific one. The runtime answers these FCs at the
 * webserver level (covered by the runtime's own tests).
 *
 * MOCKING, IN BOTH RUNNERS. This file is on the byte-identical shared surface, so
 * it runs under Vitest (web) and Jest (editor, which aliases `vi` to `jest`).
 * Hence `vi.mock`, never `jest.mock` — the latter is undefined in Vitest, the
 * factory never installs, and the real socket.io-client tries to dial a server.
 *
 * The `import { WebSocketDebugTransport }` below sits AFTER the `vi.mock` call,
 * and that position is LOAD-BEARING:
 *   - Vitest hoists `vi.mock` above the imports, so it would work either way.
 *   - The editor's Jest does NOT hoist it (ts-jest only hoists literal
 *     `jest.mock`), so the call has to physically precede the import.
 * Do not move it into the import block at the top.
 */
import type { Socket } from 'socket.io-client'

type Handler = (arg: unknown) => void
type DebugResponse = { success: boolean; data?: string; error?: string }
/** One response, or several — several models a stale frame arriving first. */
type Responder = (commandHex: string) => DebugResponse | DebugResponse[]

/**
 * Fake Socket.IO socket: auto-connects and answers `debug_command` with whatever
 * the active responder returns for the PDU it was handed. When the responder
 * returns an ARRAY, each entry is emitted as its own `debug_response` event, in
 * order — how a stale frame from an earlier, timed-out command shows up on the
 * real socket.
 */
function makeFakeSocket(responder: Responder): Socket {
  const handlers: Record<string, Handler[]> = {}
  const socket = {
    on(event: string, cb: Handler) {
      ;(handlers[event] ||= []).push(cb)
      if (event === 'connected') setTimeout(() => cb({ status: 'ok' }), 0)
      return socket
    },
    off(event: string, cb: Handler) {
      handlers[event] = (handlers[event] || []).filter((h) => h !== cb)
      return socket
    },
    emit(event: string, payload: { command: string }) {
      if (event === 'debug_command') {
        const resp = responder(payload.command)
        for (const one of Array.isArray(resp) ? resp : [resp]) {
          setTimeout(() => (handlers['debug_response'] || []).forEach((h) => h(one)), 0)
        }
      }
      return socket
    },
    disconnect() {
      return socket
    },
    io: { on() {} },
  }
  return socket as unknown as Socket
}

let currentResponder: Responder = () => ({ success: false, error: 'no responder' })

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => makeFakeSocket((cmd) => currentResponder(cmd))),
}))

// Deliberately AFTER `vi.mock` — see the module docstring.
import { WebSocketDebugTransport } from '../websocket-debug-transport'

async function connected(): Promise<WebSocketDebugTransport> {
  const transport = new WebSocketDebugTransport({ host: '127.0.0.1', port: 8443, token: 'jwt' })
  await transport.connect()
  return transport
}

function toSpacedHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

describe('WebSocketDebugTransport license function codes', () => {
  it('getBoardId (0x48) hands back the anchor bytes the runtime answers with', async () => {
    // The runtime answers 0x48 with the RAW hardware anchor (its device-tree
    // serial, trailing NUL/CR/LF/space already stripped runtime-side) — the
    // pre-image the licensing identity derives from, not a hex string to decode.
    const anchor = Array.from('100000003d1a2b4c', (c) => c.charCodeAt(0))
    currentResponder = () => ({ success: true, data: toSpacedHex([0x48, 0x7e, anchor.length, ...anchor]) })

    const transport = await connected()
    const result = await transport.getBoardId()

    expect(result.success).toBe(true)
    expect(Array.from(result.boardId ?? [])).toEqual(anchor)
  })

  it('getBoardId (0x48) resolves a refusal as failure, never as an identity', async () => {
    // A runtime that predates the license FCs hands 0x48 to its realtime core,
    // which refuses it. That must resolve to success: false — the licensing flow
    // then reports check-failed instead of deriving a device id from nothing.
    currentResponder = () => ({ success: false, error: 'Unknown function code' })

    const transport = await connected()
    const result = await transport.getBoardId()

    expect(result.success).toBe(false)
    expect(result.boardId).toBeUndefined()
  })

  it('getBoardId (0x48) re-strips a raw anchor tail — the set license_platform.c strips', async () => {
    // Defensive re-normalization: the runtime already strips on the wire, but
    // the closed core's __linux__ branch strips this exact set before deciding
    // the identity — so a runtime build that ever answered raw must not make
    // the editor derive a deviceId the device cannot reproduce.
    const serial = Array.from('10000000abcdef01', (c) => c.charCodeAt(0))
    const rawTail = [...serial, 0x00, 0x0d, 0x0a, 0x20] // NUL, CR, LF, SPACE
    currentResponder = () => ({ success: true, data: toSpacedHex([0x48, 0x7e, rawTail.length, ...rawTail]) })

    const transport = await connected()
    const result = await transport.getBoardId()

    expect(result.success).toBe(true)
    expect(Array.from(result.boardId ?? [])).toEqual(serial)
    expect(result.boardIdHex).toBe(serial.map((b) => b.toString(16).padStart(2, '0')).join(''))
  })

  it('getBoardId (0x48) strips an all-padding anchor to EMPTY, never to an identity', async () => {
    // All-padding is what the core would strip to zero bytes as well: the
    // licensing flow refuses a zero-length anchor ("no unique hardware id")
    // instead of hashing padding into a fleet-wide shared deviceId.
    currentResponder = () => ({ success: true, data: toSpacedHex([0x48, 0x7e, 3, 0x00, 0x0a, 0x20]) })

    const transport = await connected()
    const result = await transport.getBoardId()

    expect(result.success).toBe(true)
    expect(result.boardId?.length).toBe(0)
  })

  it('readLicense (0x4A) parses a full 98-byte blob on SUCCESS', async () => {
    const blob = new Uint8Array(98)
    for (let i = 0; i < blob.length; i++) blob[i] = i & 0xff
    currentResponder = () => ({ success: true, data: toSpacedHex([0x4a, 0x7e, 0x00, 98, ...blob]) })

    const transport = await connected()
    const result = await transport.readLicense()

    expect(result.success).toBe(true)
    expect(result.blob?.length).toBe(98)
    expect(Array.from(result.blob ?? [])).toEqual(Array.from(blob))
  })

  it('readLicense (0x4A) maps LIC_EMPTY to a valid empty state, not an error', async () => {
    currentResponder = () => ({ success: true, data: '4A 83' })

    const transport = await connected()
    const result = await transport.readLicense()

    expect(result.success).toBe(true)
    expect(result.empty).toBe(true)
    expect(result.blob).toBeUndefined()
  })

  it('readLicense (0x4A) maps LIC_UNSUPPORTED to a valid state (no store backend)', async () => {
    currentResponder = () => ({ success: true, data: '4A 85' })

    const transport = await connected()
    const result = await transport.readLicense()

    expect(result.success).toBe(true)
    expect(result.unsupported).toBe(true)
  })

  it('writeLicense (0x49) frames [FC][len:u16BE][blob] and parses SUCCESS', async () => {
    const sent: string[] = []
    currentResponder = (cmd) => {
      sent.push(cmd)
      return { success: true, data: '49 7E' }
    }

    const transport = await connected()
    const result = await transport.writeLicense(new Uint8Array(98).fill(0xab))

    const parts = sent[0].split(' ')
    expect(parts[0]).toBe('49')
    expect(parts[1]).toBe('00') // len high
    expect(parts[2]).toBe('62') // len low (98)
    expect(parts).toHaveLength(3 + 98)
    expect(result.success).toBe(true)
  })

  it('surfaces a runtime-side error as a structured failure rather than throwing', async () => {
    currentResponder = () => ({ success: false, error: 'no license backend wired' })

    const transport = await connected()
    const result = await transport.readLicense()

    expect(result.success).toBe(false)
    expect(result.error).toContain('no license backend wired')
  })

  it('getBoardId (0x48) strips the four anchor-parity RAW vectors to one identity pre-image', async () => {
    // The cross-repo contract (openplc-packages license-core/test/runtime-v4/
    // anchor-parity.mjs): the same serial with tails NUL, LF, CRLF and " NUL"
    // must all normalize to the SAME bytes — the pre-image of deviceId
    // 7146518f9842adacfadc731ee7f546e5, pinned editor-side in
    // device-identity.test.ts. If the strip set here ever drifts from
    // license_platform.c's, one of these vectors stops matching.
    const base = Array.from('8625807b0a83ae7d', (c) => c.charCodeAt(0))
    const tails = [[0x00], [0x0a], [0x0d, 0x0a], [0x20, 0x00]]
    const transport = await connected()
    for (const tail of tails) {
      const raw = [...base, ...tail]
      currentResponder = () => ({ success: true, data: toSpacedHex([0x48, 0x7e, raw.length, ...raw]) })
      const result = await transport.getBoardId()
      expect(Array.from(result.boardId ?? [])).toEqual(base)
    }
  })

  it('serialises concurrent commands — each caller gets ITS function code response', async () => {
    // Socket.IO fires every registered listener per event and the envelope has
    // no correlation id: without the send mutex two in-flight commands both
    // consumed the FIRST response (review 2026-08-20, finding 1) — a licence
    // check mid-debug-session took the poll's frame and failed on a healthy
    // device. The responder answers by echoed FC, so if the mutex ever goes,
    // one of these assertions receives the other's payload.
    const anchor = Array.from('10000000abcdef01', (c) => c.charCodeAt(0))
    const blob = new Uint8Array(98).fill(0x11)
    currentResponder = (cmd) => {
      const fc = cmd.split(' ')[0]
      if (fc === '48') return { success: true, data: toSpacedHex([0x48, 0x7e, anchor.length, ...anchor]) }
      return { success: true, data: toSpacedHex([0x4a, 0x7e, 0x00, 98, ...blob]) }
    }
    const transport = await connected()
    const [board, license] = await Promise.all([transport.getBoardId(), transport.readLicense()])
    expect(board.success).toBe(true)
    expect(Array.from(board.boardId ?? [])).toEqual(anchor)
    expect(license.success).toBe(true)
    expect(license.blob?.length).toBe(98)
  })

  it('ignores a stale data frame from another function code and resolves on its own', async () => {
    // A reply landing AFTER its command timed out has no listener left, so it
    // arrives during the NEXT command's window. Data frames are correlated by
    // echoed FC: the stale frame is skipped, the right one resolves.
    const anchor = Array.from('10000000abcdef01', (c) => c.charCodeAt(0))
    currentResponder = () => [
      { success: true, data: '4A 83' }, // stale read-license frame from a dead command
      { success: true, data: toSpacedHex([0x48, 0x7e, anchor.length, ...anchor]) },
    ]

    const transport = await connected()
    const result = await transport.getBoardId()

    expect(result.success).toBe(true)
    expect(Array.from(result.boardId ?? [])).toEqual(anchor)
  })

  it('refuses all three calls when the socket is not connected', async () => {
    const transport = new WebSocketDebugTransport({ host: '127.0.0.1', port: 8443, token: 'jwt' })

    await expect(transport.getBoardId()).resolves.toEqual({ success: false, error: 'Not connected to target' })
    await expect(transport.readLicense()).resolves.toEqual({ success: false, error: 'Not connected to target' })
    await expect(transport.writeLicense(new Uint8Array(98))).resolves.toEqual({
      success: false,
      error: 'Not connected to target',
    })
  })
})
