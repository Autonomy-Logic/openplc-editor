/**
 * The socket side of a debug session: accept connections, frame NDJSON, hand
 * each request to the one `SessionCore`.
 *
 * Concurrent clients are allowed on purpose — a human in the REPL and a script
 * polling the same session are a normal combination, and the alternative
 * (exclusive ownership) would make `debug list` useless while a REPL is open.
 * Requests are serialised through a promise chain rather than run in parallel:
 * the debug channel is a single request/response link, and two overlapping
 * reads on it interleave frames and corrupt both replies.
 */

import { createServer, type Server, type Socket } from 'node:net'

import { ErrorCode } from '../exit-codes'
import { decodeRequest, encodeMessage, type Response, splitLines } from './protocol'
import type { SessionCore } from './session-core'

export interface SessionServerOptions {
  core: SessionCore
  socketPath: string
  /** Called after a `close` request has been served, so the process can exit. */
  onClosed: () => void
  /** Idle timeout; 0 disables it. */
  idleTimeoutMs?: number
  onDiagnostic?: (message: string) => void
}

export class SessionServer {
  private readonly server: Server
  private readonly sockets = new Set<Socket>()
  /** Serialises work onto the single debug channel. */
  private queue: Promise<unknown> = Promise.resolve()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: SessionServerOptions) {
    this.server = createServer((socket) => this.accept(socket))
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.options.socketPath, () => {
        this.server.removeListener('error', reject)
        this.armIdleTimer()
        resolve()
      })
    })
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    let buffered = ''

    socket.on('data', (chunk: Buffer) => {
      const { lines, rest } = splitLines(buffered, chunk.toString('utf-8'))
      buffered = rest
      for (const line of lines) this.enqueue(socket, line)
    })

    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      this.sockets.delete(socket)
      this.armIdleTimer()
    })
  }

  /**
   * Chain each request behind the previous one.
   *
   * The chain never rejects: a failed request resolves to an error response, so
   * one bad call cannot poison the queue for everything after it.
   */
  private enqueue(socket: Socket, line: string): void {
    this.armIdleTimer()
    this.queue = this.queue.then(async () => {
      const request = decodeRequest(line)
      if (!request) {
        this.write(socket, {
          // The id is recovered BEFORE schema validation, because the client only
          // settles on a matching id. Answering `0` meant the client discarded
          // the error and blocked for its full 60 s timeout — reachable from
          // ordinary input: `debug watch x --interval abc` produces `NaN`, which
          // the schema rejects, so a typo looked like a hung session.
          id: recoverRequestId(line),
          ok: false,
          error: { code: ErrorCode.InvalidArgument, message: `Malformed request: ${line.slice(0, 200)}` },
        })
        return
      }
      const response = await this.options.core.handle(request)
      this.write(socket, response)
      if (request.kind === 'close') {
        // Let the reply reach the client before tearing the process down.
        setImmediate(() => this.shutdown())
      }
    })
  }

  private write(socket: Socket, response: Response): void {
    if (socket.destroyed) return
    socket.write(encodeMessage(response))
  }

  /**
   * An idle session is a leaked session. Without this, a test that crashes
   * between `open` and `close` leaves a process holding a debug channel — and
   * possibly forced outputs — until the machine reboots.
   */
  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const timeout = this.options.idleTimeoutMs ?? 0
    if (timeout <= 0) return
    this.idleTimer = setTimeout(() => {
      this.options.onDiagnostic?.(`Session idle for ${timeout} ms — closing`)
      void this.options.core.close(true).then(() => this.shutdown())
    }, timeout)
    this.idleTimer.unref()
  }

  shutdown(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server.close()
    this.options.onClosed()
  }
}

/**
 * The `id` of a line that failed validation, so the error can be addressed.
 *
 * Best effort by design: a line that is not even JSON has no id, and `0` is then
 * the honest answer — but the common case is a structurally valid request with
 * one bad field, where the id is right there.
 */
function recoverRequestId(line: string): number {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) return 0
    const record: Record<string, unknown> = { ...parsed }
    const id = record.id
    return typeof id === 'number' && Number.isFinite(id) ? id : 0
  } catch {
    return 0
  }
}
