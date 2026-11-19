/**
 * The HMI preview: builds screens, or one widget block, into a WebAssembly module and runs it in a Worker. Every
 * platform uses `createHmiPreviewPort` over its own mechanisms.
 */
import type {
  HmiBuildStep,
  HmiCatalogResult,
  HmiCodeContext,
  HmiLiveDetach,
  HmiLiveElement,
  HmiPointerKind,
  HmiPreviewBuild,
  HmiPreviewFrame,
  HmiPreviewRequest,
  HmiPreviewSurface,
  HmiSourceFile,
  HmiThumbnailResult,
  HmiUnitSources,
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
  /**
   * Applies a live property edit; false when the module has no such setter. With `element`, the setter is a factory
   * setter of that live element.
   */
  setNumber(screen: number, setter: number, value: number, element?: number): Promise<boolean>
  setText(screen: number, setter: number, value: string, element?: number): Promise<boolean>
  /**
   * Changes the shown screen's structure without a build: takes `detach` off, in order, then adds or puts back
   * `elements`, in order. Returns their element ids, or null when the module could not do it all. Changes last until
   * the next module starts or the screen is left.
   */
  change(detach: readonly HmiLiveDetach[], elements: readonly HmiLiveElement[]): Promise<number[] | null>
  /** Called when the running module stops: a fault in screen code, a crashed Worker or a call that took too long. */
  onStop(listener: (reason: string) => void): () => void
  close(): void
}

export interface HmiPreviewPort {
  /** Builds a preview module; `onStep` hears each step as it begins, up to `compile`. */
  build(request: HmiPreviewRequest, onStep?: (step: HmiBuildStep) => void): Promise<HmiPreviewBuild>
  /** What the ST language service and the code view need for screens and widget blocks. */
  codeContext(sources: Pick<HmiUnitSources, 'screens' | 'settings'>): Promise<HmiCodeContext>
  /** The widgets screens can use: StandardWidgets and the project's widget blocks. */
  catalog(widgets: readonly HmiSourceFile[]): Promise<HmiCatalogResult>
  /** The palette's widgets drawn by the core with test values, `scale` device pixels per logical unit. */
  thumbnails(
    sources: Pick<HmiUnitSources, 'widgets' | 'settings' | 'projectNames'>,
    scale: number,
  ): Promise<HmiThumbnailResult>
  openSession(): HmiPreviewSession
  /**
   * Keeps the WebAssembly toolchain loaded between builds while an HMI editor is open, and lets more than one worker
   * compile when the platform's memory allows; false lets it go.
   */
  holdToolchain(held: boolean): Promise<void>
}
