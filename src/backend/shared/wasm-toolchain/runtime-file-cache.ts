import type { RuntimeFileStore, RuntimeFileStores } from '@root/middleware/shared/ports/runtime-file-cache-mechanisms'

import { DOWNLOAD_STALL_MS, type OpenDownload, readWithStallLimit } from './clang-worker-host'
import { prefetchFiles } from './runtime-download'

/** Prefix of every cache this app writes; no other cache of the origin is touched. */
export const RUNTIME_FILE_CACHE_PREFIX = 'openplc-runtime-files/'

/** One content-addressed set: the served folder (`wasm-toolchain-<12 hex>`, `python-runtime-<12 hex>`) and its file URLs. */
export interface RuntimeFileSet {
  folder: string
  urls: readonly string[]
}

/** What a worker needs to read a set from the store. */
export interface RuntimeFileCacheRef {
  name: string
  urls: string[]
}

const FOLDER = /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)-[0-9a-f]{12}$/

const STORED_EXTENSIONS: readonly string[] = ['.wasm', '.tar', '.webc', '.whl']

const WASMER_SDK_FOLDER = /\/python-runtime(?:-[0-9a-f]{12})?\/sdk\//

const ignore = (): void => undefined

/** The kind of a runtime file folder (`wasm-toolchain` of `wasm-toolchain-<12 hex>`); throws for any other name. */
function folderKind(folder: string): string {
  const match = FOLDER.exec(folder)
  if (!match) throw new Error(`Not a runtime file folder: ${folder}`)
  return match[1]
}

/** The cache name of a runtime file folder; throws `Not a runtime file folder: <folder>` for any other name. */
export const runtimeFileCacheName = (folder: string): string => {
  folderKind(folder)
  return `${RUNTIME_FILE_CACHE_PREFIX}${folder}`
}

/** Whether a cache name belongs to this app's runtime file caches. */
export const isRuntimeFileCacheName = (name: string): boolean => name.startsWith(RUNTIME_FILE_CACHE_PREFIX)

/** The path of an absolute URL, or `null` when it is not one. */
function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/** Files read back with `fetch` (`.wasm`, `.tar`, `.webc`, `.whl`); module scripts are left to the HTTP cache. */
export const isStoredRuntimeFile = (url: string): boolean => {
  const path = pathOf(url)
  if (path === null || WASMER_SDK_FOLDER.test(path)) return false
  return STORED_EXTENSIONS.some((extension) => path.endsWith(extension))
}

/** A cache reference from an untrusted message, or `null` when it is not one. */
export function parseRuntimeFileCacheRef(value: unknown): RuntimeFileCacheRef | null {
  if (typeof value !== 'object' || value === null) return null
  const name: unknown = Reflect.get(value, 'name')
  const urls: unknown = Reflect.get(value, 'urls')
  if (typeof name !== 'string' || !isRuntimeFileCacheName(name)) return null
  if (!Array.isArray(urls)) return null
  const copy: string[] = []
  for (const url of urls) {
    if (typeof url !== 'string') return null
    copy.push(url)
  }
  return { name, urls: copy }
}

/** The media type of a response: its `Content-Type` before any `;`, trimmed and lowercased, or `none`. */
function mediaTypeOf(response: Response): string {
  const header = response.headers.get('content-type')
  const type = header === null ? '' : header.split(';')[0].trim().toLowerCase()
  return type === '' ? 'none' : type
}

/** Why a downloaded response may not be stored, or `null` when it may. */
function admissionRefusal(url: string, response: Response): string | null {
  if (response.status !== 200) return `Could not download ${url} (HTTP ${response.status}).`
  if (response.type !== 'basic') return `Could not store ${url}: not a same-origin response (${response.type}).`
  const type = mediaTypeOf(response)
  if (type === 'text/html') return `Could not store ${url}: served as text/html.`
  if (pathOf(url)?.endsWith('.wasm') && type !== 'application/wasm') {
    return `Could not store ${url}: served as ${type}, not application/wasm.`
  }
  return null
}

export interface RuntimeFileCache {
  /**
   * Makes a set available: deletes older versions of the same set, downloads and stores each missing stored file (one
   * file at a time across every set), and reads the other files to their end for the HTTP cache. Without a usable
   * store it behaves like `prefetchFiles`. Rejects with today's download texts or an admission text.
   */
  store(set: RuntimeFileSet): Promise<void>
  /** The reference a worker's `init` message carries for this set (only the stored URLs). */
  ref(set: RuntimeFileSet): RuntimeFileCacheRef
  /** Deletes the set's cache, so the next `store` downloads it again; never rejects. */
  discard(set: RuntimeFileSet): Promise<void>
}

/** The opened cache of a set and its stored files that have no entry yet. */
interface OpenedSet {
  cache: RuntimeFileStore
  missing: string[]
}

/**
 * The Cache Storage store of one page: writes one stored file at a time through a FIFO queue, and stops storing for
 * good after a write fails.
 */
class StoringRuntimeFileCache implements RuntimeFileCache {
  private queue: Promise<void> = Promise.resolve()
  private storing = true

  constructor(
    private readonly stores: RuntimeFileStores | null,
    private readonly open: OpenDownload,
    private readonly stallMs: number,
  ) {}

  async store(set: RuntimeFileSet): Promise<void> {
    const name = runtimeFileCacheName(set.folder)
    const stored = set.urls.filter(isStoredRuntimeFile)
    const others = set.urls.filter((url) => !isStoredRuntimeFile(url))
    const stores = this.stores
    if (stores === null) {
      await prefetchFiles([...set.urls], this.open, this.stallMs)
      return
    }
    await Promise.all([
      prefetchFiles(others, this.open, this.stallMs),
      this.enqueue(() => this.writeSet(stores, name, folderKind(set.folder), stored)),
    ])
  }

