/**
 * A running preview module (`resources/sources/hmi/preview/hmi_preview_host.cpp`): one viewer of the HMI unit, its
 * input and its frames. It runs where it is created; the preview runs it inside a Worker.
 */

import type {
  HmiPointerKind,
  HmiPreviewBounds,
  HmiPreviewPixels,
} from '../../../../middleware/shared/ports/hmi-preview-types'

/** Pointer kinds of the core (`HMI_PTR_*` in `hmi_core.h`). */
export const HMI_POINTER: Record<HmiPointerKind, number> = { down: 0, move: 1, up: 2 }

type NumericFunction = (...args: number[]) => number

/** The host's exports the preview calls. */
interface HostFunctions {
  hmi_pv_init: NumericFunction
  hmi_pv_resize: NumericFunction
  hmi_pv_design: NumericFunction
  hmi_pv_show: NumericFunction
  hmi_pv_page: NumericFunction
  hmi_pv_frame: NumericFunction
  hmi_pv_status: NumericFunction
  hmi_pv_render: NumericFunction
  hmi_pv_dirty_y0: NumericFunction
  hmi_pv_dirty_rows: NumericFunction
  hmi_pv_pointer: NumericFunction
  hmi_pv_key: NumericFunction
  hmi_pv_bounds_count: NumericFunction
  hmi_pv_bounds: NumericFunction
  hmi_pv_set_num: NumericFunction
  hmi_pv_text: NumericFunction
  hmi_pv_set_str: NumericFunction
}

/** Longest text a STRING setter takes (`HMI_PV_TEXT_MAX`). */
const TEXT_MAX = 255
const WASI_MODULE = 'wasi_snapshot_preview1'
/** WASI's "function not supported": the preview has no files, clock or environment. */
const ENOSYS = 52
const Q4 = 16

/** A WASI import of the module, answered as not supported; leaving the module traps. */
function wasiStub(name: string): () => number {
  return () => {
    if (name === 'proc_exit') throw new Error('The preview module exited')
    return ENOSYS
  }
}

function numericFunction(value: unknown, name: string): NumericFunction {
  if (typeof value !== 'function') throw new Error(`The preview module has no ${name}`)
  return (...args: number[]): number => {
    const result: unknown = Reflect.apply(value, undefined, args)
    return typeof result === 'number' ? result : 0
  }
}

export class HmiPreviewInstance {
  private constructor(
    private readonly memory: WebAssembly.Memory,
    private readonly call: HostFunctions,
  ) {}

  /** Instantiates a preview module and starts its viewer on a width x height lu screen. */
  static async create(wasm: Uint8Array, width: number, height: number): Promise<HmiPreviewInstance> {
    const module = await WebAssembly.compile(wasm)
    const wasi: Record<string, () => number> = {}
    for (const entry of WebAssembly.Module.imports(module)) {
      if (entry.module !== WASI_MODULE || entry.kind !== 'function')
        throw new Error(`The preview module imports ${entry.module}.${entry.name}, which the preview does not provide`)
      wasi[entry.name] = wasiStub(entry.name)
    }
    const instance = await WebAssembly.instantiate(module, { [WASI_MODULE]: wasi })
    const { exports } = instance
    const memory = exports.memory
    if (!(memory instanceof WebAssembly.Memory)) throw new Error('The preview module exports no memory')
    const initialize = exports._initialize
    if (typeof initialize === 'function') numericFunction(initialize, '_initialize')()
    const bind = (name: keyof HostFunctions): NumericFunction => numericFunction(exports[name], name)
    const call: HostFunctions = {
      hmi_pv_init: bind('hmi_pv_init'),
      hmi_pv_resize: bind('hmi_pv_resize'),
      hmi_pv_design: bind('hmi_pv_design'),
      hmi_pv_show: bind('hmi_pv_show'),
      hmi_pv_page: bind('hmi_pv_page'),
      hmi_pv_frame: bind('hmi_pv_frame'),
      hmi_pv_status: bind('hmi_pv_status'),
      hmi_pv_render: bind('hmi_pv_render'),
      hmi_pv_dirty_y0: bind('hmi_pv_dirty_y0'),
      hmi_pv_dirty_rows: bind('hmi_pv_dirty_rows'),
      hmi_pv_pointer: bind('hmi_pv_pointer'),
      hmi_pv_key: bind('hmi_pv_key'),
      hmi_pv_bounds_count: bind('hmi_pv_bounds_count'),
      hmi_pv_bounds: bind('hmi_pv_bounds'),
      hmi_pv_set_num: bind('hmi_pv_set_num'),
      hmi_pv_text: bind('hmi_pv_text'),
      hmi_pv_set_str: bind('hmi_pv_set_str'),
    }
    const preview = new HmiPreviewInstance(memory, call)
    if (preview.call.hmi_pv_init(width, height) !== 0) throw new Error('The preview does not fit in memory')
    return preview
  }

