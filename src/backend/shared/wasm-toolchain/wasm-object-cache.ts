import type { WasmObjectCache } from './compile-to-wasm'

/**
 * Session cache of compiled objects, bounded by total bytes. The least recently used objects go first, so the
 * units that keep being reused, such as runtime and library sources, stay.
 */
export class BoundedWasmObjectCache implements WasmObjectCache {
  private readonly entries = new Map<string, Uint8Array>()
  private bytes = 0

  constructor(readonly maxBytes: number) {}

  get size(): number {
    return this.entries.size
  }

  get totalBytes(): number {
    return this.bytes
  }

  get(key: string): Uint8Array | undefined {
    const object = this.entries.get(key)
    if (object === undefined) return undefined
    // Re-insert so iteration order is least recently used first.
    this.entries.delete(key)
    this.entries.set(key, object)
    return object
  }

  set(key: string, object: Uint8Array): this {
    const previous = this.entries.get(key)
    if (previous !== undefined) {
      this.entries.delete(key)
      this.bytes -= previous.byteLength
    }
    if (object.byteLength > this.maxBytes) return this
    this.entries.set(key, object)
    this.bytes += object.byteLength
    for (const [oldestKey, oldest] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      this.entries.delete(oldestKey)
      this.bytes -= oldest.byteLength
    }
    return this
  }
}
