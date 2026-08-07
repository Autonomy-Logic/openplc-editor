/**
 * License function codes (0x49 write / 0x4A read) over the runtime-v4 debug
 * WebSocket. Mocks socket.io-client so the test exercises the REAL PDU framing:
 * builder -> spaced-hex envelope -> canned runtime response -> parser.
 *
 * This is the editor side of the transport-agnostic activation: the same PDUs the
 * serial and TCP clients send, so a network target licenses through one code path
 * instead of a second, medium-specific one. The runtime answers these FCs at the
 * webserver level (covered by the runtime's own tests).
 */
import type { Socket } from 'socket.io-client'

import { WebSocketDebugTransport } from '../websocket-debug-transport'

type Handler = (arg: unknown) => void
type Responder = (commandHex: string) => { success: boolean; data?: string; error?: string }

/**
 * Fake Socket.IO socket: auto-connects and answers `debug_command` with whatever
 * the active responder returns for the PDU it was handed.
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
        setTimeout(() => (handlers['debug_response'] || []).forEach((h) => h(resp)), 0)
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

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => makeFakeSocket((cmd) => currentResponder(cmd))),
}))

async function connected(): Promise<WebSocketDebugTransport> {
  const transport = new WebSocketDebugTransport({ host: '127.0.0.1', port: 8443, token: 'jwt' })
  await transport.connect()
  return transport
}

function toSpacedHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

describe('WebSocketDebugTransport license function codes', () => {
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

  it('refuses both calls when the socket is not connected', async () => {
    const transport = new WebSocketDebugTransport({ host: '127.0.0.1', port: 8443, token: 'jwt' })

    await expect(transport.readLicense()).resolves.toEqual({ success: false, error: 'Not connected to target' })
    await expect(transport.writeLicense(new Uint8Array(98))).resolves.toEqual({
      success: false,
      error: 'Not connected to target',
    })
  })
})
