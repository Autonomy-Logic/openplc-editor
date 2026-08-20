/**
 * The bridge `CompilerModule.compileProgram` expects, implemented for the CLI.
 *
 * The compiler asks its host for three things: authenticated runtime GETs, the
 * multipart program upload, and resolution of project-enabled library names to
 * parsed `.stlib` archives. In the GUI those come off `MainProcessBridge`; here
 * they come off `RuntimeRestClient` and the real `LibraryManagerModule`.
 *
 * Using the actual library manager matters more than it looks: it decides which
 * archives a compile links, and a CLI that resolved libraries differently would
 * compile a *different program* from the same sources — the kind of divergence
 * that makes a green test worthless.
 */

import { LibraryManagerModule } from '@root/backend/editor/library-manager'
import type { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'

/**
 * What the compile pipeline actually needs from its progress channel.
 *
 * `compileProgram` only ever calls `start`, `postMessage` and `close` on the
 * Electron `MessagePortMain` it is handed, so a plain object satisfies the
 * contract structurally — no message channel and no cast required.
 */
export interface CompileProgressChannel {
  start(): void
  postMessage(message: unknown): void
  close(): void
}

export function createProgressChannel(options: {
  onMessage: (message: unknown) => void
  onClose: () => void
}): CompileProgressChannel {
  let closed = false
  return {
    start: () => undefined,
    postMessage: (message: unknown) => {
      if (!closed) options.onMessage(message)
    },
    close: () => {
      if (closed) return
      closed = true
      options.onClose()
    },
  }
}

export interface HeadlessCompileBridge {
  makeRuntimeApiRequest: <T = void>(
    ipAddress: string,
    endpoint: string,
    responseParser?: (data: string) => T,
  ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
  makeRuntimeApiUpload: (opts: {
    ipAddress: string
    fileBuffer: Buffer
    filename: string
    contentType: string
    cleanBuild: boolean
    onUploadAccepted?: (responseBody: string) => void
  }) => Promise<{ success: true; data: string } | { success: false; error: string }>
  loadEnabledArchives: (enabledNames: string[]) => { archives: unknown[]; missing: string[] }
}

/**
 * `runtime` is null for a compile-only run: with no runtime address the compiler
 * never reaches the upload or status calls, and demanding credentials to build
 * artifacts would make `compile` require a device it does not touch.
 *
 * Every method below is a straight forward into `RuntimeApiClient` — the same
 * object `MainProcessBridge` hands the compiler in the GUI — so the compile
 * pipeline cannot tell which front end drove it.
 */
export function createHeadlessCompileBridge(runtime: RuntimeApiClient | null): HeadlessCompileBridge {
  const libraries = new LibraryManagerModule()

  const noRuntime = (): { success: false; error: string } => ({
    success: false,
    error: 'This compile was started without a runtime connection, so it cannot talk to a device',
  })

  return {
    makeRuntimeApiRequest(ipAddress, endpoint, responseParser) {
      if (!runtime) return Promise.resolve(noRuntime())
      return runtime.makeRuntimeApiRequest(ipAddress, endpoint, responseParser)
    },

    makeRuntimeApiUpload(opts) {
      if (!runtime) return Promise.resolve(noRuntime())
      return runtime.makeRuntimeApiUpload(opts)
    },

    loadEnabledArchives: (enabledNames) => libraries.loadEnabledArchives(enabledNames),
  }
}
