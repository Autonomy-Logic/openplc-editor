/**
 * Compiled objects kept across sessions: a session cache filled from a platform store when the toolchain starts and
 * written through as objects are compiled, so a first build after a restart reuses what earlier sessions compiled.
 * Records of another toolchain, damaged records and the oldest records past the size bound are removed.
 */
import type { WasmObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import type { CachedWasmObject, WasmObjectCache } from './compile-to-wasm'
import { ContentHash } from './content-hash'

const RECORD_VERSION = 1
const HEADER_BYTES = 4

interface RecordHeader {
  version: number
  /** Identity of the toolchain that compiled the object. */
  toolchain: string
  dependencies: Array<[string, string]>
  includeNames: string[]
  shadowDigest: string
  /** Digest of the object bytes, so a damaged record is dropped. */
  objectDigest: string
}

const isStringPair = (value: unknown): value is [string, string] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function parseHeader(value: unknown): RecordHeader | null {
  if (!isRecord(value)) return null
  const { version, toolchain, dependencies, includeNames, shadowDigest, objectDigest } = value
  if (version !== RECORD_VERSION || typeof toolchain !== 'string') return null
  if (!Array.isArray(dependencies) || !dependencies.every(isStringPair)) return null
  if (!Array.isArray(includeNames) || !includeNames.every((n) => typeof n === 'string')) return null
  if (typeof shadowDigest !== 'string' || typeof objectDigest !== 'string') return null
  return { version: RECORD_VERSION, toolchain, dependencies, includeNames, shadowDigest, objectDigest }
}

/** A record: its header's length (4 bytes, little endian), the header as JSON, then the object. */
export function encodeObjectRecord(toolchain: string, entry: CachedWasmObject): Uint8Array {
  const header: RecordHeader = {
    version: RECORD_VERSION,
    toolchain,
    dependencies: entry.dependencies,
    includeNames: entry.includeNames,
    shadowDigest: entry.shadowDigest,
    objectDigest: new ContentHash().update(entry.object).digest(),
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const record = new Uint8Array(HEADER_BYTES + json.length + entry.object.length)
  new DataView(record.buffer).setUint32(0, json.length, true)
  record.set(json, HEADER_BYTES)
  record.set(entry.object, HEADER_BYTES + json.length)
  return record
}

/** The entry a record holds for `toolchain`; null for a record of another toolchain, a damaged one or another format. */
export function decodeObjectRecord(toolchain: string, record: Uint8Array): CachedWasmObject | null {
  if (record.length < HEADER_BYTES) return null
  const length = new DataView(record.buffer, record.byteOffset, record.byteLength).getUint32(0, true)
  if (HEADER_BYTES + length > record.length) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(record.subarray(HEADER_BYTES, HEADER_BYTES + length)))
  } catch {
    return null
  }
  const header = parseHeader(parsed)
  if (!header || header.toolchain !== toolchain) return null
  const object = record.slice(HEADER_BYTES + length)
  if (new ContentHash().update(object).digest() !== header.objectDigest) return null
  return {
    object,
    dependencies: header.dependencies,
    includeNames: header.includeNames,
    shadowDigest: header.shadowDigest,
  }
}

export class PersistentWasmObjectCache implements WasmObjectCache {
  /** Bytes of each stored record, oldest written first. */
  private readonly stored = new Map<string, number>()
  private storedBytes = 0
  private toolchain: string | null = null

  constructor(
    private readonly memory: WasmObjectCache,
    private readonly store: WasmObjectStore,
    readonly maxStoredBytes: number,
    private readonly onError: (message: string) => void = () => undefined,
  ) {}

  /**
   * Fills the session cache from the store with the records `toolchain` compiled, and removes the others. Objects set
   * before this are written only from here on.
   */
  async load(toolchain: string): Promise<void> {
    this.toolchain = toolchain
    const records = await this.store.readAll()
    const stale: string[] = []
    for (const [key, record] of records) {
      const entry = decodeObjectRecord(toolchain, record)
      if (!entry) {
        stale.push(key)
        continue
      }
      this.memory.set(key, entry)
      this.track(key, record.length)
    }
    await Promise.all(stale.map((key) => this.store.remove(key)))
    await this.trim()
  }

  get(key: string): CachedWasmObject | undefined {
    return this.memory.get(key)
  }

  set(key: string, entry: CachedWasmObject): this {
    this.memory.set(key, entry)
    if (this.toolchain === null) return this
    const record = encodeObjectRecord(this.toolchain, entry)
    if (record.length > this.maxStoredBytes) return this
    this.track(key, record.length)
    this.store
      .write(key, record)
      .then(() => this.trim())
      .catch((error: unknown) => this.onError(error instanceof Error ? error.message : String(error)))
    return this
  }

  private track(key: string, bytes: number): void {
    this.storedBytes -= this.stored.get(key) ?? 0
    this.stored.delete(key)
    this.stored.set(key, bytes)
    this.storedBytes += bytes
  }

  /** Removes the oldest records until the store is within its bound. */
  private async trim(): Promise<void> {
    const removed: string[] = []
    for (const [key, bytes] of this.stored) {
      if (this.storedBytes <= this.maxStoredBytes) break
      this.stored.delete(key)
      this.storedBytes -= bytes
      removed.push(key)
    }
    await Promise.all(removed.map((key) => this.store.remove(key)))
  }
}
