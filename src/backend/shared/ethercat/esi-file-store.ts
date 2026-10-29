/**
 * ESI rows kept as files in one folder: `repository.json` plus `<id>.xml` per
 * file. Turns a platform `EsiFileStore` (plain file I/O) into an `EsiRowStore`.
 *
 * Index format, version 3: `{ version: 3, items: EsiStoredRow[] }`, rows kept
 * verbatim. Versions 1 and 2 are read as rows without a summary, so the port
 * re-parses them. An index that is not valid JSON or has an unexpected shape is
 * kept as a `.bak` copy and the repository starts empty.
 */

import type { EsiFileStore, EsiRowStore, EsiStoredRow } from '@root/middleware/shared/ports/esi-repository-mechanisms'

export const ESI_INDEX_FILE = 'repository.json'
const INDEX_VERSION = 3

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function xmlName(id: string): string {
  if (!UUID_REGEX.test(id)) throw new Error(`Invalid item ID: ${id}`)
  return `${id}.xml`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSummary(value: unknown): boolean {
  return isRecord(value) && isRecord(value.vendor) && Array.isArray(value.devices)
}

function isStoredRow(value: unknown): value is EsiStoredRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_REGEX.test(value.id) &&
    typeof value.filename === 'string' &&
    typeof value.loadedAt === 'string' &&
    (value.contentHash === undefined || typeof value.contentHash === 'string') &&
    (value.summaryVersion === undefined || typeof value.summaryVersion === 'number') &&
    (value.summary === undefined || isSummary(value.summary))
  )
}

/** A row from a version 1 or 2 index: identity only; its inline summary is not trusted. */
function fromLegacyRow(value: unknown): EsiStoredRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID_REGEX.test(value.id)) return null
  if (typeof value.filename !== 'string') return null
  const ms = typeof value.loadedAt === 'number' ? value.loadedAt : NaN
  return {
    id: value.id,
    filename: value.filename,
    loadedAt: new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString(),
  }
}

type IndexRead = { rows: EsiStoredRow[] } | { invalid: true }

/** Interpret the text of `repository.json`. */
export function readEsiIndex(text: string): IndexRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { invalid: true }
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'number' || !Array.isArray(parsed.items)) return { invalid: true }
  if (parsed.version > INDEX_VERSION) {
    throw new Error('This ESI repository was saved by a newer OpenPLC Editor. Update the Editor to open it.')
  }
  if (parsed.version === INDEX_VERSION) {
    return parsed.items.every(isStoredRow) ? { rows: parsed.items } : { invalid: true }
  }
  const rows = parsed.items.map(fromLegacyRow)
  return rows.every((row): row is EsiStoredRow => row !== null) ? { rows } : { invalid: true }
}

export function createFileEsiRowStore(files: EsiFileStore): EsiRowStore {
  let lock: Promise<unknown> = Promise.resolve()
  const onScopeChanged = files.onScopeChanged?.bind(files)

  /** One index read-modify-write at a time, so concurrent calls cannot lose rows. */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn, fn)
    lock = run.catch(() => undefined)
    return run
  }

  async function readRows(): Promise<EsiStoredRow[]> {
    const text = await files.read(ESI_INDEX_FILE)
    if (text === null) return []
    const index = readEsiIndex(text)
    if ('rows' in index) return index.rows
    await files.write(`${ESI_INDEX_FILE}.corrupt-${Date.now()}.bak`, text)
    return []
  }

  function writeRows(rows: EsiStoredRow[]): Promise<void> {
    return files.write(ESI_INDEX_FILE, JSON.stringify({ version: INDEX_VERSION, items: rows }, null, 2))
  }

  return {
    list: () => exclusive(readRows),

    insert: (row, xml) =>
      exclusive(async () => {
        const name = xmlName(row.id)
        const rows = await readRows()
        await files.write(name, xml)
        try {
          await writeRows([...rows, row])
        } catch (error) {
          // An XML the index does not reference is never kept.
          await files.remove(name).catch(() => undefined)
          throw error
        }
        return row
      }),

    update: (row) =>
      exclusive(async () => {
        const rows = await readRows()
        await writeRows(rows.map((r) => (r.id === row.id ? row : r)))
      }),

    // The index is written before files are deleted: a failure leaves an unreferenced XML, never a row without one.
    remove: (id) =>
      exclusive(async () => {
        const name = xmlName(id)
        const rows = await readRows()
        await writeRows(rows.filter((r) => r.id !== id))
        await files.remove(name)
      }),

    clear: () =>
      exclusive(async () => {
        const names = await files.list()
        await writeRows([])
        await Promise.allSettled(names.filter((n) => n.endsWith('.xml')).map((n) => files.remove(n)))
      }),

    async readXml(id) {
      const xml = await files.read(xmlName(id))
      if (xml === null) throw new Error('XML file not found')
      return xml
    },

    ...(onScopeChanged && { onScopeChanged }),
  }
}
