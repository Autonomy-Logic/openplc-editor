/**
 * Streams and Response, which the test environment for the shared surface lacks.
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import type { OpenDownload } from '../clang-worker-host'
import {
  createCacheFirstFetch,
  createRuntimeFileCache,
  isRuntimeFileCacheName,
  isStoredRuntimeFile,
  parseRuntimeFileCacheRef,
  type RuntimeFileCacheRef,
  runtimeFileCacheName,
  type RuntimeFileSet,
} from '../runtime-file-cache'
import { basicResponse, silentBody } from './fixtures/download-bodies'
import { MemoryRuntimeFileStores, quotaExceeded } from './fixtures/memory-runtime-file-stores'

const TOOLCHAIN_FOLDER = 'wasm-toolchain-0123456789ab'
const PYTHON_FOLDER = 'python-runtime-0123456789ab'
const TOOLCHAIN_BASE = `https://editor.test/assets/${TOOLCHAIN_FOLDER}/`
const PYTHON_BASE = `https://editor.test/assets/${PYTHON_FOLDER}/`
const TOOLCHAIN_CACHE = `openplc-runtime-files/${TOOLCHAIN_FOLDER}`
const PYTHON_CACHE = `openplc-runtime-files/${PYTHON_FOLDER}`

const BUNDLE = `${TOOLCHAIN_BASE}bundle.js`
const RESOURCES = `${TOOLCHAIN_BASE}llvm-resources.tar`
const CORE = `${TOOLCHAIN_BASE}llvm.core.wasm`
const SDK_ENTRY = `${PYTHON_BASE}sdk/dist/index.js`
const SDK_WASM = `${PYTHON_BASE}sdk/pkg/wasmer_sdk_js_bg.wasm`
const SDK_SCRIPT = `${PYTHON_BASE}sdk/pkg/wasmer_sdk_js.js`
const PACKAGE = `${PYTHON_BASE}python-3.13.19.webc`
const WHEEL = `${PYTHON_BASE}numpy-2.3.2-cp313-cp313-wasix_wasm32.whl`

const toolchainSet: RuntimeFileSet = {
  folder: TOOLCHAIN_FOLDER,
  urls: [
    BUNDLE,
    RESOURCES,
    CORE,
    ...['llvm.core2.wasm', 'llvm.core3.wasm', 'llvm.core4.wasm'].map((name) => TOOLCHAIN_BASE + name),
  ],
}
const STORED_TOOLCHAIN = toolchainSet.urls.filter((url) => url !== BUNDLE)

const pythonSet: RuntimeFileSet = { folder: PYTHON_FOLDER, urls: [SDK_ENTRY, SDK_WASM, SDK_SCRIPT, PACKAGE, WHEEL] }
const STORED_PYTHON = [PACKAGE, WHEEL]
const STORED = new Set([...STORED_TOOLCHAIN, ...STORED_PYTHON])

const contentTypeOf = (url: string): string => {
  if (url.endsWith('.wasm')) return 'application/wasm'
  if (url.endsWith('.tar')) return 'application/x-tar'
  if (url.endsWith('.js')) return 'text/javascript'
  return 'application/octet-stream'
}

const servedText = (url: string): string => `bytes of ${url}`

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

/** A body that sends `text` in two chunks, one macrotask apart, and calls `onEnd` once it has sent everything. */
function servedBody(text: string, onEnd: () => void): ReadableStream<Uint8Array> {
  const chunks = [text.slice(0, 4), text.slice(4)]
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const chunk = chunks.shift()
        if (chunk !== undefined) {
          controller.enqueue(encode(chunk))
          return
        }
        onEnd()
        controller.close()
      },
    },
    { highWaterMark: 0 },
  )
}

/**
 * The page's transport over a same-origin server: each URL is answered with `bytes of <url>` and its type, unless
 * `answer` returns a response for it. Records every URL opened, the response given, which bodies were sent to their
 * end, and the most downloads of stored files in progress at once.
 */
