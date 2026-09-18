/**
 * Ambient types for running pdf.js's worker code on the main thread instead
 * of a real Worker, and for the TC39-proposal APIs it calls that this repo's
 * `lib.d.ts` (TS 5.7) doesn't know about yet — see `ProjectPort.preparePdfPreviewWorker`'s
 * editor implementation in `project-adapter.ts` and `pdfjs-engine-polyfills.ts`.
 */

declare global {
  interface Window {
    pdfjsWorker?: { WorkerMessageHandler: unknown }
  }

  interface Uint8Array {
    toHex?(): string
    toBase64?(options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string
  }

  interface Uint8ArrayConstructor {
    fromBase64?(base64: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array
  }

  interface Map<K, V> {
    getOrInsert?(key: K, value: V): V
    getOrInsertComputed?(key: K, callbackfn: (key: K) => V): V
  }

  interface PromiseConstructor {
    try?<T, A extends readonly unknown[]>(callbackFn: (...args: A) => T | PromiseLike<T>, ...args: A): Promise<T>
  }
}

export {}
