/**
 * LRU completion cache for AI inline completions.
 * Serves instant results on undo/redo or cursor repositioning.
 */
export class CompletionCache<V> {
  private readonly maxSize: number
  private readonly cache = new Map<string, V>()

  constructor(maxSize = 16) {
    this.maxSize = maxSize
  }

  get(key: string): V | undefined {
    const value = this.cache.get(key)
    if (value === undefined) return undefined

    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    // If key exists, delete so it moves to end
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict least recently used if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, value)
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

/**
 * Build a cache key from file URI and cursor offset.
 * Uses a hash of the prefix text for deduplication.
 */
export function buildCacheKey(fileUri: string, offset: number, prefixHash: string): string {
  return `${fileUri}:${offset}:${prefixHash}`
}

/**
 * Simple string hash for cache key generation.
 * Uses djb2 algorithm — fast and good enough for cache keys.
 */
export function hashString(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}