function server(answer?: (url: string, signal: AbortSignal) => Response | undefined) {
  const opened: string[] = []
  const responses = new Map<string, Response>()
  const ended = new Set<string>()
  const state = { activeStored: 0, maxActiveStored: 0 }
  const open: OpenDownload = (url, signal) => {
    opened.push(url)
    const custom = answer?.(url, signal)
    if (custom) {
      responses.set(url, custom)
      return Promise.resolve(custom)
    }
    const stored = STORED.has(url)
    if (stored) {
      state.activeStored++
      state.maxActiveStored = Math.max(state.maxActiveStored, state.activeStored)
    }
    const body = servedBody(servedText(url), () => {
      ended.add(url)
      if (stored) state.activeStored--
    })
    const response = basicResponse(body, { status: 200, headers: { 'content-type': contentTypeOf(url) } })
    responses.set(url, response)
    return Promise.resolve(response)
  }
  return {
    open,
    opened,
    responses,
    state,
    fullyRead: (url: string) => ended.has(url),
    timesOpened: (url: string) => opened.filter((entry) => entry === url).length,
  }
}

const sorted = (urls: readonly string[]): string[] => [...urls].sort()

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

/** A network `fetch` that records its arguments and answers `from network`. */
function recordingNetwork() {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  const network = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push([input, init])
    return Promise.resolve(new Response('from network'))
  }
  return { network, calls }
}

describe('runtime file cache names', () => {
  it('names the cache of a folder under openplc-runtime-files/', () => {
    expect(runtimeFileCacheName('wasm-toolchain-0123456789ab')).toBe(
      'openplc-runtime-files/wasm-toolchain-0123456789ab',
    )
    expect(runtimeFileCacheName('python-runtime-0123456789ab')).toBe(
      'openplc-runtime-files/python-runtime-0123456789ab',
    )
  })

  it('tells the caches of this app from any other cache of the origin', () => {
    expect(isRuntimeFileCacheName('openplc-runtime-files/wasm-toolchain-0123456789ab')).toBe(true)
    expect(isRuntimeFileCacheName('workbox-precache-v1')).toBe(false)
  })

  it.each(['wasm-toolchain', 'wasm-toolchain-XYZ', 'wasm-toolchain-0123456789AB'])(
    'refuses the folder %s, which is not a kind and 12 lowercase hex digits',
    (folder) => {
      expect(() => runtimeFileCacheName(folder)).toThrow(`Not a runtime file folder: ${folder}`)
    },
  )

  it('refuses a set with such a folder in ref and store', async () => {
    const cache = createRuntimeFileCache(new MemoryRuntimeFileStores(), server().open)
    const set: RuntimeFileSet = { folder: 'wasm-toolchain', urls: [CORE] }

    expect(() => cache.ref(set)).toThrow('Not a runtime file folder: wasm-toolchain')
    await expect(cache.store(set)).rejects.toThrow('Not a runtime file folder: wasm-toolchain')
  })
})

describe('isStoredRuntimeFile', () => {
  it.each([
    `${TOOLCHAIN_BASE}llvm.core.wasm`,
    `${TOOLCHAIN_BASE}llvm.core2.wasm`,
    `${TOOLCHAIN_BASE}llvm.core3.wasm`,
    `${TOOLCHAIN_BASE}llvm.core4.wasm`,
    RESOURCES,
    PACKAGE,
    WHEEL,
  ])('stores %s, which a worker reads with fetch', (url) => {
    expect(isStoredRuntimeFile(url)).toBe(true)
  })

  it.each([
    SDK_WASM,
    'http://localhost/python-runtime/sdk/pkg/wasmer_sdk_js_bg.wasm',
    BUNDLE,
    SDK_ENTRY,
    SDK_SCRIPT,
    `${PYTHON_BASE}sdk/pkg/worker.mjs`,
    `${TOOLCHAIN_BASE}acorn.LICENSE`,
  ])('leaves %s to the HTTP cache', (url) => {
    expect(isStoredRuntimeFile(url)).toBe(false)
  })
})

