import type { CachedWasmObject, WasmObjectCache } from './compile-to-wasm'

/** Objects kept per key: the preview, the palette gallery and a widget preview each build their own. */
export const WASM_OBJECT_VARIANTS = 4

/**
 * Session cache of compiled objects, bounded by total bytes, keeping up to `WASM_OBJECT_VARIANTS` objects per key, one
 * per content digest. The least recently used objects go first, so the units that keep being reused, such as runtime
 * and library sources, stay.
 */
export class BoundedWasmObjectCache implements WasmObjectCache {
  /** Every object by its content digest, least recently used first. */
  private readonly entries = new Map<string, { key: string; entry: CachedWasmObject }>()
  /** The digests kept under each key, least recently used first. */
  private readonly byKey = new Map<string, string[]>()
  private bytes = 0

  constructor(readonly maxBytes: number) {}

  get size(): number {
    return this.entries.size
  }

  get totalBytes(): number {
    return this.bytes
  }

  /** Every object kept under `key`, most recently used first; none is marked used until it is chosen. */
  variants(key: string): readonly CachedWasmObject[] {
    const digests = this.byKey.get(key) ?? []
    return digests.flatMap((digest) => this.entries.get(digest)?.entry ?? []).reverse()
  }

  /** Marks an object most recently used. */
  touch(digest: string): void {
    const kept = this.entries.get(digest)
    if (kept === undefined) return
    this.entries.delete(digest)
    this.entries.set(digest, kept)
    this.byKey.set(kept.key, [...(this.byKey.get(kept.key) ?? []).filter((d) => d !== digest), digest])
  }

  set(key: string, entry: CachedWasmObject): this {
    this.drop(entry.digest)
    if (entry.object.byteLength > this.maxBytes) return this
    for (let kept = this.byKey.get(key) ?? []; kept.length >= WASM_OBJECT_VARIANTS; kept = this.byKey.get(key) ?? [])
      this.drop(kept[0])
    this.entries.set(entry.digest, { key, entry })
    this.byKey.set(key, [...(this.byKey.get(key) ?? []), entry.digest])
    this.bytes += entry.object.byteLength
    for (const [oldest] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      this.drop(oldest)
    }
    return this
  }

  private drop(digest: string): void {
    const kept = this.entries.get(digest)
    if (kept === undefined) return
    this.entries.delete(digest)
    this.bytes -= kept.entry.object.byteLength
    const rest = (this.byKey.get(kept.key) ?? []).filter((d) => d !== digest)
    if (rest.length > 0) this.byKey.set(kept.key, rest)
    else this.byKey.delete(kept.key)
  }
}
