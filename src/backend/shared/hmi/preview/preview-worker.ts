/**
 * The preview's worker script: runs one preview module and answers a session's requests (`HmiPreviewRequestMessage`)
 * with one reply each. A fault in the module is answered as an error; the session then stops the Worker.
 */
import type { HmiPreviewWorkerScope } from '../../../../middleware/shared/ports/hmi-preview-mechanisms'
import type {
  HmiLiveElement,
  HmiPointerKind,
  HmiPreviewReply,
  HmiPreviewRequestMessage,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import { HmiPreviewInstance } from './preview-instance'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPointerKind = (value: unknown): value is HmiPointerKind =>
  value === 'down' || value === 'move' || value === 'up'

const isInteger = (value: unknown): value is number => isNumber(value) && Number.isInteger(value)

/** A live element's input values, or null when one is malformed. */
function parseValues<T extends number | string>(
  value: unknown,
  isValue: (v: unknown) => v is T,
): Array<{ setter: number; value: T }> | null {
  if (!Array.isArray(value)) return null
  const values: Array<{ setter: number; value: T }> = []
  for (const entry of value) {
    if (!isRecord(entry) || !isInteger(entry.setter) || !isValue(entry.value)) return null
    values.push({ setter: entry.setter, value: entry.value })
  }
  return values
}

const isString = (value: unknown): value is string => typeof value === 'string'

function parseLiveElement(value: unknown): HmiLiveElement | null {
  if (!isRecord(value)) return null
  const { type, parent, parentKind, before, drawBefore } = value
  if (!isInteger(type) || !isInteger(before) || !isInteger(drawBefore) || !isRecord(parent)) return null
  if (parentKind !== 'stack' && parentKind !== 'diagram') return null
  const container = isInteger(parent.id) ? { id: parent.id } : isInteger(parent.added) ? { added: parent.added } : null
  const numbers = parseValues(value.numbers, isNumber)
  const texts = parseValues(value.texts, isString)
  if (!container || !numbers || !texts) return null
  return { type, parent: container, parentKind, before, drawBefore, numbers, texts }
}

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
    case 'setNumber': {
      const { screen, setter, element } = value
      if (!isNumber(screen) || !isNumber(setter) || !isNumber(value.value)) return null
      if (element !== undefined && !isInteger(element)) return null
      const request = { id, type: 'setNumber' as const, screen, setter, value: value.value }
      return element === undefined ? request : { ...request, element }
    }
    case 'setText': {
      const { screen, setter, element } = value
      if (!isNumber(screen) || !isNumber(setter) || typeof value.value !== 'string') return null
      if (element !== undefined && !isInteger(element)) return null
      const request = { id, type: 'setText' as const, screen, setter, value: value.value }
      return element === undefined ? request : { ...request, element }
    }
    case 'add': {
      if (!Array.isArray(value.elements)) return null
      const elements: HmiLiveElement[] = []
      for (const entry of value.elements) {
        const element = parseLiveElement(entry)
        if (!element) return null
        elements.push(element)
      }
      return { id, type: 'add', elements }
    }
    case 'remove':
      return Array.isArray(value.elements) && value.elements.every(isInteger)
        ? { id, type: 'remove', elements: value.elements.filter(isInteger) }
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
    case 'setNumber': {
      const { screen, setter, value, element } = request
      const applied =
        element === undefined
          ? instance.setNumber(screen, setter, value)
          : instance.setLiveNumber(element, setter, value)
      return { reply: { id, ok: true, applied }, transfer: [] }
    }
    case 'setText': {
      const { screen, setter, value, element } = request
      const applied =
        element === undefined ? instance.setText(screen, setter, value) : instance.setLiveText(element, setter, value)
      return { reply: { id, ok: true, applied }, transfer: [] }
    }
    case 'add':
      return { reply: { id, ok: true, added: instance.addLive(request.elements) ?? [] }, transfer: [] }
    case 'remove':
      instance.removeLive(request.elements)
      break
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