describe('RuntimeFileCache ref and parseRuntimeFileCacheRef', () => {
  it('lists only the stored URLs of a set, in set order, under the set cache name', () => {
    const cache = createRuntimeFileCache(new MemoryRuntimeFileStores(), server().open)

    expect(cache.ref(toolchainSet)).toEqual({ name: TOOLCHAIN_CACHE, urls: STORED_TOOLCHAIN })
    expect(cache.ref(pythonSet)).toEqual({ name: PYTHON_CACHE, urls: STORED_PYTHON })
  })

  it('does not list the Wasmer SDK module of a Python set', () => {
    const cache = createRuntimeFileCache(new MemoryRuntimeFileStores(), server().open)

    expect(cache.ref(pythonSet).urls).not.toContain(SDK_WASM)
  })

  it('gives the same reference without a store', () => {
    const cache = createRuntimeFileCache(null, server().open)

    expect(cache.ref(toolchainSet)).toEqual({ name: TOOLCHAIN_CACHE, urls: STORED_TOOLCHAIN })
  })

  it('reads a valid reference into a copy', () => {
    const value = { name: TOOLCHAIN_CACHE, urls: [CORE, RESOURCES] }

    const parsed = parseRuntimeFileCacheRef(value)

    expect(parsed).toEqual(value)
    expect(parsed?.urls).not.toBe(value.urls)
  })

  it.each([
    ['a name outside the prefix', { name: 'workbox-precache-v1', urls: [CORE] }],
    ['a name that is not a string', { name: 1, urls: [CORE] }],
    ['urls that are not an array', { name: TOOLCHAIN_CACHE, urls: CORE }],
    ['a url that is not a string', { name: TOOLCHAIN_CACHE, urls: [CORE, 2] }],
    ['no object', null],
    ['a string', TOOLCHAIN_CACHE],
  ])('reads %s as no reference', (_label, value) => {
    expect(parseRuntimeFileCacheRef(value)).toBeNull()
  })
})

