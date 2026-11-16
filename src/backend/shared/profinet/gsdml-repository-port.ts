import {
  createDescriptionRepository,
  errorMessage,
} from '@root/backend/shared/device-description/description-repository'
import type { GsdmlPort } from '@root/middleware/shared/ports/gsdml-port'
import type {
  GsdmlParserMechanism,
  GsdmlRepositorySummary,
  GsdmlRowStore,
} from '@root/middleware/shared/ports/gsdml-repository-mechanisms'
import type { GsdmlCatalog } from '@root/middleware/shared/ports/gsdml-types'
import { createPromiseLruCache } from '@root/middleware/shared/utils/ethercat/promise-lru-cache'

/** Version of the summary the `summary` op produces. Rows stored with another version are re-parsed. */
export const GSDML_SUMMARY_VERSION = 1

/** Bound of the parsed-catalog cache, in catalogs. */
const CATALOG_CACHE_MAX_ENTRIES = 4

/** Error text of a parser response tagged with another op than the request's. */
const UNEXPECTED_RESPONSE = 'Unexpected GSDML parser response'

/** The mechanisms a platform supplies to the GSDML repository port. */
export interface GsdmlRepositoryMechanisms {
  /** Runs the shared parser on the platform's parsing thread. */
  parser: GsdmlParserMechanism
  /** Where rows and their XML are kept. */
  store: GsdmlRowStore
}

/**
 * Builds the GSDML repository port over a platform's parser thread and row store.
 *
 * Rows, content hashing, duplicate detection, re-parsing of rows from another summary
 * version and the XML cache come from the generic description repository
 * (`backend/shared/device-description/description-repository.ts`); this port adds the
 * GSDML parse ops and the cache of parsed catalogs.
 *
 * @param mechanisms The parser mechanism and the row store; both make no decisions.
 * @returns The port. Catalogs are cached for the four most recently used items and dropped
 *   when their item is removed, on clear and on a store scope change.
 */
export function createGsdmlRepositoryPort({ parser, store }: GsdmlRepositoryMechanisms): GsdmlPort {
  const catalogCache = createPromiseLruCache<GsdmlCatalog>({ maxWeight: CATALOG_CACHE_MAX_ENTRIES, weigh: () => 1 })

  async function summarize(xml: string): Promise<{ summary: GsdmlRepositorySummary } | { error: string }> {
    const response = await parser.run({ op: 'summary', xml })
    if (response.op !== 'summary') return { error: UNEXPECTED_RESPONSE }
    return response.result.success ? { summary: response.result.summary } : { error: response.result.error }
  }

  const repository = createDescriptionRepository<GsdmlRepositorySummary>({
    store,
    summaryVersion: GSDML_SUMMARY_VERSION,
    label: 'GSDML',
    summarize,
  })

  repository.onInvalidate((itemId) => {
    if (itemId === null) catalogCache.clear()
    else catalogCache.delete(itemId)
  })

  async function parseCatalog(itemId: string): Promise<GsdmlCatalog> {
    const response = await parser.run({ op: 'catalog', xml: await repository.loadXml(itemId) })
    if (response.op !== 'catalog') throw new Error(UNEXPECTED_RESPONSE)
    if (!response.result.success) throw new Error(response.result.error)
    return response.result.catalog
  }

  return {
    loadRepository: () => repository.loadItems(),

    importFile: (filename, content) => repository.importFile(filename, content),

    removeItem: (itemId) => repository.removeItem(itemId),

    clearRepository: () => repository.clear(),

    async loadCatalog(itemId) {
      try {
        const catalog = await catalogCache.load(itemId, () => parseCatalog(itemId))
        return { success: true, catalog }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to load GSDML catalog') }
      }
    },
  }
}
