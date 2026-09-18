/**
 * The `CompileProgramTransport` for the headless CLI.
 *
 * The renderer's transport is backed by `window.bridge`; this one is backed by
 * the main-process modules the bridge itself delegates to. Same three calls,
 * same flow above them — so `openplc-cli compile` enters the orchestration a Build
 * click enters, board resolution and POU preprocessing included, rather than
 * reassembling the steps and drifting on them.
 */

import { CompilerModule } from '@root/backend/editor/compiler'
import { HardwareModule } from '@root/backend/editor/hardware'
import { LibraryManagerModule } from '@root/backend/editor/library-manager'
import type { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import type { CompileProgramTransport } from '@root/middleware/adapters/editor/compile-program-flow'
import type { StlibArchiveDTO } from '@root/middleware/shared/ports/library-port'

import { createHeadlessCompileBridge, createProgressChannel } from './headless-bridge'

/**
 * `runtime` is null for a compile-only run: with no address the pipeline never
 * reaches the upload or status calls, so `compile` needs no credentials and no
 * device.
 */
export function createCliCompileTransport(runtime: RuntimeApiClient | null): CompileProgramTransport {
  return {
    getAvailableBoards: () => new HardwareModule().getAvailableBoards(),

    loadAllLibraries: () => Promise.resolve<StlibArchiveDTO[]>(new LibraryManagerModule().loadAll()),

    runCompileProgram: (compileArgs, onMessage) => {
      // The renderer hands the pipeline a `MessagePortMain`; here a plain
      // object satisfies the same narrow contract. Completion is signalled by
      // the `closePort` message the flow already watches for, so the channel's
      // own close is forwarded as one.
      const channel = createProgressChannel({
        onMessage: (message: unknown) => {
          if (typeof message === 'object' && message !== null) onMessage({ ...message })
        },
        onClose: () => onMessage({ closePort: true }),
      })

      void new CompilerModule()
        .compileProgram(compileArgs, channel, createHeadlessCompileBridge(runtime))
        .catch((error: unknown) => {
          onMessage({ logLevel: 'error', message: error instanceof Error ? error.message : String(error) })
          channel.close()
        })
    },
  }
}
