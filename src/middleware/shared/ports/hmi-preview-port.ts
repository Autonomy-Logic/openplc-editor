/**
 * The HMI preview: builds a project's screens, or one widget block, into a WebAssembly module with the in-editor
 * toolchain and runs it in a Worker. Every platform uses the same implementation, `createHmiPreviewPort`, over its
 * own mechanisms (`hmi-preview-mechanisms.ts`).
 */
import type {
  HmiPointerKind,
  HmiPreviewBuild,
  HmiPreviewFrame,
  HmiPreviewRequest,
  HmiPreviewSurface,
} from './hmi-preview-types'

/** Where a module starts: its logical screen size, the page it shows and whether bounds include ports. */
export interface HmiPreviewStart {
  width: number
  height: number
  page: number
  design: boolean
}

/** One running preview. Calls reject once the module stopped; `onStop` says why. */
export interface HmiPreviewSession {
  /** Starts a built module. The module running before keeps answering until this one is ready, and stays if it fails. */
  load(wasm: Uint8Array, start: HmiPreviewStart): Promise<void>
  frame(timeMs: number, surface: HmiPreviewSurface): Promise<HmiPreviewFrame>
  show(page: number): Promise<void>
  resize(width: number, height: number): Promise<void>
  pointer(kind: HmiPointerKind, x: number, y: number): Promise<void>
  key(code: number): Promise<void>
  /** Applies a live property edit; false when the module has no such setter. */
  setNumber(screen: number, setter: number, value: number): Promise<boolean>
  setText(screen: number, setter: number, value: string): Promise<boolean>
  /** Called when the running module stops: a fault in screen code, a crashed Worker or a call that took too long. */
  onStop(listener: (reason: string) => void): () => void
  close(): void
}

export interface HmiPreviewPort {
  build(request: HmiPreviewRequest): Promise<HmiPreviewBuild>
  openSession(): HmiPreviewSession
}
