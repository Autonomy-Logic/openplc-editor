import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { EsiRowStore, EsiStoredRow } from '@root/middleware/shared/ports/esi-repository-mechanisms'
import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'

/** Returns the decoded text of the real vendor ESI `esi-real/<name>` under this fixture folder. */
export function readEsiFixture(name: string): string {
  return decodeXmlBytes(new Uint8Array(readFileSync(join(__dirname, 'esi-real', name))))
}

/**
 * An in-memory ESI row store and what it observed.
 *
 * @property store - The `EsiRowStore`; it only keeps what it is given.
 * @property rows - The stored rows, in insertion order.
 * @property xml - The stored XML text by row id.
 * @property updated - The ids passed to `update`, in call order.
 * @property lists - Returns the number of `list` calls so far.
 * @property xmlReads - Returns the number of `readXml` calls so far for the given id.
 */
export interface MemoryEsiStore {
  store: EsiRowStore
  rows: EsiStoredRow[]
  xml: Map<string, string>
  updated: string[]
  lists(): number
  xmlReads(id: string): number
}

/**
 * Creates an in-memory ESI row store that records the updated ids, the `list` calls and the
 * `readXml` calls per id.
 *
 * @returns The store, its rows and XML, and its recorded observations.
 */
export function createMemoryEsiStore(): MemoryEsiStore {
  const rows: EsiStoredRow[] = []
  const xml = new Map<string, string>()
  const updated: string[] = []
  const xmlReads: string[] = []
  let lists = 0
  const store: EsiRowStore = {
    list: () => {
      lists++
      return Promise.resolve(rows.map((r) => ({ ...r })))
    },
    insert: (row, text) => {
      rows.push(row)
      xml.set(row.id, text)
      return Promise.resolve(row)
    },
    update: (row) => {
      updated.push(row.id)
      rows.splice(
        rows.findIndex((r) => r.id === row.id),
        1,
        row,
      )
      return Promise.resolve()
    },
    remove: (id) => {
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      )
      xml.delete(id)
      return Promise.resolve()
    },
    clear: () => {
      rows.length = 0
      xml.clear()
      return Promise.resolve()
    },
    readXml: (id) => {
      xmlReads.push(id)
      const text = xml.get(id)
      return text === undefined ? Promise.reject(new Error('XML file not found')) : Promise.resolve(text)
    },
  }
  return {
    store,
    rows,
    xml,
    updated,
    lists: () => lists,
    xmlReads: (id) => xmlReads.filter((readId) => readId === id).length,
  }
}
