/**
 * Streams and Response, which the test environment for the shared surface lacks.
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { DOWNLOAD_STALL_MS } from '../clang-worker-host'
import type { WasmToolchainReadiness } from '../prepare-toolchain'
import { prefetchFiles, startRuntimeDownload } from '../runtime-download'
import { silentBody, trackedBody } from './fixtures/download-bodies'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Lets every queued promise callback run. */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** Resolves after `ms` of real time. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('prefetchFiles', () => {
  const urls = [
    'https://editor.test/t/bundle.js',
    'https://editor.test/t/llvm.core.wasm',
    'https://editor.test/p/x.webc',
  ]

  it('opens every URL once and reads each body to its end', async () => {
    const opened: string[] = []
    const bodies = new Map(urls.map((url) => [url, trackedBody(['ab', 'cd', url])]))
    const open = (url: string): Promise<Response> => {
      opened.push(url)
      const tracked = bodies.get(url)
      return Promise.resolve(new Response(tracked?.body ?? null))
    }

    await prefetchFiles(urls, open)

    expect([...opened].sort()).toEqual([...urls].sort())
    expect(urls.map((url) => bodies.get(url)?.fullyRead())).toEqual([true, true, true])
  })

  it('resolves with nothing, keeping none of the bytes', async () => {
    const open = (url: string): Promise<Response> => Promise.resolve(new Response(encode(`bytes of ${url}`)))

    await expect(prefetchFiles(urls, open)).resolves.toBeUndefined()
  })

  it('resolves at once for an empty list', async () => {
    let opens = 0
    const open = (): Promise<Response> => {
      opens++
      return Promise.resolve(new Response('x'))
    }

    await expect(prefetchFiles([], open)).resolves.toBeUndefined()
    expect(opens).toBe(0)
  })

  it('rejects naming the URL that answered with an HTTP error', async () => {
    const open = (url: string): Promise<Response> =>
      Promise.resolve(url.endsWith('.wasm') ? new Response('missing', { status: 404 }) : new Response('ok'))

    await expect(prefetchFiles(urls, open)).rejects.toThrow(
      'Could not download https://editor.test/t/llvm.core.wasm (HTTP 404).',
    )
  })

  it('rejects naming the URL that sent no data for the stall limit it is given, and not before', async () => {
    const open = (url: string): Promise<Response> =>
      Promise.resolve(new Response(url.endsWith('.webc') ? silentBody() : encode('ok')))

    let settled = false
    const failure = prefetchFiles(urls, open, 1_000)
      .then(
        () => null,
        (reason: unknown) => reason,
      )
      .finally(() => {
        settled = true
      })
    await wait(500)
    expect(settled).toBe(false)

    const reason = await failure

    expect(reason).toBeInstanceOf(Error)
    expect(reason instanceof Error ? reason.message : '').toBe(
      'Download of https://editor.test/p/x.webc stalled: no data for 1 s.',
    )
  })

  it('stalls a download after 30 s without data by default', () => {
    expect(DOWNLOAD_STALL_MS).toBe(30_000)
  })
})

describe('startRuntimeDownload', () => {
  const ready: WasmToolchainReadiness = { ok: true, ms: 1 }

  it('starts both downloads before either finishes', async () => {
    const toolchain = deferred<WasmToolchainReadiness>()
    const python = deferred<void>()
    let toolchainStarts = 0
    let pythonStarts = 0

    const done = startRuntimeDownload(
      {
        toolchain: () => {
          toolchainStarts++
          return toolchain.promise
        },
        python: () => {
          pythonStarts++
          return python.promise
        },
      },
      () => undefined,
    )
    await flushMicrotasks()

    expect([toolchainStarts, pythonStarts]).toEqual([1, 1])
    toolchain.resolve(ready)
    python.resolve()
    await expect(done).resolves.toBeUndefined()
  })

  it('reports nothing when both downloads succeed', async () => {
    const reports: string[] = []

    await startRuntimeDownload(
      { toolchain: () => Promise.resolve(ready), python: () => Promise.resolve() },
      (message: string) => reports.push(message),
    )

    expect(reports).toEqual([])
  })

  it('never rejects, and reports each failure once with its reason', async () => {
    const reports: string[] = []
    const toolchainMessage =
      'The WebAssembly compiler could not be loaded: Could not download https://editor.test/t/llvm.core.wasm (HTTP 404).'

    const done = startRuntimeDownload(
      {
        toolchain: () => Promise.resolve({ ok: false, message: toolchainMessage }),
        python: () => Promise.reject(new Error('Could not download https://editor.test/p/x.webc (HTTP 404).')),
      },
      (message: string) => reports.push(message),
    )

    await expect(done).resolves.toBeUndefined()
    expect([...reports].sort()).toEqual(
      [
        toolchainMessage,
        'The Python runtime could not be downloaded: Could not download https://editor.test/p/x.webc (HTTP 404).',
      ].sort(),
    )
  })

  it('reports a toolchain step that throws as a compiler that could not be loaded', async () => {
    const reports: string[] = []

    await expect(
      startRuntimeDownload(
        {
          toolchain: () =>
            Promise.reject(new Error('Download of https://editor.test/t/bundle.js stalled: no data for 30 s.')),
          python: () => Promise.resolve(),
        },
        (message: string) => reports.push(message),
      ),
    ).resolves.toBeUndefined()

    expect(reports).toEqual([
      'The WebAssembly compiler could not be loaded: Download of https://editor.test/t/bundle.js stalled: no data for 30 s.',
    ])
  })

  it('still runs the Python download when the toolchain step fails at once', async () => {
    let pythonStarts = 0

    await startRuntimeDownload(
      {
        toolchain: () => Promise.reject(new Error('offline')),
        python: () => {
          pythonStarts++
          return Promise.resolve()
        },
      },
      () => undefined,
    )

    expect(pythonStarts).toBe(1)
  })
})