  resize(width: number, height: number): void {
    this.call.hmi_pv_resize(width, height)
  }

  /** Design mode also records connection ports as bounds. */
  design(on: boolean): void {
    this.call.hmi_pv_design(on ? 1 : 0)
  }

  /** Shows a screen by page number from the next frame. */
  show(page: number): void {
    this.call.hmi_pv_show(page)
  }

  /** Runs one frame at timeMs; returns the page it showed and its HMI_STATUS_* flags. */
  frame(timeMs: number): { page: number; status: number } {
    this.call.hmi_pv_frame(timeMs >>> 0)
    return { page: this.call.hmi_pv_page(), status: this.call.hmi_pv_status() }
  }

  /** Rasterizes the last frame; null when nothing changed since the previous render. */
  render(width: number, height: number, scale: number, offsetX = 0, offsetY = 0): HmiPreviewPixels | null {
    const pointer = this.call.hmi_pv_render(width, height, Math.round(scale * 256), offsetX, offsetY)
    if (pointer === 0) throw new Error('The preview could not draw the frame')
    const rows = this.call.hmi_pv_dirty_rows()
    if (rows === 0) return null
    const y0 = this.call.hmi_pv_dirty_y0()
    const start = pointer + y0 * width * 4
    const rgba = new Uint8ClampedArray(this.memory.buffer.slice(start, start + rows * width * 4))
    return { width, height, y0, rows, rgba }
  }

  pointer(kind: HmiPointerKind, x: number, y: number): void {
    this.call.hmi_pv_pointer(HMI_POINTER[kind], Math.round(x * Q4), Math.round(y * Q4))
  }

  key(code: number): void {
    this.call.hmi_pv_key(code)
  }

  /** Bounds the last frame recorded, in logical units. */
  bounds(): HmiPreviewBounds[] {
    const count = this.call.hmi_pv_bounds_count()
    const data = new Int32Array(this.memory.buffer, this.call.hmi_pv_bounds(), count * 5)
    const bounds: HmiPreviewBounds[] = []
    for (let i = 0; i < count; i++) {
      const [id, x, y, w, h] = data.subarray(i * 5, i * 5 + 5)
      bounds.push({ id, x: x / Q4, y: y / Q4, width: w / Q4, height: h / Q4 })
    }
    return bounds
  }

  /** Sets a numeric or BOOL live property of a screen; false when it has no such setter. */
  setNumber(screen: number, setter: number, value: number): boolean {
    return this.call.hmi_pv_set_num(screen, setter, value) === 0
  }

  /** Sets a STRING live property of a screen, cut to TEXT_MAX bytes; false when it has no such setter. */
  setText(screen: number, setter: number, value: string): boolean {
    const bytes = new TextEncoder().encode(value).subarray(0, TEXT_MAX)
    const buffer = new Uint8Array(this.memory.buffer, this.call.hmi_pv_text(), TEXT_MAX + 1)
    buffer.set(bytes)
    buffer[bytes.length] = 0
    return this.call.hmi_pv_set_str(screen, setter) === 0
  }
}
