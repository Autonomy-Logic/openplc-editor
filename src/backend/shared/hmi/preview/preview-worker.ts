/**
 * The preview's worker script: runs one preview module and answers a session's requests (`HmiPreviewRequestMessage`)
 * with one reply each. A fault in the module is answered as an error; the session then stops the Worker.
 */
import type { HmiPreviewWorkerScope } from '../../../../middleware/shared/ports/hmi-preview-mechanisms'
import type {
  HmiPointerKind,
  HmiPreviewReply,
  HmiPreviewRequestMessage,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import { HmiPreviewInstance } from './preview-instance'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPointerKind = (value: unknown): value is HmiPointerKind =>
  value === 'down' || value === 'move' || value === 'up'

/** Checks a message that crossed the Worker boundary. */
export function parseHmiPreviewRequest(value: unknown): HmiPreviewRequestMessage | null {
  if (!isRecord(value) || !isNumber(value.id)) return null
  const { id } = value
  switch (value.type) {
    case 'load': {
      const { wasm, width, height, page, design } = value
      if (!ArrayBuffer.isView(wasm) || !isNumber(width) || !isNumber(height) || !isNumber(page)) return null
      const bytes = new Uint8Array(wasm.buffer, wasm.byteOffset, wasm.byteLength)
      return { id, type: 'load', wasm: bytes, width, height, page, design: design === true }
    }
    case 'frame': {
      const { timeMs, surface } = value
      if (!isNumber(timeMs) || !isRecord(surface)) return null
      const { width, height, scale } = surface
      if (!isNumber(width) || !isNumber(height) || !isNumber(scale)) return null
      return { id, type: 'frame', timeMs, surface: { width, height, scale } }
    }
    case 'show':
      return isNumber(value.page) ? { id, type: 'show', page: value.page } : null
    case 'resize':
      return isNumber(value.width) && isNumber(value.height)
        ? { id, type: 'resize', width: value.width, height: value.height }
        : null
    case 'pointer':
      return isPointerKind(value.kind) && isNumber(value.x) && isNumber(value.y)
        ? { id, type: 'pointer', kind: value.kind, x: value.x, y: value.y }
        : null
    case 'key':
      return isNumber(value.code) ? { id, type: 'key', code: value.code } : null
    case 'setNumber':
      return isNumber(value.screen) && isNumber(value.setter) && isNumber(value.value)
        ? { id, type: 'setNumber', screen: value.screen, setter: value.setter, value: value.value }
        : null
    case 'setText':
      return isNumber(value.screen) && isNumber(value.setter) && typeof value.value === 'string'
        ? { id, type: 'setText', screen: value.screen, setter: value.setter, value: value.value }
        : null
    default:
      return null
  }
}

/** Answers one request; throws when the module faults or is not loaded. */
async function answer(
  state: { instance: HmiPreviewInstance | null },
  request: HmiPreviewRequestMessage,
): Promise<{ reply: HmiPreviewReply; transfer: Transferable[] }> {
  const { id } = request
  if (request.type === 'load') {
    const instance = await HmiPreviewInstance.create(request.wasm, request.width, request.height)
    instance.design(request.design)
    instance.show(request.page)
    state.instance = instance
    return { reply: { id, ok: true }, transfer: [] }
  }
  const instance = state.instance
  if (!instance) throw new Error('No preview module is loaded')
  switch (request.type) {
    case 'frame': {
      const { page, status } = instance.frame(request.timeMs)
      const { width, height, scale } = request.surface
      const pixels = instance.render(width, height, scale)
      const frame = { page, status, pixels, bounds: instance.bounds() }
      return { reply: { id, ok: true, frame }, transfer: pixels ? [pixels.rgba.buffer] : [] }
    }
    case 'show':
      instance.show(request.page)
      break
    case 'resize':
      instance.resize(request.width, request.height)
      break
    case 'pointer':
      instance.pointer(request.kind, request.x, request.y)
      break
    case 'key':
      instance.key(request.code)
      break
    case 'setNumber':
      return {
        reply: { id, ok: true, applied: instance.setNumber(request.screen, request.setter, request.value) },
        transfer: [],
      }
    case 'setText':
      return {
        reply: { id, ok: true, applied: instance.setText(request.screen, request.setter, request.value) },
        transfer: [],
      }
  }
  return { reply: { id, ok: true }, transfer: [] }
}

/** Serves preview requests from `scope` until the Worker is terminated. */
export function serveHmiPreview(scope: HmiPreviewWorkerScope): void {
  const state: { instance: HmiPreviewInstance | null } = { instance: null }
  scope.addEventListener('message', (event) => {
    const request = parseHmiPreviewRequest(event.data)
    if (!request) {
      const id = isRecord(event.data) && isNumber(event.data.id) ? event.data.id : -1
      scope.postMessage({ id, ok: false, error: 'The preview received a request it does not understand' }, [])
      return
    }
    answer(state, request).then(
      ({ reply, transfer }) => scope.postMessage(reply, transfer),
      (error: unknown) =>
        scope.postMessage(
          {
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            fatal: error instanceof WebAssembly.RuntimeError,
          },
          [],
        ),
    )
  })
}
