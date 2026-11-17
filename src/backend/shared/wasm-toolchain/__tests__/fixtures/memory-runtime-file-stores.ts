import type { RuntimeFileStore, RuntimeFileStores } from '@root/middleware/shared/ports/runtime-file-cache-mechanisms'

import { basicResponse } from './download-bodies'

/** An operation of the in-memory stores a test can make reject. */
export type MemoryStoreOperation = 'open' | 'keys' | 'match' | 'put' | 'delete'

/** One stored response: its bytes, status and headers. */
interface StoredEntry {
  bytes: Uint8Array
  status: number
  headers: Headers
}

/** An error named `QuotaExceededError`, as a browser's `Cache.put` rejects with when the origin is out of space. */
export function quotaExceeded(): Error {
  const error = new Error('The quota has been exceeded.')
  error.name = 'QuotaExceededError'
  return error
}

/**
 * In-memory Cache Storage. `put` reads the body it is given to its end before the entry exists, `match` answers a
 * fresh copy each time, and each operation can be made to reject through `failures`. Records the deleted cache names,
 * every `put` call in order and the most `put` calls in progress at once.
 */
export class MemoryRuntimeFileStores implements RuntimeFileStores {
  /** The error each operation rejects with; an operation not listed succeeds. */
  failures: Partial<Record<MemoryStoreOperation, Error>> = {}
  /** The URL of every `put` call, in order, the rejected ones included. */
  readonly puts: string[] = []
  /** The response of every `put` call, in order. */
  readonly putResponses: Response[] = []
  /** Every cache name deleted through `delete`, in order. */
  readonly deleted: string[] = []
  activePuts = 0
  maxActivePuts = 0
  private readonly caches = new Map<string, Map<string, StoredEntry>>()

  open(name: string): Promise<RuntimeFileStore> {
    const failure = this.failures.open
    if (failure) return Promise.reject(failure)
    return Promise.resolve(this.storeOf(name))
  }

  keys(): Promise<string[]> {
    const failure = this.failures.keys
    if (failure) return Promise.reject(failure)
    return Promise.resolve([...this.caches.keys()])
  }

  delete(name: string): Promise<boolean> {
    const failure = this.failures.delete
    if (failure) return Promise.reject(failure)
    this.deleted.push(name)
    return Promise.resolve(this.caches.delete(name))
  }

  /** Creates the cache `name`, with an entry for each of `entries` (URL to text) when given. */
  seed(name: string, entries: Record<string, string> = {}, contentType = 'application/wasm'): void {
    const cache = this.caches.get(name) ?? new Map<string, StoredEntry>()
    for (const [url, text] of Object.entries(entries)) {
      cache.set(url, {
        bytes: new TextEncoder().encode(text),
        status: 200,
        headers: new Headers({ 'content-type': contentType }),
      })
    }
    this.caches.set(name, cache)
  }

  /** The cache names, sorted. */
  names(): string[] {
    return [...this.caches.keys()].sort()
  }

  /** The URLs stored in the cache `name`, sorted; empty when there is no such cache. */
  urlsIn(name: string): string[] {
    return [...(this.caches.get(name)?.keys() ?? [])].sort()
  }

  /** The text of the entry for `url` in the cache `name`, or `null` when there is none. */
  textOf(name: string, url: string): string | null {
    const entry = this.caches.get(name)?.get(url)
    return entry ? new TextDecoder().decode(entry.bytes) : null
  }

  private storeOf(name: string): RuntimeFileStore {
    const existing = this.caches.get(name)
    const cache = existing ?? new Map<string, StoredEntry>()
    if (!existing) this.caches.set(name, cache)
    return {
      match: (url: string) => this.match(cache, url),
      put: (url: string, response: Response) => this.put(cache, url, response),
      delete: (url: string) => this.deleteEntry(cache, url),
    }
  }

  private match(cache: Map<string, StoredEntry>, url: string): Promise<Response | undefined> {
    const failure = this.failures.match
    if (failure) return Promise.reject(failure)
    const entry = cache.get(url)
    if (!entry) return Promise.resolve(undefined)
    const init = { status: entry.status, headers: new Headers(entry.headers) }
    return Promise.resolve(basicResponse(entry.bytes.slice(), init))
  }

  private async put(cache: Map<string, StoredEntry>, url: string, response: Response): Promise<void> {
    this.puts.push(url)
    this.putResponses.push(response)
    this.activePuts++
    this.maxActivePuts = Math.max(this.maxActivePuts, this.activePuts)
    try {
      const bytes = new Uint8Array(await response.arrayBuffer())
      const failure = this.failures.put
      if (failure) throw failure
      cache.set(url, { bytes, status: response.status, headers: new Headers(response.headers) })
    } finally {
      this.activePuts--
    }
  }

  private deleteEntry(cache: Map<string, StoredEntry>, url: string): Promise<boolean> {
    const failure = this.failures.delete
    if (failure) return Promise.reject(failure)
    return Promise.resolve(cache.delete(url))
  }
}
