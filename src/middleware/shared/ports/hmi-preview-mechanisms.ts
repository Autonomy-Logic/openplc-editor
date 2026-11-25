/**
 * What a platform gives the HMI preview (`createHmiPreviewPort`): the files every preview compiles in, its WebAssembly
 * toolchain and a Worker to run modules in. Everything else is shared.
 */
import type { HmiPreviewReply, HmiPreviewRequestMessage } from './hmi-preview-types'
import type { WasmCompileRequest, WasmCompileResult } from './wasm-toolchain-types'

/** A Worker running the preview's worker script (`serveHmiPreview`): the part of a DOM Worker a session uses. */
export interface HmiPreviewWorkerHandle {
  postMessage(message: HmiPreviewRequestMessage, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  terminate(): void
}

/** The scope the worker script serves from: a DedicatedWorkerGlobalScope as the preview uses it. */
export interface HmiPreviewWorkerScope {
  postMessage(message: HmiPreviewReply, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

/** Files as the platform stores them: keyed by path, as text or bytes; `root` is the folder's prefix in those paths. */
export interface HmiPreviewStoredFiles {
  root: string
  files: Record<string, string | Uint8Array>
}

export interface HmiPreviewMechanisms {
  /** Every file under the HMI sources folder (`core/`, `unit/`, `preview/`, `fonts/`). */
  readHmiSources(): Promise<HmiPreviewStoredFiles>
  /** The STruC++ runtime headers (`iec_*.hpp`, ...), keyed by any path; only the file name counts. */
  readStrucppRuntimeHeaders(): Promise<Record<string, string>>
  /** One file shipped with the compiled objects, by name and verbatim, or null when there is no such file. */
  readShippedFile(name: string): Promise<Uint8Array | null>
  compileToWasm(request: WasmCompileRequest): Promise<WasmCompileResult>
  /** Holds the platform's WebAssembly toolchain for `holder`, or lets it go (`WasmCompileService.setHeld`). */
  holdToolchain(holder: string, held: boolean): Promise<void>
  /** Every installed library archive, verbatim, as the library port loads them; widget libraries are among them. */
  loadLibraries(): Promise<readonly unknown[]>
  /** Calls `listener` when a library is installed or removed; returns the unsubscribe. */
  onLibrariesChanged(listener: () => void): () => void
  /** Starts a Worker running the preview's worker script. */
  startWorker(): HmiPreviewWorkerHandle
}
