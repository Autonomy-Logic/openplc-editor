/**
 * LRU cache of async loads, bounded by a total weight.
 *
 * Concurrent `load` calls for the same key share one in-flight promise.
 * Only fulfilled values are stored; a rejection leaves nothing behind, so
 * the next `load` retries. The most recently stored entry is always kept,
 * even when its weight alone exceeds the bound.
 */

export interface PromiseLruCacheOptions<V> {
  maxWeight: number
  weigh: (value: V) => number
}

export interface PromiseLruCache<V> {
  load(key: string, loader: () => Promise<V>): Promise<V>
  delete(key: string): void
  deleteWhere(predicate: (key: string) => boolean): void
  clear(): void
  /** Number of fulfilled entries currently stored. */
  readonly size: number
}

export function createPromiseLruCache<V>({ maxWeight, weigh }: PromiseLruCacheOptions<V>): PromiseLruCache<V> {
  // Map iteration order is insertion order, so the first key is the least recently used.
  const entries = new Map<string, { value: V; weight: number }>()
  const inflight = new Map<string, Promise<V>>()
  let totalWeight = 0

  function remove(key: string): void {
    const entry = entries.get(key)
    if (entry) {
      totalWeight -= entry.weight
      entries.delete(key)
    }
    inflight.delete(key)
  }

  function store(key: string, value: V): void {
    const weight = weigh(value)
    entries.set(key, { value, weight })
    totalWeight += weight
    for (const oldest of entries.keys()) {
      if (totalWeight <= maxWeight || oldest === key) break
      remove(oldest)
    }
  }

  return {
    load(key, loader) {
      const entry = entries.get(key)
      if (entry) {
        entries.delete(key)
        entries.set(key, entry)
        return Promise.resolve(entry.value)
      }
      const pending = inflight.get(key)
      if (pending) return pending

      const promise: Promise<V> = loader().then(
        (value) => {
          // A delete/clear while in flight drops this result instead of resurrecting it.
          if (inflight.get(key) === promise) {
            inflight.delete(key)
            store(key, value)
          }
          return value
        },
        (err: unknown) => {
          if (inflight.get(key) === promise) inflight.delete(key)
          throw err
        },
      )
      inflight.set(key, promise)
      return promise
    },

    delete(key) {
      remove(key)
    },

    deleteWhere(predicate) {
      for (const key of [...entries.keys(), ...inflight.keys()]) {
        if (predicate(key)) remove(key)
      }
    },

    clear() {
      entries.clear()
      inflight.clear()
      totalWeight = 0
    },

    get size() {
      return entries.size
    },
  }
}
