import type { CachedWasmObject, WasmObjectCache } from '../../compile-to-wasm'

/** An unbounded object cache that keeps every variant, for tests; `size` and `values` count unit objects, not modules. */
export class RecordingCache implements WasmObjectCache {
  readonly byKey = new Map<string, CachedWasmObject[]>()

  variants(key: string): readonly CachedWasmObject[] {
    return [...(this.byKey.get(key) ?? [])].reverse()
  }

  set(key: string, entry: CachedWasmObject): this {
    const kept = (this.byKey.get(key) ?? []).filter((e) => e.digest !== entry.digest)
    this.byKey.set(key, [...kept, entry])
    return this
  }

  /** Every unit object, linked modules left out. */
  values(): CachedWasmObject[] {
    return [...this.byKey.values()].flat().filter((e) => e.dependencies.length > 0)
  }

  /** Linked modules kept. */
  modules(): CachedWasmObject[] {
    return [...this.byKey.values()].flat().filter((e) => e.dependencies.length === 0)
  }

  get size(): number {
    return this.values().length
  }
}
