import { newUuid } from '@root/frontend/utils/new-uuid'
import type {
  DescriptionItem,
  DescriptionRowStore,
  DescriptionStoredRow,
} from '@root/middleware/shared/ports/device-description-repository'
import type { Result } from '@root/middleware/shared/ports/types'
import { createPromiseLruCache } from '@root/middleware/shared/utils/ethercat/promise-lru-cache'

import { hashText } from '../project/project-snapshot-archive'
import { errorMessage } from './error-message'

export { errorMessage }

/** Bound of the XML cache, in characters: about 64 MB of ASCII XML. */
const XML_CACHE_MAX_CHARS = 64 * 1024 * 1024

/** What a repository needs from its format and its platform. */
export interface DescriptionRepositoryOptions<S> {
  /** Where rows and their XML are kept. */
  store: DescriptionRowStore<S>
  /** Version of the summary `summarize` produces; rows stored with another version are re-read. */
  summaryVersion: number
  /** Name of the format in log lines and error texts, such as `ESI`. */
  label: string
  /**
   * Reads a description file into the summary its row carries.
   *
   * @param xml The file's text.
   * @param filename The file's name.
   * @returns The summary, or an error text when the file is not a valid description.
   */
  summarize(xml: string, filename: string): Promise<{ summary: S } | { error: string }>
}

/** A repository of description files with summary type `S`. */
export interface DescriptionRepository<S> {
  /**
   * Lists the stored items. Rows from another summary version are re-read from their XML
   * and stored again; a row that cannot be re-read is left out.
   */
  loadItems(): Promise<Result<{ items: DescriptionItem<S>[] }>>
  /**
   * Summarizes a file and stores it as a new row.
   *
   * @param filename The file's name.
   * @param content The file's text.
   * @returns The new item, or `duplicate: true` and no item when identical content is already stored.
   */
  importFile(filename: string, content: string): Promise<Result<{ item?: DescriptionItem<S>; duplicate?: boolean }>>
  /** Removes one item and its XML. Listeners are told before the store removes it. */
  removeItem(itemId: string): Promise<Result>
  /** Removes every item. Listeners are told with `null` before the store clears. */
  clear(): Promise<Result>
  /**
   * Returns the XML of an item, from the cache when it holds it.
   *
   * @throws The store's error when the XML cannot be read.
   */
  loadXml(itemId: string): Promise<string>
  /**
   * Subscribes to cache invalidation: called with the item id on delete, and with `null`
   * on clear and on a store scope change.
   */
  onInvalidate(listener: (itemId: string | null) => void): void
}

type CurrentRow<S> = DescriptionStoredRow<S> & { summary: S; contentHash: string }

/** The item the UI sees: the summary plus the row's identity. */
export function toRepositoryItem<S>(row: DescriptionStoredRow<S> & { summary: S }): DescriptionItem<S> {
  return { ...row.summary, id: row.id, filename: row.filename, loadedAt: row.loadedAt }
}

/**
 * Builds the generic device-description repository, shared by every platform and every description format.
 *
 * It holds the behaviour that does not depend on the format: each row with its summary, content hashing and
 * duplicate detection, re-reading rows stored with another summary version, and the XML cache. A format supplies
 * only its summarizer; a platform supplies only a row store (`ports/device-description-repository.ts`). Delete,
 * clear and a change of the store's scope invalidate the caches.
 *
 * @param options - The row store, summary version, label and summarizer.
 * @returns The repository.
 */
export function createDescriptionRepository<S>(options: DescriptionRepositoryOptions<S>): DescriptionRepository<S> {
  const { store, summaryVersion, label } = options
  const xmlCache = createPromiseLruCache<string>({ maxWeight: XML_CACHE_MAX_CHARS, weigh: (xml) => xml.length })
  const listeners: Array<(itemId: string | null) => void> = []
  let rows: CurrentRow<S>[] | null = null

  function invalidate(itemId: string | null): void {
    if (itemId === null) xmlCache.clear()
    else xmlCache.delete(itemId)
    for (const listener of listeners) listener(itemId)
  }

  store.onScopeChanged?.(() => {
    rows = null
    invalidate(null)
  })

  function isCurrent(row: DescriptionStoredRow<S>): row is CurrentRow<S> {
    return row.summary !== undefined && row.contentHash !== undefined && row.summaryVersion === summaryVersion
  }

  function loadXml(itemId: string): Promise<string> {
    return xmlCache.load(itemId, () => store.readXml(itemId))
  }

  async function refresh(row: DescriptionStoredRow<S>): Promise<CurrentRow<S> | null> {
    try {
      const xml = await loadXml(row.id)
      const result = await options.summarize(xml, row.filename)
      if ('error' in result) {
        console.error(`${label} file ${row.filename} could not be re-read: ${result.error}`)
        return null
      }
      const next: CurrentRow<S> = {
        ...row,
        contentHash: await hashText(xml),
        summaryVersion,
        summary: result.summary,
      }
      await store.update(next).catch((err: unknown) => console.error(`${label} file ${row.filename} not updated:`, err))
      return next
    } catch (err) {
      console.error(`${label} file ${row.filename} could not be re-read:`, err)
      return null
    }
  }

  async function listRows(): Promise<CurrentRow<S>[]> {
    const listed: CurrentRow<S>[] = []
    for (const row of await store.list()) {
      const current = isCurrent(row) ? row : await refresh(row)
      if (current) listed.push(current)
    }
    rows = listed
    return listed
  }

  return {
    async loadItems() {
      try {
        const items = (await listRows()).map(toRepositoryItem)
        return { success: true, items }
      } catch (err) {
        return { success: false, error: errorMessage(err, `Failed to load ${label} repository`) }
      }
    },

    async importFile(filename, content) {
      let summary: S
      let contentHash: string
      try {
        const result = await options.summarize(content, filename)
        if ('error' in result) return { success: false, error: result.error }
        summary = result.summary
        contentHash = await hashText(content)
      } catch (err) {
        return { success: false, error: errorMessage(err, `Failed to parse ${label} file`) }
      }

      try {
        const known = rows ?? (await listRows())
        if (known.some((row) => row.contentHash === contentHash)) return { success: true, duplicate: true }

        const row: CurrentRow<S> = {
          id: newUuid(),
          filename,
          loadedAt: new Date().toISOString(),
          contentHash,
          summaryVersion,
          summary,
        }
        const kept = await store.insert(row, content)
        const stored: CurrentRow<S> = { ...row, ...kept, contentHash, summaryVersion, summary }
        rows = [...known.filter((r) => r.id !== stored.id), stored]
        return { success: true, item: toRepositoryItem(stored) }
      } catch (err) {
        return { success: false, error: errorMessage(err, `Failed to upload ${label} file`) }
      }
    },

    async removeItem(itemId) {
      invalidate(itemId)
      try {
        await store.remove(itemId)
        if (rows) rows = rows.filter((r) => r.id !== itemId)
        return { success: true }
      } catch (err) {
        return { success: false, error: errorMessage(err, `Failed to delete ${label} item`) }
      }
    },

    async clear() {
      invalidate(null)
      try {
        await store.clear()
        rows = []
        return { success: true }
      } catch (err) {
        rows = null
        return { success: false, error: errorMessage(err, `Failed to clear ${label} repository`) }
      }
    },

    loadXml,

    onInvalidate(listener) {
      listeners.push(listener)
    },
  }
}
