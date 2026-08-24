/**
 * A one-shot client: connect, send one request, read one response, exit.
 *
 * This is the shape every non-REPL debug command takes, and the reason the
 * session exists as a separate process. `openplc-cli debug read x --session <id>`
 * pays a unix-socket round trip, not a connect + MD5 verify + possible
 * re-upload — so a test can make fifty assertions without fifty reconnects.
 */

import { connect } from 'node:net'

import { decodeResponse, encodeMessage, type Request, type Response, splitLines } from './protocol'

const DEFAULT_TIMEOUT_MS = 60_000

export type SendResult =
  | { success: true; response: Response }
  /**
   * `unreachable` separates a daemon that is GONE (ENOENT / ECONNREFUSED — its
   * socket outlived it) from one that merely did not answer in time. Callers act
   * very differently: the first justifies deleting the session record, the second
   * must not, or a busy session loses the only handle for closing it.
   */
  | { success: false; error: string; unreachable: boolean }

/** Send one request to a live session and resolve with its reply. */
export function sendRequest(socketPath: string, request: Request, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false
    let buffered = ''

    const finish = (result: SendResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }

    const socket = connect(socketPath)

    const timer = setTimeout(
      () => finish({ success: false, error: `The session did not answer within ${timeoutMs} ms`, unreachable: false }),
      timeoutMs,
    )

    socket.on('connect', () => socket.write(encodeMessage(request)))

    socket.on('data', (chunk: Buffer) => {
      const { lines, rest } = splitLines(buffered, chunk.toString('utf-8'))
      buffered = rest
      for (const line of lines) {
        const response = decodeResponse(line)
        // Only our own reply settles this — a session serving several clients
        // could in principle write something else onto the wire.
        if (response && response.id === request.id) {
          finish({ success: true, response })
          return
        }
      }
    })

    socket.on('error', (error: NodeJS.ErrnoException) => {
      // ENOENT / ECONNREFUSED means the socket file outlived its process. The
      // registry reaps that on read, so the useful advice is to re-open.
      const hint =
        error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
          ? ' (the session is no longer listening — it may have exited; run `debug list`)'
          : ''
      finish({
        success: false,
        error: `${error.message}${hint}`,
        unreachable: error.code === 'ENOENT' || error.code === 'ECONNREFUSED',
      })
    })

    socket.on('close', () =>
      finish({ success: false, error: 'The session closed the connection without replying', unreachable: true }),
    )
  })
}