  ref(set: RuntimeFileSet): RuntimeFileCacheRef {
    return { name: runtimeFileCacheName(set.folder), urls: set.urls.filter(isStoredRuntimeFile) }
  }

  async discard(set: RuntimeFileSet): Promise<void> {
    const name = runtimeFileCacheName(set.folder)
    if (this.stores === null) return
    try {
      await this.stores.delete(name)
    } catch {
      return
    }
  }

  /** Runs `job` after every job queued before it, whatever their outcome. */
  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job)
    this.queue = run.then(ignore, ignore)
    return run
  }

  /** Stores the missing files of one set, one at a time; reads them without storing when the store cannot be used. */
  private async writeSet(stores: RuntimeFileStores, name: string, kind: string, urls: string[]): Promise<void> {
    const opened = this.storing ? await this.openSet(stores, name, kind, urls) : null
    if (opened === null) {
      await prefetchFiles(urls, this.open, this.stallMs)
      return
    }
    for (const [index, url] of opened.missing.entries()) {
      if (!this.storing) {
        await prefetchFiles(opened.missing.slice(index), this.open, this.stallMs)
        return
      }
      await this.writeFile(opened.cache, url)
    }
  }

  /** Deletes older caches of the kind, opens the set's cache and lists its missing files; `null` on a store error. */
  private async openSet(
    stores: RuntimeFileStores,
    name: string,
    kind: string,
    urls: string[],
  ): Promise<OpenedSet | null> {
    try {
      const older = (await stores.keys()).filter(
        (key) => key !== name && key.startsWith(`${RUNTIME_FILE_CACHE_PREFIX}${kind}-`),
      )
      await Promise.all(older.map((key) => stores.delete(key).catch(() => false)))
      const cache = await stores.open(name)
      const missing: string[] = []
      for (const url of urls) {
        if (!(await cache.match(url))) missing.push(url)
      }
      return { cache, missing }
    } catch {
      return null
    }
  }

  /**
   * Downloads one file and stores the unmodified response once it is admitted, while its clone is read to the end
   * under the stall limit. A failed write stops storing and still counts the file as downloaded.
   */
  private async writeFile(cache: RuntimeFileStore, url: string): Promise<void> {
    const pending: { put: Promise<void> | null } = { put: null }
    const openAndPut: OpenDownload = async (target, signal) => {
      const response = await this.open(target, signal)
      const refusal = admissionRefusal(target, response)
      if (refusal !== null) {
        void response.body?.cancel().catch(ignore)
        throw new Error(refusal)
      }
      const copy = response.clone()
      pending.put = cache.put(target, response)
      return copy
    }
    try {
      await readWithStallLimit(url, openAndPut, ignore, this.stallMs)
    } catch (error) {
      void pending.put?.catch(ignore)
      throw error
    }
    try {
      await pending.put
    } catch {
      this.storing = false
    }
  }
}

/**
 * The page's runtime file store over Cache Storage.
 * @param stores The origin's Cache Storage, or `null` where there is none.
 * @param open The platform's transport, in its default cache mode.
 * @param options `stallMs`: how long one download may receive no bytes before it fails.
 */
export function createRuntimeFileCache(
  stores: RuntimeFileStores | null,
  open: OpenDownload,
  options: { stallMs?: number } = {},
): RuntimeFileCache {
  return new StoringRuntimeFileCache(stores, open, options.stallMs ?? DOWNLOAD_STALL_MS)
}

/** Whether a string parses as an absolute URL. */
function isAbsoluteUrl(text: string): boolean {
  try {
    return new URL(text).href.length > 0
  } catch {
    return false
  }
}

/** The URL a GET request asks for, or `null` for any other request. */
function getHref(input: RequestInfo | URL, init: RequestInit | undefined): string | null {
  if (typeof input === 'string') {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return null
    return isAbsoluteUrl(input) ? input : null
  }
  if (input instanceof URL) return (init?.method ?? 'GET').toUpperCase() === 'GET' ? input.href : null
  return (init?.method ?? input.method).toUpperCase() === 'GET' ? input.url : null
}

/** The HTTP cache's answer for `href`, or `undefined` when it has none, refuses the lookup or answers non-`ok`. */
async function httpCachedResponse(network: typeof fetch, href: string): Promise<Response | undefined> {
  try {
    const response = await network(href, { cache: 'only-if-cached', mode: 'same-origin' })
    return response.ok ? response : undefined
  } catch {
    return undefined
  }
}

/** The stored response for `href` in the cache `name`, or `undefined` on a miss or a store error. */
async function storedResponse(stores: RuntimeFileStores, name: string, href: string): Promise<Response | undefined> {
  try {
    return await (await stores.open(name)).match(href)
  } catch {
    return undefined
  }
}

/**
 * A `fetch` for a worker: a GET request for one of `ref.urls` is answered from the HTTP cache when it holds the file,
 * otherwise from the store when the entry is there; a miss, any other URL, a missing store or a store error goes to
 * `network` unchanged.
 */
export function createCacheFirstFetch(
  stores: RuntimeFileStores | null,
  ref: RuntimeFileCacheRef | null,
  network: typeof fetch,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = ref === null ? null : getHref(input, init)
    if (ref !== null && href !== null && ref.urls.includes(href)) {
      const hit =
        (await httpCachedResponse(network, href)) ?? (stores && (await storedResponse(stores, ref.name, href)))
      if (hit) return hit
    }
    return network(input, init)
  }
}
