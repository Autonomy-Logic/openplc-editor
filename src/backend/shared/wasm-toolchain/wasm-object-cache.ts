import type { CachedWasmObject, WasmObjectCache } from './compile-to-wasm'

/**
 * Session cache of compiled objects, bounded by total bytes. The least recently used objects go first, so the
 * units that keep being reused, such as runtime and library sources, stay.
 */
export class BoundedWasmObjectCache implements WasmObjectCache {
  private readonly entries = new Map<string, CachedWasmObject>()
  private bytes = 0

  constructor(readonly maxBytes: number) {}

  get size(): number {
    return this.entries.size
  }

  get totalBytes(): number {
    return this.bytes
  }

  get(key: string): CachedWasmObject | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    // Re-insert so iteration order is least recently used first.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, entry: CachedWasmObject): this {
    const previous = this.entries.get(key)
    if (previous !== undefined) {
      this.entries.delete(key)
      this.bytes -= previous.object.byteLength
    }
    if (entry.object.byteLength > this.maxBytes) return this
    this.entries.set(key, entry)
    this.bytes += entry.object.byteLength
    for (const [oldestKey, oldest] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      this.entries.delete(oldestKey)
      this.bytes -= oldest.object.byteLength
    }
    return this
  }
}
