/**
 * A preview session on the page: owns the Worker that runs the current module, bounds every call with a watchdog, and
 * swaps to a newly built module only once it has started, so the previous one keeps drawing while a build runs.
 */
import type { HmiPreviewWorkerHandle } from '../../../../middleware/shared/ports/hmi-preview-mechanisms'
import type { HmiPreviewSession, HmiPreviewStart } from '../../../../middleware/shared/ports/hmi-preview-port'
import type {
  HmiPreviewBounds,
  HmiPreviewFrame,
  HmiPreviewReply,
  HmiPreviewRequestMessage,
} from '../../../../middleware/shared/ports/hmi-preview-types'

export interface HmiPreviewSessionOptions {
  /** Longest a frame or input call may take before the module is stopped. */
  callTimeoutMs?: number
  /** Longest a module may take to start. */
  loadTimeoutMs?: number
}

export const HMI_PREVIEW_CALL_TIMEOUT_MS = 2000
export const HMI_PREVIEW_LOAD_TIMEOUT_MS = 20000

/** A request without its id: the channel numbers it. */
type Outgoing = HmiPreviewRequestMessage extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never

type Success = Extract<HmiPreviewReply, { ok: true }>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function parseReply(value: unknown): HmiPreviewReply | null {
  if (!isRecord(value) || typeof value.id !== 'number') return null
  if (value.ok === false) {
    return typeof value.error === 'string'
      ? { id: value.id, ok: false, error: value.error, fatal: value.fatal === true }
      : null
  }
  if (value.ok !== true) return null
  const reply: Success = { id: value.id, ok: true }
  if (typeof value.applied === 'boolean') reply.applied = value.applied
  const frame = parseFrame(value.frame)
  if (frame) reply.frame = frame
  return reply
}

const isBounds = (value: unknown): value is HmiPreviewBounds =>
  isRecord(value) &&
  typeof value.id === 'number' &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  typeof value.width === 'number' &&
  typeof value.height === 'number'

/** A frame from the Worker, its pixels as a view in this realm whatever realm made them. */
function parseFrame(value: unknown): HmiPreviewFrame | null {
  if (!isRecord(value) || typeof value.page !== 'number' || typeof value.status !== 'number') return null
  if (!Array.isArray(value.bounds) || !value.bounds.every(isBounds)) return null
  const frame = { page: value.page, status: value.status, bounds: value.bounds }
  const { pixels } = value
  if (pixels === null) return { ...frame, pixels: null }
  if (!isRecord(pixels) || !ArrayBuffer.isView(pixels.rgba)) return null
  const { width, height, y0, rows, rgba } = pixels
  if (typeof width !== 'number' || typeof height !== 'number' || typeof y0 !== 'number' || typeof rows !== 'number')
    return null
  const bytes = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  return { ...frame, pixels: { width, height, y0, rows, rgba: bytes } }
}

/** One Worker and the calls waiting for its replies. */
class Channel {
  private next = 1
  private readonly pending = new Map<
    number,
    { resolve: (reply: Success) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  stopped: string | null = null

  constructor(
    private readonly worker: HmiPreviewWorkerHandle,
    private readonly onFailure: (channel: Channel, reason: string) => void,
  ) {
    worker.addEventListener('message', (event) => this.receive(event.data))
    worker.addEventListener('error', (event) => this.fail(event.message || 'The preview worker failed'))
  }

  request(message: Outgoing, timeoutMs: number, transfer: Transferable[] = []): Promise<Success> {
    if (this.stopped !== null) return Promise.reject(new Error(this.stopped))
    const id = this.next++
    return new Promise<Success>((resolve, reject) => {
      const timer = setTimeout(() => this.fail('The preview stopped responding'), timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const request: HmiPreviewRequestMessage = { ...message, id }
      this.worker.postMessage(request, transfer)
    })
  }

  private receive(data: unknown): void {
    const reply = parseReply(data)
    if (!reply) return
    const waiting = this.pending.get(reply.id)
    if (!waiting) return
    this.pending.delete(reply.id)
    clearTimeout(waiting.timer)
    if (reply.ok) {
      waiting.resolve(reply)
      return
    }
    waiting.reject(new Error(reply.error))
    if (reply.fatal) this.fail(`The screen code stopped: ${reply.error}`)
  }

  /** Stops the Worker and fails every waiting call with `reason`. */
  fail(reason: string): void {
    if (this.stopped !== null) return
    this.close(reason)
    this.onFailure(this, reason)
  }

  close(reason = 'The preview was closed'): void {
    if (this.stopped !== null) return
    this.stopped = reason
    this.worker.terminate()
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error(reason))
    }
    this.pending.clear()
  }
}

export function createHmiPreviewSession(
  startWorker: () => HmiPreviewWorkerHandle,
  options: HmiPreviewSessionOptions = {},
): HmiPreviewSession {
  const callTimeout = options.callTimeoutMs ?? HMI_PREVIEW_CALL_TIMEOUT_MS
  const loadTimeout = options.loadTimeoutMs ?? HMI_PREVIEW_LOAD_TIMEOUT_MS
  const listeners = new Set<(reason: string) => void>()
  let current: Channel | null = null
  let closed = false

  const stopped = (channel: Channel, reason: string): void => {
    if (channel !== current) return
    current = null
    for (const listener of listeners) listener(reason)
  }
  const running = (): Channel => {
    if (!current) throw new Error(closed ? 'The preview was closed' : 'No preview module is running')
    return current
  }
  const call = async (message: Outgoing): Promise<Success> => running().request(message, callTimeout)

  return {
    async load(wasm: Uint8Array, start: HmiPreviewStart): Promise<void> {
      if (closed) throw new Error('The preview was closed')
      const channel = new Channel(startWorker(), stopped)
      const copy = wasm.slice()
      try {
        await channel.request({ type: 'load', wasm: copy, ...start }, loadTimeout, [copy.buffer])
      } catch (error) {
        channel.close()
        throw error
      }
      if (closed) {
        channel.close()
        throw new Error('The preview was closed')
      }
      current?.close('A newer preview replaced this one')
      current = channel
    },
    async frame(timeMs, surface) {
      const reply = await call({ type: 'frame', timeMs, surface })
      if (!reply.frame) throw new Error('The preview answered a frame without one')
      return reply.frame
    },
    async show(page) {
      await call({ type: 'show', page })
    },
    async resize(width, height) {
      await call({ type: 'resize', width, height })
    },
    async pointer(kind, x, y) {
      await call({ type: 'pointer', kind, x, y })
    },
    async key(code) {
      await call({ type: 'key', code })
    },
    async setNumber(screen, setter, value) {
      return (await call({ type: 'setNumber', screen, setter, value })).applied === true
    },
    async setText(screen, setter, value) {
      return (await call({ type: 'setText', screen, setter, value })).applied === true
    },
    onStop(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      current?.close()
      current = null
      listeners.clear()
    },
  }
}
