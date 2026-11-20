/**
 * Compiled objects kept next to a library archive, make-style: one file per library and kind of build, keyed by the
 * archive's digest, its dependencies' digests, the toolchain, the unit's flags and the provided header versions. A file
 * whose key matches offers its object to the build, which still uses it only while every file it was built from is
 * unchanged; one that does not match, or is missing, is replaced by the object the build used.
 */
import type { WasmLibraryObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type {
  WasmCompileUnit,
  WasmLibraryObjectKind,
  WasmLibraryObjectTag,
} from '@root/middleware/shared/ports/wasm-toolchain-types'

import type { CachedWasmObject } from './compile-to-wasm'
import { digestParts } from './content-digest'
import { decodeObjectRecord, encodeObjectRecord, type StoredWasmObject } from './persistent-object-cache'

const FORMAT = 1
const MAGIC = 'openplc-library-object'
const HEADER_BYTES = 4

/** What a library object is built from, besides its own sources. */
export interface LibraryObjectKeyInput {
  kind: WasmLibraryObjectKind
  /** The archive as text (JSON). */
  archive: string
  /** The archives it depends on, as text, in the order the unit is generated with them. */
  dependencies: readonly string[]
  /** The unit's compile flags. */
  flags: readonly string[]
  /** Headers the build provides, `name@version`; the HMI core API version for HMI builds. */
  providedHeaders: readonly string[]
}

/** The key of a library's object: digest of the archive, its dependencies, the kind, flags and provided headers. */
export async function libraryObjectKey(input: LibraryObjectKeyInput): Promise<string> {
  return digestParts([
    'library-object',
    String(FORMAT),
    input.kind,
    input.archive,
    String(input.dependencies.length),
    ...input.dependencies,
    String(input.flags.length),
    ...input.flags,
    String(input.providedHeaders.length),
    ...input.providedHeaders,
  ])
}

interface LibraryObjectHeader {
  magic: string
  format: number
  key: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** A library object file: its header's length (4 bytes, little endian), the header as JSON, then an object record. */
export async function encodeLibraryObject(
  toolchain: string,
  libraryKey: string,
  unitKey: string,
  entry: CachedWasmObject,
): Promise<Uint8Array> {
  const header: LibraryObjectHeader = { magic: MAGIC, format: FORMAT, key: libraryKey }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const record = await encodeObjectRecord(toolchain, unitKey, entry)
  const bytes = new Uint8Array(HEADER_BYTES + json.length + record.length)
  new DataView(bytes.buffer).setUint32(0, json.length, true)
  bytes.set(json, HEADER_BYTES)
  bytes.set(record, HEADER_BYTES + json.length)
  return bytes
}

/**
 * The object a library object file holds when it was built by `toolchain` under `libraryKey`; null for any other key,
 * toolchain or format, and for a damaged file.
 */
export async function decodeLibraryObject(
  toolchain: string,
  libraryKey: string,
  bytes: Uint8Array,
): Promise<StoredWasmObject | null> {
  if (bytes.length < HEADER_BYTES) return null
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  if (HEADER_BYTES + length > bytes.length) return null
  let header: unknown
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + length)))
  } catch {
    return null
  }
  if (!isRecord(header) || header.magic !== MAGIC || header.format !== FORMAT || header.key !== libraryKey) return null
  return decodeObjectRecord(toolchain, bytes.subarray(HEADER_BYTES + length))
}

/** A unit with its library tag. */
type TaggedUnit = WasmCompileUnit & { library: WasmLibraryObjectTag }

const isTagged = (unit: WasmCompileUnit): unit is TaggedUnit => unit.library !== undefined

/** What `offerLibraryObjects` read, to tell `keepLibraryObjects` which files to replace. */
export interface OfferedLibraryObjects {
  /** Digest of the object read for each tagged unit's source; absent when none matched. */
  read: Map<string, string>
  tagged: TaggedUnit[]
}

/**
 * Reads the object next to each tagged unit's library and, when its key matches, hands it to `offer` (the session
 * cache). A store that fails to read counts as having no object.
 */
export async function offerLibraryObjects(
  units: readonly WasmCompileUnit[],
  store: WasmLibraryObjectStore,
  toolchain: string,
  offer: (stored: StoredWasmObject) => void,
): Promise<OfferedLibraryObjects> {
  const tagged = units.filter(isTagged)
  const read = new Map<string, string>()
  await Promise.all(
    tagged.map(async (unit) => {
      let bytes: Uint8Array | null
      try {
        bytes = await store.read(unit.library.name, unit.library.kind)
      } catch {
        bytes = null
      }
      const stored = bytes === null ? null : await decodeLibraryObject(toolchain, unit.library.key, bytes)
      if (!stored) return
      offer(stored)
      read.set(unit.source, stored.entry.digest)
    }),
  )
  return { read, tagged }
}

/**
 * Writes next to its library the object each tagged unit was built with, unless it is the one already there. `used`
 * gives a unit's cache key and object by source. Failures go to `warn`; the build never depends on them.
 */
export async function keepLibraryObjects(
  offered: OfferedLibraryObjects,
  used: ReadonlyMap<string, StoredWasmObject>,
  store: WasmLibraryObjectStore,
  toolchain: string,
  warn: (message: string) => void,
): Promise<void> {
  await Promise.all(
    offered.tagged.map(async (unit) => {
      const object = used.get(unit.source)
      if (!object || offered.read.get(unit.source) === object.entry.digest) return
      try {
        const bytes = await encodeLibraryObject(toolchain, unit.library.key, object.key, object.entry)
        await store.write(unit.library.name, unit.library.kind, bytes)
      } catch (error) {
        warn(
          `The compiled object of the library "${unit.library.name}" could not be kept: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }),
  )
}
