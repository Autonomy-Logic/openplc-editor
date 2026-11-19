/**
 * Compiled objects built with the application and shipped with it: an index naming each record with its SHA-256, and
 * the records in the store's format. They are read once per session into the session cache and never written to the
 * user's store; each is used, like any cached object, only while every file it was built from is unchanged.
 */
import type { WasmShippedObjectSource } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { sha256Hex } from './content-digest'
import { decodeObjectRecord, encodeObjectRecord, type StoredWasmObject } from './persistent-object-cache'

export const SHIPPED_OBJECTS_INDEX = 'index.json'
const FORMAT = 1
const RECORD_NAME = /^[0-9a-f]{64}\.obj$/
const DIGEST = /^[0-9a-f]{64}$/

export interface ShippedObjectsIndex {
  format: number
  toolchain: string
  records: Array<{ name: string; sha256: string }>
}

/** Whether `name` is a file a shipped object source may be asked for: the index or a record named by its digest. */
export const isShippedObjectName = (name: string): boolean => name === SHIPPED_OBJECTS_INDEX || RECORD_NAME.test(name)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The index in `text`, or null when it is not one of this format. */
export function parseShippedObjectsIndex(text: string): ShippedObjectsIndex | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.format !== FORMAT || typeof value.toolchain !== 'string') return null
  if (!Array.isArray(value.records)) return null
  const records: ShippedObjectsIndex['records'] = []
  for (const entry of value.records) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.sha256 !== 'string') return null
    if (!RECORD_NAME.test(entry.name) || !DIGEST.test(entry.sha256)) return null
    records.push({ name: entry.name, sha256: entry.sha256 })
  }
  return { format: FORMAT, toolchain: value.toolchain, records }
}

/** The files of a shipped set: every record by its name, and the index naming them. */
export async function encodeShippedObjects(
  toolchain: string,
  objects: readonly StoredWasmObject[],
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  const index: ShippedObjectsIndex = { format: FORMAT, toolchain, records: [] }
  for (const { key, entry } of objects) {
    const name = `${entry.digest}.obj`
    if (files[name]) continue
    const record = await encodeObjectRecord(toolchain, key, entry)
    files[name] = record
    index.records.push({ name, sha256: await sha256Hex(record) })
  }
  index.records.sort((a, b) => (a.name < b.name ? -1 : 1))
  files[SHIPPED_OBJECTS_INDEX] = new TextEncoder().encode(`${JSON.stringify(index, null, 1)}\n`)
  return files
}

/**
 * The shipped objects `toolchain` can use. A set built for another toolchain, a record the index does not name, one
 * whose bytes do not match the index, or one that is damaged is left out.
 */
export async function readShippedObjects(
  source: WasmShippedObjectSource,
  toolchain: string,
): Promise<StoredWasmObject[]> {
  const raw = await source.read(SHIPPED_OBJECTS_INDEX)
  const index = raw === null ? null : parseShippedObjectsIndex(new TextDecoder().decode(raw))
  if (index === null || index.toolchain !== toolchain) return []
  const loaded = await Promise.all(
    index.records.map(async ({ name, sha256 }) => {
      const record = await source.read(name)
      if (record === null || (await sha256Hex(record)) !== sha256) return null
      const stored = await decodeObjectRecord(toolchain, record)
      return stored && `${stored.entry.digest}.obj` === name ? stored : null
    }),
  )
  return loaded.flatMap((stored) => (stored ? [stored] : []))
}
