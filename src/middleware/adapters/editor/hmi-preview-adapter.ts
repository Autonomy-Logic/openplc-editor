/**
 * Desktop mechanisms of the HMI preview: the HMI sources, STruC++ runtime headers, files shipped with the compiled
 * objects and installed libraries read by the main process, the main process's WebAssembly toolchain, and a renderer Worker for each module. The port is the
 * shared one.
 */
import { createHmiPreviewPort } from '../../../backend/shared/hmi/preview/hmi-preview-port'
import type { HmiPreviewPort } from '../../shared/ports/hmi-preview-port'

/** The Worker bundle the renderer's webpack build emits next to the page (`hmi-preview-worker` entry). */
const WORKER_SCRIPT = 'hmi-preview-worker.js'

export function createEditorHmiPreviewAdapter(): HmiPreviewPort {
  return createHmiPreviewPort({
    readHmiSources: () => window.bridge.hmiPreviewReadSources(),
    readStrucppRuntimeHeaders: () => window.bridge.hmiPreviewReadRuntimeHeaders(),
    readShippedFile: (name) => window.bridge.hmiPreviewReadShipped(name),
    compileToWasm: (request) => window.bridge.wasmToolchainCompile(request),
    holdToolchain: (holder, held) => window.bridge.wasmToolchainHold(holder, held),
    loadLibraries: () => window.bridge.loadAllLibraries(),
    onLibrariesChanged: (listener) => window.bridge.onLibrariesChanged(listener),
    startWorker: () => new Worker(new URL(WORKER_SCRIPT, window.location.href), { name: 'hmi-preview' }),
  })
}