describe('RuntimeFileCache store', () => {
  it('deletes only the older caches of the same kind under the prefix', async () => {
    const stores = new MemoryRuntimeFileStores()
    stores.seed('openplc-runtime-files/wasm-toolchain-aaaaaaaaaaaa')
    stores.seed('openplc-runtime-files/python-runtime-bbbbbbbbbbbb')
    stores.seed('workbox-precache-v1')
    stores.seed(TOOLCHAIN_CACHE)

    await createRuntimeFileCache(stores, server().open).store(toolchainSet)

    expect(stores.deleted).toEqual(['openplc-runtime-files/wasm-toolchain-aaaaaaaaaaaa'])
    expect(stores.names()).toEqual(
      sorted(['openplc-runtime-files/python-runtime-bbbbbbbbbbbb', 'workbox-precache-v1', TOOLCHAIN_CACHE]),
    )
  })

  it('stores the files even when deleting an older cache fails', async () => {
    const stores = new MemoryRuntimeFileStores()
    stores.seed('openplc-runtime-files/wasm-toolchain-aaaaaaaaaaaa')
    stores.failures.delete = new Error('storage error')

    await expect(createRuntimeFileCache(stores, server().open).store(toolchainSet)).resolves.toBeUndefined()

    expect(stores.urlsIn(TOOLCHAIN_CACHE)).toEqual(sorted(STORED_TOOLCHAIN))
  })

  it('downloads each missing stored file once and stores it under its URL with the served bytes', async () => {
    const stores = new MemoryRuntimeFileStores()
    const served = server()

    await expect(createRuntimeFileCache(stores, served.open).store(toolchainSet)).resolves.toBeUndefined()

    expect(STORED_TOOLCHAIN.map(served.timesOpened)).toEqual(STORED_TOOLCHAIN.map(() => 1))
    expect(stores.urlsIn(TOOLCHAIN_CACHE)).toEqual(sorted(STORED_TOOLCHAIN))
    expect(STORED_TOOLCHAIN.map((url) => stores.textOf(TOOLCHAIN_CACHE, url))).toEqual(STORED_TOOLCHAIN.map(servedText))
  })

  it('stores the response it was served, not a copy', async () => {
    const stores = new MemoryRuntimeFileStores()
    const served = server()

    await createRuntimeFileCache(stores, served.open).store(toolchainSet)

    expect(sorted(stores.puts)).toEqual(sorted(STORED_TOOLCHAIN))
    expect(stores.putResponses.map((response, index) => response === served.responses.get(stores.puts[index]))).toEqual(
      stores.puts.map(() => true),
    )
  })

  it('does not download a stored file whose entry is already there', async () => {
    const stores = new MemoryRuntimeFileStores()
    stores.seed(TOOLCHAIN_CACHE, { [CORE]: 'stored core' })
    const served = server()

    await createRuntimeFileCache(stores, served.open).store(toolchainSet)

    expect(served.timesOpened(CORE)).toBe(0)
    expect(stores.puts).not.toContain(CORE)
    expect(stores.textOf(TOOLCHAIN_CACHE, CORE)).toBe('stored core')
  })

  it('downloads none of the stored files again on the next page load', async () => {
    const stores = new MemoryRuntimeFileStores()
    await createRuntimeFileCache(stores, server().open).store(toolchainSet)
    const reload = server()

    await createRuntimeFileCache(stores, reload.open).store(toolchainSet)

    expect(reload.opened).toEqual([BUNDLE])
  })

  it('reads bundle.js and the SDK scripts to their end and never stores them', async () => {
    const stores = new MemoryRuntimeFileStores()
    const served = server()
    const cache = createRuntimeFileCache(stores, served.open)

    await cache.store(toolchainSet)
    await cache.store(pythonSet)

    for (const url of [BUNDLE, SDK_ENTRY, SDK_SCRIPT]) {
      expect(served.timesOpened(url)).toBe(1)
      expect(served.fullyRead(url)).toBe(true)
    }
    expect(stores.puts.filter((url) => [BUNDLE, SDK_ENTRY, SDK_SCRIPT, SDK_WASM].includes(url))).toEqual([])
    expect(stores.urlsIn(PYTHON_CACHE)).toEqual(sorted(STORED_PYTHON))
  })

  it('writes one stored file at a time across two sets stored at once, and stores every one of them', async () => {
    const stores = new MemoryRuntimeFileStores()
    const served = server()
    const cache = createRuntimeFileCache(stores, served.open)

    await expect(Promise.all([cache.store(toolchainSet), cache.store(pythonSet)])).resolves.toEqual([
      undefined,
      undefined,
    ])

    expect(served.state.maxActiveStored).toBe(1)
    expect(stores.maxActivePuts).toBe(1)
    expect(stores.urlsIn(TOOLCHAIN_CACHE)).toEqual(sorted(STORED_TOOLCHAIN))
    expect(stores.urlsIn(PYTHON_CACHE)).toEqual(sorted(STORED_PYTHON))
  })

  it('rejects naming a stored file that sends no data for the stall limit, and leaves no entry for it', async () => {
    const stores = new MemoryRuntimeFileStores()
    const served = server((url, signal) =>
      url === CORE
        ? basicResponse(silentBody(signal), { status: 200, headers: { 'content-type': 'application/wasm' } })
        : undefined,
    )

    const reason = await createRuntimeFileCache(stores, served.open, { stallMs: 1_000 })
      .store(toolchainSet)
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(messageOf(reason)).toBe(`Download of ${CORE} stalled: no data for 1 s.`)
    expect(stores.urlsIn(TOOLCHAIN_CACHE)).not.toContain(CORE)
  })
})

