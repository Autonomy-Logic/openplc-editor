/**
 * License function codes (0x48/0x49/0x4A) over the runtime-v4 debug WebSocket.
 * Mocks socket.io-client so the test exercises the real PDU framing: builder ->
 * spaced-hex envelope -> canned runtime response -> parser. This is the editor
 * side of the transport-agnostic activation (D70c); the runtime answers these
 * FCs at the webserver level (covered by the runtime's pytest).
 */
import type { Socket } from 'socket.io-client'

import { WebSocketDebugTransport } from '../websocket-debug-transport'

type Handler = (arg: unknown) => void

/** Fake Socket.IO socket: auto-connects and answers debug_command with a canned
 *  response derived from the first PDU byte (the function code). */
function makeFakeSocket(responder: (commandHex: string) => { success: boolean; data?: string; error?: string }): Socket {
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

let currentResponder: (commandHex: string) => { success: boolean; data?: string; error?: string } = () => ({
  success: false,
  error: 'no responder',
})

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => makeFakeSocket((cmd) => currentResponder(cmd))),
}))

async function connected(): Promise<WebSocketDebugTransport> {
  const t = new WebSocketDebugTransport({ host: '127.0.0.1', port: 8443, token: 'jwt' })
  await t.connect()
  return t
}

describe('WebSocketDebugTransport license function codes', () => {
  it('getBoardId (0x48) sends the PDU and parses the raw anchor bytes', async () => {
    const sent: string[] = []
    currentResponder = (cmd) => {
      sent.push(cmd)
      // [0x48][SUCCESS=0x7E][len=4][DE AD BE EF]
      return { success: true, data: '48 7E 04 DE AD BE EF' }
    }
    const t = await connected()
    const res = await t.getBoardId()
    expect(sent[0]).toBe('48') // buildGetBoardIdRequest -> single-byte PDU
    expect(res.success).toBe(true)
    expect(Array.from(res.boardId ?? [])).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('readLicense (0x4A) maps LIC_EMPTY to a valid empty state', async () => {
    currentResponder = () => ({ success: true, data: '4A 83' }) // LIC_EMPTY
    const t = await connected()
    const res = await t.readLicense()
    expect(res.success).toBe(true)
    expect(res.empty).toBe(true)
  })

  it('readLicense (0x4A) parses a full 98-byte blob on SUCCESS', async () => {
    const blob = new Uint8Array(98)
    for (let i = 0; i < blob.length; i++) blob[i] = i & 0xff
    const bytes = [0x4a, 0x7e, (98 >> 8) & 0xff, 98 & 0xff, ...blob]
    currentResponder = () => ({
      success: true,
      data: bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    })
    const t = await connected()
    const res = await t.readLicense()
    expect(res.success).toBe(true)
    expect(res.blob?.length).toBe(98)
    expect(Array.from(res.blob ?? [])).toEqual(Array.from(blob))
  })

  it('writeLicense (0x49) frames [FC][len:u16BE][blob] and parses SUCCESS', async () => {
    const sent: string[] = []
    currentResponder = (cmd) => {
      sent.push(cmd)
      return { success: true, data: '49 7E' } // SUCCESS
    }
    const t = await connected()
    const blob = new Uint8Array(98).fill(0xab)
    const res = await t.writeLicense(blob)
    const parts = sent[0].split(' ')
    expect(parts[0]).toBe('49')
    expect(parts[1]).toBe('00') // len high
    expect(parts[2]).toBe('62') // len low (98)
    expect(parts.length).toBe(3 + 98)
    expect(res.success).toBe(true)
  })
})
