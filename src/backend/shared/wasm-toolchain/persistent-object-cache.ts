/**
 * Compiled objects kept across sessions: a session cache filled from a platform store at startup and written through,
 * dropping other toolchains' records, damaged ones and the oldest past the size bound.
 */
import type { WasmObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import type { CachedWasmObject, WasmObjectCache } from './compile-to-wasm'
import { sha256Hex } from './content-digest'

const RECORD_VERSION = 2
const HEADER_BYTES = 4
const DIGEST = /^[0-9a-f]{64}$/

interface RecordHeader {
  version: number
  /** Identity of the toolchain that compiled the object. */
  toolchain: string
  /** The cache key the object was compiled under. */
  key: string
  /** The object's content digest; the record's own key in the store. */
  digest: string
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
  const { version, toolchain, key, digest, dependencies, includeNames, shadowDigest, objectDigest } = value
  if (version !== RECORD_VERSION || typeof toolchain !== 'string') return null
  if (typeof key !== 'string' || typeof digest !== 'string' || !DIGEST.test(digest)) return null
  if (!Array.isArray(dependencies) || !dependencies.every(isStringPair)) return null
  if (!Array.isArray(includeNames) || !includeNames.every((n) => typeof n === 'string')) return null
  if (typeof shadowDigest !== 'string' || typeof objectDigest !== 'string') return null
  return { version: RECORD_VERSION, toolchain, key, digest, dependencies, includeNames, shadowDigest, objectDigest }
}

/** An object as a record holds it: the entry and the key it was compiled under. */
export interface StoredWasmObject {
  key: string
  entry: CachedWasmObject
}

/** A record: its header's length (4 bytes, little endian), the header as JSON, then the object. */
export async function encodeObjectRecord(toolchain: string, key: string, entry: CachedWasmObject): Promise<Uint8Array> {
  const header: RecordHeader = {
    version: RECORD_VERSION,
    toolchain,
    key,
    digest: entry.digest,
    dependencies: entry.dependencies,
    includeNames: entry.includeNames,
    shadowDigest: entry.shadowDigest,
    objectDigest: await sha256Hex(entry.object),
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const record = new Uint8Array(HEADER_BYTES + json.length + entry.object.length)
  new DataView(record.buffer).setUint32(0, json.length, true)
  record.set(json, HEADER_BYTES)
  record.set(entry.object, HEADER_BYTES + json.length)
  return record
}

/** The object a record holds for `toolchain`; null for a record of another toolchain, a damaged one or another format. */
export async function decodeObjectRecord(toolchain: string, record: Uint8Array): Promise<StoredWasmObject | null> {
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
  if ((await sha256Hex(object)) !== header.objectDigest) return null
  return {
    key: header.key,
    entry: {
      object,
      digest: header.digest,
      dependencies: header.dependencies,
      includeNames: header.includeNames,
      shadowDigest: header.shadowDigest,
    },
  }
}

export class PersistentWasmObjectCache implements WasmObjectCache {
  /** Bytes of each stored record by its digest, oldest written first. */
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
    for (const [name, record] of records) {
      const stored = await decodeObjectRecord(toolchain, record)
      if (!stored || stored.entry.digest !== name) {
        stale.push(name)
        continue
      }
      this.memory.set(stored.key, stored.entry)
      this.track(name, record.length)
    }
    await Promise.all(stale.map((name) => this.store.remove(name)))
    await this.trim()
  }

  variants(key: string): readonly CachedWasmObject[] {
    return this.memory.variants(key)
  }

  touch(digest: string): void {
    this.memory.touch?.(digest)
  }

  set(key: string, entry: CachedWasmObject): this {
    this.memory.set(key, entry)
    const toolchain = this.toolchain
    if (toolchain === null) return this
    encodeObjectRecord(toolchain, key, entry)
      .then(async (record) => {
        if (record.length > this.maxStoredBytes) return
        this.track(entry.digest, record.length)
        await this.store.write(entry.digest, record)
        await this.trim()
      })
      .catch((error: unknown) => this.onError(error instanceof Error ? error.message : String(error)))
    return this
  }

  private track(name: string, bytes: number): void {
    this.storedBytes -= this.stored.get(name) ?? 0
    this.stored.delete(name)
    this.stored.set(name, bytes)
    this.storedBytes += bytes
  }

  /** Removes the oldest records until the store is within its bound. */
  private async trim(): Promise<void> {
    const removed: string[] = []
    for (const [name, bytes] of this.stored) {
      if (this.storedBytes <= this.maxStoredBytes) break
      this.stored.delete(name)
      this.storedBytes -= bytes
      removed.push(name)
    }
    await Promise.all(removed.map((name) => this.store.remove(name)))
  }
}
