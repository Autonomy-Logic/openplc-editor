/** Test support of the preview runtime: the fixture module and a Worker that runs in this process. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  HmiPreviewWorkerHandle,
  HmiPreviewWorkerScope,
} from '../../../../../../middleware/shared/ports/hmi-preview-mechanisms'
import { serveHmiPreview } from '../../preview-worker'

/** fake-preview-host.c built to WebAssembly (`node tests/hmi-preview/build-fixture.mjs`). */
export const fakeHost = (): Uint8Array => new Uint8Array(readFileSync(join(__dirname, 'fake-preview-host.wasm')))

type Listener = (event: MessageEvent<unknown>) => void

/** Node has no ErrorEvent; this is the part of one a session reads. */
class TestErrorEvent extends Event implements ErrorEvent {
  readonly colno = 0
  readonly error: unknown = null
  readonly filename = ''
  readonly lineno = 0
  constructor(readonly message: string) {
    super('error')
  }
}

export interface TestWorker extends HmiPreviewWorkerHandle {
  terminated: boolean
  /** Raises the Worker's error event, as a crashed Worker does. */
  crash(message: string): void
  /** Delivers a message to the page as if the Worker sent it. */
  reply(data: unknown): void
}

/**
 * A Worker in this process: messages cross with structuredClone and transfers, asynchronously. `serve` false gives
 * a Worker that never answers.
 */
export function testWorker(serve = true): TestWorker {
  const toWorker: Listener[] = []
  const toPage: Listener[] = []
  const errors: Array<(event: ErrorEvent) => void> = []
  const deliver = (listeners: Listener[], message: unknown, transfer: Transferable[]) => {
    const data = structuredClone(message, { transfer })
    setTimeout(() => {
      if (!worker.terminated) for (const listener of listeners) listener(new MessageEvent('message', { data }))
    }, 0)
  }
  const scope: HmiPreviewWorkerScope = {
    postMessage: (message, transfer) => deliver(toPage, message, transfer),
    addEventListener: (_type, listener) => toWorker.push(listener),
  }
  if (serve) serveHmiPreview(scope)
  const worker: TestWorker = {
    terminated: false,
    postMessage: (message, transfer) => deliver(toWorker, message, transfer),
    addEventListener(...args: ['message', Listener] | ['error', (event: ErrorEvent) => void]) {
      if (args[0] === 'message') toPage.push(args[1])
      else errors.push(args[1])
    },
    terminate() {
      worker.terminated = true
    },
    crash(message) {
      for (const listener of errors) listener(new TestErrorEvent(message))
    },
    reply(data) {
      for (const listener of toPage) listener(new MessageEvent('message', { data }))
    },
  }
  return worker
}
