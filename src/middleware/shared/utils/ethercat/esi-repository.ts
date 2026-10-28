/**
 * The ESI repository port, shared by every platform.
 *
 * All repository behaviour lives here: what a parse must contain to be
 * accepted, what a repository row holds, how a duplicate or a recovered upload
 * is reported, how rows written by an older Editor are brought up to date, how
 * parsed XML and devices are cached, and how a module is picked by ident.
 * Platforms supply only a parser mechanism (where the parser runs) and a store
 * mechanism (where files live); see `ports/esi-repository-mechanisms.ts`.
 *
 * Item ids are immutable in every store (new content gets a new id), so only
 * delete, clear and a scope change (account sign-in or sign-out) invalidate
 * the caches.
 */

import type { EsiPort } from '../../ports/esi-port'
import type {
  EsiParserMechanism,
  ESIRepositorySummary,
  EsiStoredRecord,
  EsiStoreMechanism,
} from '../../ports/esi-repository-mechanisms'
import type { ESIDevice, ESIModule, ESIRepositoryItemLight } from '../../ports/esi-types'
import { findModuleByIdent } from './esi-module-resolve'
import { createPromiseLruCache } from './promise-lru-cache'

// ~64 MB for ASCII XML (V8 stores it one byte per char): room for a few family files, never a pile of 100 MB ones.
const XML_CACHE_MAX_CHARS = 64 * 1024 * 1024
// Parsed devices are small next to their XML; 64 covers a large bus plus the browser without re-parsing.
const DEVICE_CACHE_MAX_ENTRIES = 64

class EsiParseError extends Error {}

function deviceCacheKey(itemId: string, deviceIndex: number): string {
  return `${deviceIndex}:${itemId}`
}

function isDeviceCacheKeyOf(key: string, itemId: string): boolean {
  return key.slice(key.indexOf(':') + 1) === itemId
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  return String(err) || fallback
}

/** The row the UI sees: the stored identity plus the parser's summary, untouched. */
export function toRepositoryItem(record: EsiStoredRecord & { summary: ESIRepositorySummary }): ESIRepositoryItemLight {
  return { ...record.summary, id: record.id, filename: record.filename, loadedAt: record.loadedAt }
}

export interface EsiRepositoryMechanisms {
  parser: EsiParserMechanism
  store: EsiStoreMechanism
}

export function createEsiRepositoryPort({ parser, store }: EsiRepositoryMechanisms): EsiPort {
  const xmlCache = createPromiseLruCache<string>({ maxWeight: XML_CACHE_MAX_CHARS, weigh: (xml) => xml.length })
  const deviceCache = createPromiseLruCache<ESIDevice>({ maxWeight: DEVICE_CACHE_MAX_ENTRIES, weigh: () => 1 })
  // The repository is per scope (account): another scope must not be served what the previous one loaded.
  store.onScopeChanged?.(() => {
    xmlCache.clear()
    deviceCache.clear()
  })

  function invalidateItem(itemId: string): void {
    xmlCache.delete(itemId)
    deviceCache.deleteWhere((key) => isDeviceCacheKeyOf(key, itemId))
  }

  function loadXml(itemId: string): Promise<string> {
    return xmlCache.load(itemId, () => store.readXml(itemId))
  }

  /** Parse an ESI file into the summary its repository row carries, or explain why it is not an ESI. */
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

  /** Rows written by an older Editor carry an incomplete summary: re-parse their XML once and store the result. */
  async function completeRecords(records: EsiStoredRecord[]): Promise<ESIRepositoryItemLight[]> {
    const items: ESIRepositoryItemLight[] = []
    for (const record of records) {
      if (record.summary) {
        items.push(toRepositoryItem({ ...record, summary: record.summary }))
        continue
      }
      try {
        const result = await summarize(await loadXml(record.id), record.filename)
        if ('error' in result) {
          console.error(`ESI file ${record.filename} could not be re-read: ${result.error}`)
          continue
        }
        await store.saveSummary(record.id, result.summary)
        items.push(toRepositoryItem({ ...record, summary: result.summary }))
      } catch (err) {
        console.error(`ESI file ${record.filename} could not be re-read:`, err)
      }
    }
    return items
  }

  async function loadItems() {
    try {
      const items = await completeRecords(await store.list())
      return { success: true as const, items, needsMigration: false }
    } catch (err) {
      return { success: false as const, error: errorMessage(err, 'Failed to load ESI repository') }
    }
  }

  async function parseDevice(itemId: string, deviceIndex: number): Promise<ESIDevice> {
    const xml = await loadXml(itemId)
    const parsed = await parser.run({ op: 'deviceFull', xml, deviceIndex })
    if (!parsed.success || !parsed.device) {
      throw new EsiParseError(parsed.error ?? 'Failed to parse ESI device')
    }
    return parsed.device
  }

  return {
    loadRepositoryLight: loadItems,

    // Rows are brought up to date as they load, so there is never a separate migration step.
    migrateRepository: loadItems,

    async parseAndSaveFile(filename, content) {
      // Parse before anything is stored. The parser thread can reject (a crash
      // or out-of-memory on a huge XML); that becomes a Result error.
      let summary: ESIRepositorySummary
      try {
        const result = await summarize(content, filename)
        if ('error' in result) return { success: false, error: result.error }
        summary = result.summary
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to parse ESI file') }
      }

      try {
        const { record, duplicate, retried } = await store.upload({ filename, content, summary })
        const item = record ? toRepositoryItem({ ...record, summary: record.summary ?? summary }) : undefined

        if (duplicate) {
          // A duplicate that only surfaced after a retry is almost always a
          // recovered upload (attempt 1 persisted, its response was lost):
          // surface the matched row as a normal add so the user sees it land.
          if (retried && item) return { success: true, item, dedupAfterRetry: true }
          // No row to surface: a real re-upload of existing content (silent
          // skip), or a store that doesn't echo the matched row. Keep
          // `dedupAfterRetry` so a recovered-but-unlisted upload still prompts
          // the caller to refresh instead of vanishing.
          return { success: true, duplicate: true, dedupAfterRetry: retried }
        }

        if (item) return { success: true, item }
        return { success: false, error: 'Upload succeeded but no item was returned' }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to upload ESI file') }
      }
    },

    async deleteRepositoryItem(itemId) {
      invalidateItem(itemId)
      try {
        await store.remove(itemId)
        return { success: true }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to delete ESI item') }
      }
    },

    async clearRepository() {
      xmlCache.clear()
      deviceCache.clear()
      try {
        await store.clear()
        return { success: true }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to clear ESI repository') }
      }
    },

    async loadDeviceFull(itemId, deviceIndex) {
      let device: ESIDevice
      try {
        device = await deviceCache.load(deviceCacheKey(itemId, deviceIndex), () => parseDevice(itemId, deviceIndex))
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to load ESI XML') }
      }
      // Callers own the returned device; the cached one must stay untouched.
      return { success: true, device: structuredClone(device) }
    },

    async loadModuleFull(itemId, ident) {
      try {
        const parsed = await parser.run({ op: 'modules', xml: await loadXml(itemId) })
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
