import {
  createDescriptionRepository,
  errorMessage,
} from '@root/backend/shared/device-description/description-repository'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type {
  EsiParserMechanism,
  ESIRepositorySummary,
  EsiRowStore,
} from '@root/middleware/shared/ports/esi-repository-mechanisms'
import type { ESIDevice, ESIModule } from '@root/middleware/shared/ports/esi-types'
import { findModuleByIdent } from '@root/middleware/shared/utils/ethercat/esi-module-resolve'
import { createPromiseLruCache } from '@root/middleware/shared/utils/ethercat/promise-lru-cache'

export { toRepositoryItem } from '@root/backend/shared/device-description/description-repository'

/** Version of the summary the light parse produces. Rows stored with another version are re-parsed. */
export const ESI_SUMMARY_VERSION = 2

/** Bound of the parsed-device cache, in devices. */
const DEVICE_CACHE_MAX_ENTRIES = 64

function deviceCacheKey(itemId: string, deviceIndex: number): string {
  return `${deviceIndex}:${itemId}`
}

function isDeviceCacheKeyOf(key: string, itemId: string): boolean {
  return key.slice(key.indexOf(':') + 1) === itemId
}

export interface EsiRepositoryMechanisms {
  parser: EsiParserMechanism
  store: EsiRowStore
}

/**
 * Builds the ESI repository port, shared by every platform, on the generic description repository
 * (`backend/shared/device-description/description-repository.ts`). It adds parse acceptance, the cache of parsed
 * devices and module lookup by ident. A platform supplies only a parser mechanism and a row store
 * (`ports/esi-repository-mechanisms.ts`).
 *
 * @param mechanisms - The platform's parser mechanism and row store.
 * @returns The ESI port.
 */
export function createEsiRepositoryPort({ parser, store }: EsiRepositoryMechanisms): EsiPort {
  const deviceCache = createPromiseLruCache<ESIDevice>({ maxWeight: DEVICE_CACHE_MAX_ENTRIES, weigh: () => 1 })

  async function summarize(
    xml: string,
    filename: string,
  ): Promise<{ summary: ESIRepositorySummary } | { error: string }> {
    const parsed = await parser.run({ op: 'light', xml, filename })
    if (!parsed.success || !parsed.vendor || !parsed.devices) {
      return { error: parsed.error ?? 'Failed to parse ESI file' }
    }
    const { success: _success, error: _error, ...rest } = parsed
    return { summary: { ...rest, vendor: parsed.vendor, devices: parsed.devices } }
  }

  const repository = createDescriptionRepository<ESIRepositorySummary>({
    store,
    summaryVersion: ESI_SUMMARY_VERSION,
    label: 'ESI',
    summarize,
  })

  repository.onInvalidate((itemId) => {
    if (itemId === null) deviceCache.clear()
    else deviceCache.deleteWhere((key) => isDeviceCacheKeyOf(key, itemId))
  })

  async function loadItems() {
    const listed = await repository.loadItems()
    return listed.success ? { ...listed, needsMigration: false } : listed
  }

  async function parseDevice(itemId: string, deviceIndex: number): Promise<ESIDevice> {
    const parsed = await parser.run({ op: 'deviceFull', xml: await repository.loadXml(itemId), deviceIndex })
    if (!parsed.success || !parsed.device) throw new Error(parsed.error ?? 'Failed to parse ESI device')
    return parsed.device
  }

  return {
    loadRepositoryLight: loadItems,

    migrateRepository: loadItems,

    parseAndSaveFile: (filename, content) => repository.importFile(filename, content),

    deleteRepositoryItem: (itemId) => repository.removeItem(itemId),

    clearRepository: () => repository.clear(),

    async loadDeviceFull(itemId, deviceIndex) {
      let device: ESIDevice
      try {
        device = await deviceCache.load(deviceCacheKey(itemId, deviceIndex), () => parseDevice(itemId, deviceIndex))
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to load ESI XML') }
      }
      return { success: true, device: structuredClone(device) }
    },

    async loadModuleFull(itemId, ident) {
      try {
        const parsed = await parser.run({ op: 'modules', xml: await repository.loadXml(itemId) })
        if (!parsed.success) return { success: false, error: parsed.error ?? 'Failed to parse module ESI' }
        const module: ESIModule | undefined = findModuleByIdent(parsed.modules ?? [], ident)
        if (module === undefined) return { success: false, error: `Module ident ${ident} not found` }
        return { success: true, module: structuredClone(module) }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to load ESI module') }
      }
    },
  }
}
