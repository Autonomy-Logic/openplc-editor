/**
 * Desktop mechanisms of the HMI preview: the HMI sources and STruC++ runtime headers read by the main process, the
 * main process's WebAssembly toolchain, and a renderer Worker for each module. The port is the shared one.
 */
import { createHmiPreviewPort } from '../../../backend/shared/hmi/preview/hmi-preview-port'
import type { HmiPreviewPort } from '../../shared/ports/hmi-preview-port'

/** The Worker bundle the renderer's webpack build emits next to the page (`hmi-preview-worker` entry). */
const WORKER_SCRIPT = 'hmi-preview-worker.js'

export function createEditorHmiPreviewAdapter(): HmiPreviewPort {
  return createHmiPreviewPort({
    readHmiSources: () => window.bridge.hmiPreviewReadSources(),
    readStrucppRuntimeHeaders: () => window.bridge.hmiPreviewReadRuntimeHeaders(),
    compileToWasm: (request) => window.bridge.wasmToolchainCompile(request),
    startWorker: () => new Worker(new URL(WORKER_SCRIPT, window.location.href), { name: 'hmi-preview' }),
  })
}