describe('RuntimeFileCache admission', () => {
  const wasmType = { 'content-type': 'application/wasm' }

  it.each([
    [
      'a status that is not ok',
      CORE,
      () => basicResponse('missing', { status: 404, headers: wasmType }),
      `Could not download ${CORE} (HTTP 404).`,
    ],
    [
      'a status that is not ok, before the response type',
      CORE,
      () => new Response('missing', { status: 404, headers: wasmType }),
      `Could not download ${CORE} (HTTP 404).`,
    ],
    [
      'a response that is not same-origin',
      CORE,
      () => new Response('\0asm', { status: 200, headers: wasmType }),
      `Could not store ${CORE}: not a same-origin response (default).`,
    ],
    [
      'an HTML page answered with 200',
      RESOURCES,
      () => basicResponse('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      `Could not store ${RESOURCES}: served as text/html.`,
    ],
    [
      'an HTML page at a .wasm URL',
      CORE,
      () => basicResponse('<!doctype html>', { status: 200, headers: { 'content-type': 'Text/HTML' } }),
      `Could not store ${CORE}: served as text/html.`,
    ],
    [
      'a .wasm served as application/octet-stream',
      CORE,
      () => basicResponse('\0asm', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      `Could not store ${CORE}: served as application/octet-stream, not application/wasm.`,
    ],
    [
      'a .wasm served with no type',
      CORE,
      () => basicResponse(encode('\0asm'), { status: 200 }),
      `Could not store ${CORE}: served as none, not application/wasm.`,
    ],
  ])(
    'refuses %s, stores nothing for it, and downloads it again on the next store',
    async (_label, url, refusal, text) => {
      const stores = new MemoryRuntimeFileStores()
      let refuse = true
      const served = server((opened) => (refuse && opened === url ? refusal() : undefined))
      const cache = createRuntimeFileCache(stores, served.open)

      const reason = await cache.store(toolchainSet).then(
        () => null,
        (error: unknown) => error,
      )

      expect(messageOf(reason)).toBe(text)
      expect(stores.puts).not.toContain(url)
      expect(stores.urlsIn(TOOLCHAIN_CACHE)).not.toContain(url)

      refuse = false
      await expect(cache.store(toolchainSet)).resolves.toBeUndefined()

      expect(served.timesOpened(url)).toBe(2)
      expect(stores.textOf(TOOLCHAIN_CACHE, url)).toBe(servedText(url))
    },
  )

  it('admits a .wasm whose type differs only in case and parameters', async () => {
    const stores = new MemoryRuntimeFileStores()
    const served = server((url) =>
      url === CORE
        ? basicResponse('\0asm', { status: 200, headers: { 'content-type': 'Application/WASM; charset=binary' } })
        : undefined,
    )

    await expect(createRuntimeFileCache(stores, served.open).store(toolchainSet)).resolves.toBeUndefined()

    expect(stores.textOf(TOOLCHAIN_CACHE, CORE)).toBe('\0asm')
  })
})

describe('RuntimeFileCache without a usable store', () => {
  it.each([
    ['no store', null],
    ['a store that refuses to open', 'open'],
    ['a store whose keys reject', 'keys'],
    ['a store whose match rejects', 'match'],
  ] as const)('with %s, reads every file once, stores nothing and resolves', async (_label, failing) => {
    const stores = new MemoryRuntimeFileStores()
    if (failing) stores.failures[failing] = new Error('storage error')
    const served = server()

    await expect(
      createRuntimeFileCache(failing ? stores : null, served.open).store(toolchainSet),
    ).resolves.toBeUndefined()

    expect(sorted(served.opened)).toEqual(sorted(toolchainSet.urls))
    expect(toolchainSet.urls.map(served.fullyRead)).toEqual(toolchainSet.urls.map(() => true))
    expect(stores.puts).toEqual([])
  })

  it('stops storing after a write fails for lack of space, without reporting it', async () => {
    const stores = new MemoryRuntimeFileStores()
    stores.failures.put = quotaExceeded()
    const served = server()
    const cache = createRuntimeFileCache(stores, served.open)

    await expect(cache.store(toolchainSet)).resolves.toBeUndefined()
    await expect(cache.store(pythonSet)).resolves.toBeUndefined()

    expect(stores.puts).toHaveLength(1)
    expect(sorted(served.opened)).toEqual(sorted([...toolchainSet.urls, ...pythonSet.urls]))
    expect([...toolchainSet.urls, ...pythonSet.urls].map(served.fullyRead)).toEqual(
      [...toolchainSet.urls, ...pythonSet.urls].map(() => true),
    )
    expect(stores.urlsIn(TOOLCHAIN_CACHE)).toEqual([])
    expect(stores.urlsIn(PYTHON_CACHE)).toEqual([])
  })
})

describe('RuntimeFileCache discard', () => {
  it('deletes the cache of the set and no other', async () => {
    const stores = new MemoryRuntimeFileStores()
    stores.seed(TOOLCHAIN_CACHE, { [CORE]: 'broken core' })
    stores.seed(PYTHON_CACHE, { [PACKAGE]: 'package' })

    await createRuntimeFileCache(stores, server().open).discard(toolchainSet)

    expect(stores.names()).toEqual([PYTHON_CACHE])
  })

  it('resolves without a store', async () => {
    await expect(createRuntimeFileCache(null, server().open).discard(toolchainSet)).resolves.toBeUndefined()
  })

  it('resolves when the delete rejects', async () => {
    const stores = new MemoryRuntimeFileStores()
    stores.seed(TOOLCHAIN_CACHE)
    stores.failures.delete = new Error('storage error')

    await expect(createRuntimeFileCache(stores, server().open).discard(toolchainSet)).resolves.toBeUndefined()
  })
})

describe('createCacheFirstFetch', () => {
  const ref: RuntimeFileCacheRef = { name: TOOLCHAIN_CACHE, urls: [CORE, RESOURCES] }

  const storesWithCore = (): MemoryRuntimeFileStores => {
    const stores = new MemoryRuntimeFileStores()
    stores.seed(TOOLCHAIN_CACHE, { [CORE]: 'stored core', [BUNDLE]: 'stored bundle' })
    return stores
  }

  it.each([
    ['a string', () => CORE],
    ['a URL', () => new URL(CORE)],
    ['a GET Request', () => new Request(CORE)],
  ])('answers a listed URL given as %s from the store, without the network', async (_label, input) => {
    const { network, calls } = recordingNetwork()
    const stores = storesWithCore()
    const cacheFirst = createCacheFirstFetch(stores, ref, network)

    const response = await cacheFirst(input())

    expect(await response.text()).toBe('stored core')
    expect(calls).toEqual([])
    expect(stores.puts).toEqual([])
  })

  it.each([
    ['a URL', () => new URL(SDK_WASM)],
    ['a string', () => SDK_WASM],
  ])(
    'fetches the Wasmer SDK module, given as %s, from the network even when the store holds an entry for it',
    async (_label, input) => {
      const { network, calls } = recordingNetwork()
      const stores = new MemoryRuntimeFileStores()
      stores.seed(PYTHON_CACHE, { [SDK_WASM]: 'planted module', [PACKAGE]: 'stored package' })
      expect(pythonSet.urls).toContain(SDK_WASM)
      const pythonRef = createRuntimeFileCache(stores, server().open).ref(pythonSet)
      const cacheFirst = createCacheFirstFetch(stores, pythonRef, network)
      const request = input()

      const response = await cacheFirst(request)

      expect(await response.text()).toBe('from network')
      expect(calls).toHaveLength(1)
      expect(calls[0][0]).toBe(request)
    },
  )

  it.each([
    ['a listed URL with no entry', () => storesWithCore(), ref, () => RESOURCES],
    ['a URL the reference does not list, though the store holds it', () => storesWithCore(), ref, () => BUNDLE],
    [
      'a request that is not a GET',
      () => storesWithCore(),
      ref,
      () => new Request(CORE, { method: 'POST', body: 'x' }),
    ],
    ['no store', () => null, ref, () => CORE],
    ['no reference', () => storesWithCore(), null, () => CORE],
    [
      'a store that refuses to open',
      () => {
        const stores = storesWithCore()
        stores.failures.open = new Error('storage error')
        return stores
      },
      ref,
      () => new URL(CORE),
    ],
    [
      'a store whose match rejects',
      () => {
        const stores = storesWithCore()
        stores.failures.match = new Error('storage error')
        return stores
      },
      ref,
      () => CORE,
    ],
  ])('sends %s to the network with the original arguments', async (_label, stores, reference, input) => {
    const { network, calls } = recordingNetwork()
    const given = stores()
    const cacheFirst = createCacheFirstFetch(given, reference, network)
    const request = input()
    const init: RequestInit = { headers: { 'x-test': '1' } }

    const response = await cacheFirst(request, init)

    expect(await response.text()).toBe('from network')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(request)
    expect(calls[0][1]).toBe(init)
    expect(given?.puts ?? []).toEqual([])
  })
})
